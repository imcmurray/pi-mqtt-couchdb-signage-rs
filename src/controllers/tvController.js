const TV = require('../models/tv');
const mqttService = require('../services/mqttService');
const Joi = require('joi');

// Validation schemas
const tvSchema = Joi.object({
  name: Joi.string().required(),
  location: Joi.string().required(),
  ip_address: Joi.string().ip().required(),
  config: Joi.object({
    transition_effect: Joi.string().valid('fade', 'slide', 'wipe', 'dissolve').default('fade'),
    display_duration: Joi.number().min(1000).max(60000).default(5000),
    resolution: Joi.string().default('1920x1080'),
    orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait').default('landscape')
  }).default({})
});

const configUpdateSchema = Joi.object({
  transition_effect: Joi.string().valid('fade', 'slide', 'wipe', 'dissolve'),
  display_duration: Joi.number().min(1000).max(60000),
  resolution: Joi.string(),
  orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait')
});

const registrationSchema = Joi.object({
  tv_id: Joi.string().required(),
  hostname: Joi.string().required(),
  ip_address: Joi.string().ip().required(),
  platform: Joi.string().default('raspberry-pi'),
  version: Joi.string().default('unknown'),
  orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait').default('landscape')
});

class TvController {
  async getAllTvs(req, res) {
    const tvs = await TV.findAll();
    res.json(tvs);
  }

  async getTvById(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }
    res.json(tv);
  }

  async createTv(req, res) {
    const { error, value } = tvSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const tv = new TV(value);
    await tv.save();
    
    res.status(201).json(tv);
  }

  async registerTv(req, res) {
    const { error, value } = registrationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { tv_id, hostname, ip_address, orientation } = value;
    
    // Check if TV already exists
    const existingTv = await TV.findById(tv_id);
    if (existingTv) {
      // Update existing TV with current info
      const updatedTv = await existingTv.update({
        ip_address,
        status: 'online',
        last_heartbeat: new Date().toISOString(),
        config: {
          ...existingTv.config,
          orientation
        }
      });
      console.log(`TV ${tv_id} re-registered from ${ip_address} (${hostname})`);
      return res.json({ 
        message: 'TV re-registered successfully', 
        tv: updatedTv,
        isNew: false 
      });
    }

    // Create new TV registration
    const tv = new TV({
      _id: tv_id,
      name: `Display at ${ip_address}`,
      location: `Auto-registered from ${ip_address}`,
      ip_address,
      status: 'online',
      last_heartbeat: new Date().toISOString(),
      config: {
        orientation,
        transition_effect: 'fade',
        display_duration: 5000,
        resolution: '1920x1080'
      }
    });

    await tv.save();
    console.log(`New TV ${tv_id} registered from ${ip_address} (${hostname})`);
    
    res.status(201).json({ 
      message: 'TV registered successfully', 
      tv,
      isNew: true 
    });
  }

  async updateTv(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { error, value } = tvSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updatedTv = await tv.update(value);
    
    // Check if config was updated and send MQTT config update
    if (value.config) {
      const tvId = tv._id.replace('tv_', '');
      await mqttService.updateConfig(tvId, updatedTv.config);
      console.log(`Configuration updated for TV ${tvId} via general update:`, value.config);
    }
    
    res.json(updatedTv);
  }

  async deleteTv(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    await tv.delete();
    res.status(204).send();
  }

  async controlTv(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { action } = req.params;
    const tvId = tv._id.replace('tv_', '');

    switch (action) {
      case 'play':
        await mqttService.playSlideshow(tvId);
        break;
      case 'pause':
        await mqttService.pauseSlideshow(tvId);
        break;
      case 'next':
        await mqttService.nextImage(tvId);
        break;
      case 'previous':
        await mqttService.previousImage(tvId);
        break;
      case 'reboot':
        await mqttService.rebootTv(tvId);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    res.json({ message: `Action '${action}' sent to TV ${tvId}` });
  }

  async updateTvConfig(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { error, value } = configUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    // Update TV config in database
    const updatedConfig = { ...tv.config, ...value };
    const updatedTv = await tv.update({ config: updatedConfig });

    // Send config update to TV via MQTT
    const tvId = tv._id.replace('tv_', '');
    await mqttService.updateConfig(tvId, updatedConfig);

    console.log(`Configuration updated for TV ${tvId}:`, value);

    res.json(updatedTv);
  }

  async getTvsByStatus(req, res) {
    const tvs = await TV.findByStatus(req.params.status);
    res.json(tvs);
  }

  // Layer management methods for Phase 2
  async getTvLayers(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    res.json({
      tv_id: tv._id,
      layers: tv.config.layers || {},
      layer_settings: tv.config.layer_settings || {},
      last_updated: tv.updated_at
    });
  }

  async updateTvLayers(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const updatedConfig = {
      ...tv.config,
      layers: req.body.layers || tv.config.layers,
      layer_settings: req.body.layer_settings || tv.config.layer_settings
    };

    const updatedTv = await tv.update({ config: updatedConfig });

    // Send layer config update to TV via MQTT
    const tvId = tv._id.replace('tv_', '');
    await mqttService.updateLayerConfig(tvId, {
      layers: updatedConfig.layers,
      layer_settings: updatedConfig.layer_settings
    });

    console.log(`Layer configuration updated for TV ${tvId}`);

    res.json({
      tv_id: updatedTv._id,
      layers: updatedConfig.layers,
      layer_settings: updatedConfig.layer_settings,
      last_updated: updatedTv.updated_at
    });
  }

  async updateTvLayer(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { layerId } = req.params;
    const layerData = req.body;

    // Update specific layer in config
    const updatedLayers = {
      ...tv.config.layers,
      [layerId]: {
        ...tv.config.layers[layerId],
        ...layerData
      }
    };

    const updatedConfig = {
      ...tv.config,
      layers: updatedLayers
    };

    const updatedTv = await tv.update({ config: updatedConfig });

    // Send layer update to TV via MQTT
    const tvId = tv._id.replace('tv_', '');
    await mqttService.updateSpecificLayer(tvId, layerId, updatedLayers[layerId]);

    console.log(`Layer '${layerId}' updated for TV ${tvId}`);

    res.json({
      tv_id: updatedTv._id,
      layer_id: layerId,
      layer: updatedLayers[layerId],
      last_updated: updatedTv.updated_at
    });
  }

  async deleteTvLayer(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { layerId } = req.params;

    // Prevent deletion of slideshow layer
    if (layerId === 'slideshow') {
      return res.status(400).json({ error: 'Cannot delete the slideshow layer' });
    }

    if (!tv.config.layers[layerId]) {
      return res.status(404).json({ error: 'Layer not found' });
    }

    // Remove layer from config
    const updatedLayers = { ...tv.config.layers };
    delete updatedLayers[layerId];

    const updatedConfig = {
      ...tv.config,
      layers: updatedLayers
    };

    await tv.update({ config: updatedConfig });

    // Send layer deletion to TV via MQTT
    const tvId = tv._id.replace('tv_', '');
    await mqttService.removeLayer(tvId, layerId);

    console.log(`Layer '${layerId}' removed from TV ${tvId}`);

    res.status(204).send();
  }

  async setTvLayerVisibility(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { layerId } = req.params;
    const { visible } = req.body;

    if (!tv.config.layers[layerId]) {
      return res.status(404).json({ error: 'Layer not found' });
    }

    // Update layer visibility
    const updatedLayers = {
      ...tv.config.layers,
      [layerId]: {
        ...tv.config.layers[layerId],
        enabled: visible
      }
    };

    const updatedConfig = {
      ...tv.config,
      layers: updatedLayers
    };

    const updatedTv = await tv.update({ config: updatedConfig });

    // Send visibility update to TV via MQTT
    const tvId = tv._id.replace('tv_', '');
    await mqttService.setLayerVisibility(tvId, layerId, visible);

    console.log(`Layer '${layerId}' visibility set to ${visible} for TV ${tvId}`);

    res.json({
      tv_id: updatedTv._id,
      layer_id: layerId,
      visible: visible,
      last_updated: updatedTv.updated_at
    });
  }
}

module.exports = new TvController();