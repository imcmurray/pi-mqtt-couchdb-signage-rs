const express = require('express');
const router = express.Router();
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

// GET /api/tvs - Get all TVs
router.get('/', async (req, res) => {
  try {
    const tvs = await TV.findAll();
    res.json(tvs);
  } catch (error) {
    console.error('Error fetching TVs:', error);
    res.status(500).json({ error: 'Failed to fetch TVs' });
  }
});

// GET /api/tvs/:id - Get specific TV
router.get('/:id', async (req, res) => {
  try {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }
    res.json(tv);
  } catch (error) {
    console.error('Error fetching TV:', error);
    res.status(500).json({ error: 'Failed to fetch TV' });
  }
});

// POST /api/tvs - Create new TV
router.post('/', async (req, res) => {
  try {
    const { error, value } = tvSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const tv = new TV(value);
    await tv.save();
    
    res.status(201).json(tv);
  } catch (error) {
    console.error('Error creating TV:', error);
    res.status(500).json({ error: 'Failed to create TV' });
  }
});

// POST /api/tvs/register - Register TV endpoint (for auto-registration)
router.post('/register', async (req, res) => {
  try {
    const registrationSchema = Joi.object({
      tv_id: Joi.string().required(),
      hostname: Joi.string().required(),
      ip_address: Joi.string().ip().required(),
      platform: Joi.string().default('raspberry-pi'),
      version: Joi.string().default('unknown'),
      orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait').default('landscape')
    });

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
  } catch (error) {
    console.error('Error registering TV:', error);
    res.status(500).json({ error: 'Failed to register TV' });
  }
});

// PUT /api/tvs/:id - Update TV
router.put('/:id', async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error updating TV:', error);
    res.status(500).json({ error: 'Failed to update TV' });
  }
});

// DELETE /api/tvs/:id - Delete TV
router.delete('/:id', async (req, res) => {
  try {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    await tv.delete();
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting TV:', error);
    res.status(500).json({ error: 'Failed to delete TV' });
  }
});

// POST /api/tvs/:id/control/:action - Control TV slideshow
router.post('/:id/control/:action', async (req, res) => {
  try {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { action } = req.params;
    // Use the _id field (without tv_ prefix) for MQTT communication
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
  } catch (error) {
    console.error('Error controlling TV:', error);
    res.status(500).json({ error: 'Failed to control TV' });
  }
});

// PUT /api/tvs/:id/config - Update TV configuration
router.put('/:id/config', async (req, res) => {
  try {
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

    // Send config update to TV via MQTT using the _id field (without tv_ prefix)
    const tvId = tv._id.replace('tv_', '');
    await mqttService.updateConfig(tvId, updatedConfig);

    console.log(`Configuration updated for TV ${tvId}:`, value);

    res.json(updatedTv);
  } catch (error) {
    console.error('Error updating TV config:', error);
    res.status(500).json({ error: 'Failed to update TV config' });
  }
});

// GET /api/tvs/status/:status - Get TVs by status
router.get('/status/:status', async (req, res) => {
  try {
    const tvs = await TV.findByStatus(req.params.status);
    res.json(tvs);
  } catch (error) {
    console.error('Error fetching TVs by status:', error);
    res.status(500).json({ error: 'Failed to fetch TVs by status' });
  }
});

module.exports = router;