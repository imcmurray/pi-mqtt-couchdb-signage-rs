const TV = require('../models/tv.multilayer');
const mqttService = require('../services/multilayer.mqttService');
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
  orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait').default('landscape'),
  layer_support: Joi.boolean().optional()
});

class TvController {
  /**
   * @openapi
   * /api/tvs:
   *   get:
   *     summary: Get all TVs
   *     description: Returns a list of all registered TV displays
   *     tags:
   *       - TVs
   *     responses:
   *       200:
   *         description: List of all TVs
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/TV'
   */
  async getAllTvs(req, res) {
    const tvs = await TV.findAll();
    res.json(tvs);
  }

  /**
   * @openapi
   * /api/tvs/{id}:
   *   get:
   *     summary: Get TV by ID
   *     description: Returns a specific TV display by its ID
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: TV identifier
   *         example: tv_001
   *     responses:
   *       200:
   *         description: TV found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TV'
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getTvById(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }
    res.json(tv);
  }

  /**
   * @openapi
   * /api/tvs:
   *   post:
   *     summary: Create new TV
   *     description: Manually registers a new TV display in the management system
   *     tags:
   *       - TVs
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - location
   *               - ip_address
   *             properties:
   *               name:
   *                 type: string
   *                 example: Main Courtroom Display
   *               location:
   *                 type: string
   *                 example: Courtroom A
   *               ip_address:
   *                 type: string
   *                 format: ipv4
   *                 example: 192.168.1.100
   *               config:
   *                 type: object
   *                 properties:
   *                   transition_effect:
   *                     type: string
   *                     enum: [fade, slide, wipe, dissolve]
   *                     default: fade
   *                   display_duration:
   *                     type: integer
   *                     minimum: 1000
   *                     maximum: 60000
   *                     default: 5000
   *                     description: Duration in milliseconds
   *                   resolution:
   *                     type: string
   *                     default: 1920x1080
   *                   orientation:
   *                     type: string
   *                     enum: [landscape, portrait, inverted_landscape, inverted_portrait]
   *                     default: landscape
   *     responses:
   *       201:
   *         description: TV created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TV'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   */
  async createTv(req, res) {
    const { error, value } = tvSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const tv = new TV(value);
    await tv.save();
    
    res.status(201).json(tv);
  }

  /**
   * @openapi
   * /api/tvs/register:
   *   post:
   *     summary: Register TV (auto-registration)
   *     description: Used by Raspberry Pi devices to auto-register on startup. Creates new TV or updates existing registration.
   *     tags:
   *       - TVs
   *     security:
   *       - TVToken: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - tv_id
   *               - hostname
   *               - ip_address
   *             properties:
   *               tv_id:
   *                 type: string
   *                 description: Unique TV identifier from device
   *                 example: tv_rpi_001
   *               hostname:
   *                 type: string
   *                 example: raspberrypi-courtroom-a
   *               ip_address:
   *                 type: string
   *                 format: ipv4
   *                 example: 192.168.1.100
   *               platform:
   *                 type: string
   *                 default: raspberry-pi
   *               version:
   *                 type: string
   *                 description: pi-slideshow-rs version
   *                 default: unknown
   *               orientation:
   *                 type: string
   *                 enum: [landscape, portrait, inverted_landscape, inverted_portrait]
   *                 default: landscape
   *     responses:
   *       200:
   *         description: TV re-registered (already exists)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: TV re-registered successfully
   *                 tv:
   *                   $ref: '#/components/schemas/TV'
   *                 isNew:
   *                   type: boolean
   *                   example: false
   *       201:
   *         description: New TV registered
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: TV registered successfully
   *                 tv:
   *                   $ref: '#/components/schemas/TV'
   *                 isNew:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}:
   *   put:
   *     summary: Update TV
   *     description: Updates TV information and configuration. Sends MQTT config update to device.
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - location
   *               - ip_address
   *             properties:
   *               name:
   *                 type: string
   *               location:
   *                 type: string
   *               ip_address:
   *                 type: string
   *                 format: ipv4
   *               config:
   *                 type: object
   *     responses:
   *       200:
   *         description: TV updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TV'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}:
   *   delete:
   *     summary: Delete TV
   *     description: Removes a TV from the management system
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     responses:
   *       204:
   *         description: TV deleted successfully
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async deleteTv(req, res) {
    const tv = await TV.findById(req.params.id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    await tv.delete();
    res.status(204).send();
  }

  /**
   * @openapi
   * /api/tvs/{id}/control/{action}:
   *   post:
   *     summary: Control TV slideshow
   *     description: Sends real-time control commands to TV via MQTT (play, pause, next, previous, reboot)
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *       - in: path
   *         name: action
   *         required: true
   *         schema:
   *           type: string
   *           enum: [play, pause, next, previous, reboot]
   *         description: Control action to perform
   *         example: play
   *     responses:
   *       200:
   *         description: Command sent successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Action 'play' sent to TV 001
   *       400:
   *         description: Invalid action
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}/config:
   *   put:
   *     summary: Update TV configuration
   *     description: Updates TV display settings and sends MQTT config update to device
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               transition_effect:
   *                 type: string
   *                 enum: [fade, slide, wipe, dissolve]
   *               display_duration:
   *                 type: integer
   *                 minimum: 1000
   *                 maximum: 60000
   *               resolution:
   *                 type: string
   *               orientation:
   *                 type: string
   *                 enum: [landscape, portrait, inverted_landscape, inverted_portrait]
   *     responses:
   *       200:
   *         description: Configuration updated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TV'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/status/{status}:
   *   get:
   *     summary: Get TVs by status
   *     description: Returns all TVs filtered by operational status (online, offline, error)
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: status
   *         required: true
   *         schema:
   *           type: string
   *           enum: [online, offline, error]
   *         description: TV status filter
   *         example: online
   *     responses:
   *       200:
   *         description: List of TVs with matching status
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/TV'
   */
  async getTvsByStatus(req, res) {
    const tvs = await TV.findByStatus(req.params.status);
    res.json(tvs);
  }

  /**
   * @openapi
   * /api/tvs/{id}/layers:
   *   get:
   *     summary: Get TV layer configuration
   *     description: Returns the complete layer configuration for a TV display
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     responses:
   *       200:
   *         description: Layer configuration
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tv_id:
   *                   type: string
   *                 layers:
   *                   type: object
   *                   description: Layer configurations keyed by layer ID
   *                 layer_settings:
   *                   type: object
   *                   description: Global layer settings
   *                 last_updated:
   *                   type: string
   *                   format: date-time
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}/layers:
   *   put:
   *     summary: Update TV layer configuration
   *     description: Updates the complete layer configuration and sends MQTT update to device
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               layers:
   *                 type: object
   *                 description: Layer configurations keyed by layer ID
   *               layer_settings:
   *                 type: object
   *                 description: Global layer settings
   *     responses:
   *       200:
   *         description: Layer configuration updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tv_id:
   *                   type: string
   *                 layers:
   *                   type: object
   *                 layer_settings:
   *                   type: object
   *                 last_updated:
   *                   type: string
   *                   format: date-time
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}/layers/{layerId}:
   *   put:
   *     summary: Update specific TV layer
   *     description: Updates a single layer configuration and sends MQTT update to device
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *       - in: path
   *         name: layerId
   *         required: true
   *         schema:
   *           type: string
   *         description: Layer identifier (e.g., slideshow, overlay)
   *         example: overlay
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             description: Layer configuration properties to update
   *     responses:
   *       200:
   *         description: Layer updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tv_id:
   *                   type: string
   *                 layer_id:
   *                   type: string
   *                 layer:
   *                   type: object
   *                 last_updated:
   *                   type: string
   *                   format: date-time
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}/layers/{layerId}:
   *   delete:
   *     summary: Delete TV layer
   *     description: Removes a layer from TV configuration (slideshow layer cannot be deleted)
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *       - in: path
   *         name: layerId
   *         required: true
   *         schema:
   *           type: string
   *         example: overlay
   *     responses:
   *       204:
   *         description: Layer deleted successfully
   *       400:
   *         description: Cannot delete slideshow layer
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Cannot delete the slideshow layer
   *       404:
   *         description: TV or layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/tvs/{id}/layers/{layerId}/visibility:
   *   put:
   *     summary: Set layer visibility
   *     description: Shows or hides a specific layer on the TV display
   *     tags:
   *       - TVs
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *       - in: path
   *         name: layerId
   *         required: true
   *         schema:
   *           type: string
   *         example: overlay
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - visible
   *             properties:
   *               visible:
   *                 type: boolean
   *                 description: Show or hide the layer
   *                 example: true
   *     responses:
   *       200:
   *         description: Layer visibility updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tv_id:
   *                   type: string
   *                 layer_id:
   *                   type: string
   *                 visible:
   *                   type: boolean
   *                 last_updated:
   *                   type: string
   *                   format: date-time
   *       404:
   *         description: TV or layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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