const TV = require('../models/tv.multilayer');
const Layer = require('../models/Layer');
const Preset = require('../models/Preset');
const mqttService = require('../services/multilayer.mqttService');
const Joi = require('joi');

/**
 * Bulk Operations Controller
 * Handles multi-TV operations and batch management
 */

// Validation schemas
const bulkTVUpdateSchema = Joi.object({
  tv_ids: Joi.array().items(Joi.string()).min(1).required(),
  updates: Joi.object().required(),
  operation: Joi.string().valid('update_config', 'apply_preset', 'send_command').required()
});

const locationOperationSchema = Joi.object({
  location: Joi.string().required(),
  operation: Joi.string().valid('apply_preset', 'create_layer', 'delete_layers', 'send_command').required(),
  data: Joi.object().required()
});

const bulkLayerSchema = Joi.object({
  tv_ids: Joi.array().items(Joi.string()).min(1).required(),
  layer_config: Joi.object().required()
});

const bulkCommandSchema = Joi.object({
  tv_ids: Joi.array().items(Joi.string()).min(1).required(),
  command: Joi.string().required().valid('play', 'pause', 'next', 'previous', 'reboot', 'refresh_layers')
});

/**
 * @openapi
 * /api/bulk/grid:
 *   get:
 *     summary: Get multi-TV grid view
 *     description: Returns comprehensive grid view data for all TVs with layer information and location grouping
 *     tags:
 *       - Bulk Operations
 *     responses:
 *       200:
 *         description: Grid view data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     tvs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                             example: tv-001
 *                           _id:
 *                             type: string
 *                           location:
 *                             type: string
 *                             example: Courtroom 1
 *                           status:
 *                             type: string
 *                             enum: [online, offline, unknown]
 *                           orientation:
 *                             type: string
 *                             enum: [landscape, portrait]
 *                           has_layer_support:
 *                             type: boolean
 *                           layer_count:
 *                             type: integer
 *                           active_layer_count:
 *                             type: integer
 *                           last_heartbeat:
 *                             type: string
 *                             format: date-time
 *                           is_online:
 *                             type: boolean
 *                           current_image:
 *                             type: string
 *                     by_location:
 *                       type: object
 *                       description: TVs grouped by location
 *                       additionalProperties:
 *                         type: array
 *                         items:
 *                           type: object
 *                     total_count:
 *                       type: integer
 *                     online_count:
 *                       type: integer
 *                     layer_support_count:
 *                       type: integer
 */
async function getGridView(req, res) {
  try {
    const tvs = await TV.findAll();

    const gridData = await Promise.all(tvs.map(async (tv) => {
      const layers = tv.hasLayerSupport() ? await Layer.findByTv(tv._id) : [];

      return {
        tv_id: tv.tv_id,
        _id: tv._id,
        location: tv.location || 'Unknown',
        status: tv.status || 'unknown',
        orientation: tv.orientation,
        has_layer_support: tv.hasLayerSupport(),
        layer_count: layers.length,
        active_layer_count: layers.filter(l => l.visible).length,
        last_heartbeat: tv.last_heartbeat,
        is_online: tv.isOnline ? tv.isOnline() : false,
        current_image: tv.current_image
      };
    }));

    // Group by location
    const byLocation = {};
    gridData.forEach(tv => {
      const loc = tv.location || 'Unknown';
      if (!byLocation[loc]) {
        byLocation[loc] = [];
      }
      byLocation[loc].push(tv);
    });

    res.json({
      success: true,
      data: {
        tvs: gridData,
        by_location: byLocation,
        total_count: gridData.length,
        online_count: gridData.filter(tv => tv.is_online).length,
        layer_support_count: gridData.filter(tv => tv.has_layer_support).length
      }
    });
  } catch (error) {
    console.error('Error getting grid view:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * @openapi
 * /api/bulk/update:
 *   post:
 *     summary: Bulk update multiple TVs
 *     description: Performs batch updates on multiple TVs with a single request. Supports configuration updates, preset application, and command sending.
 *     tags:
 *       - Bulk Operations
 *     security:
 *       - AdminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tv_ids
 *               - updates
 *               - operation
 *             properties:
 *               tv_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 description: Array of TV IDs to update
 *                 example: ["tv-001", "tv-002", "tv-003"]
 *               operation:
 *                 type: string
 *                 enum: [update_config, apply_preset, send_command]
 *                 description: Type of operation to perform
 *               updates:
 *                 type: object
 *                 description: Operation-specific data
 *                 example:
 *                   name: "Updated Name"
 *                   location: "New Location"
 *     responses:
 *       200:
 *         description: Bulk update completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                           message:
 *                             type: string
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                           error:
 *                             type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     succeeded:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
async function bulkUpdateTVs(req, res) {
  try {
    const { error, value } = bulkTVUpdateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { tv_ids, updates, operation } = value;

    const results = {
      success: [],
      failed: []
    };

    for (const tvId of tv_ids) {
      try {
        const tv = await TV.findById(tvId);

        if (!tv) {
          results.failed.push({ tv_id: tvId, error: 'TV not found' });
          continue;
        }

        switch (operation) {
          case 'update_config':
            await tv.update(updates);
            results.success.push({ tv_id: tvId, message: 'Config updated' });
            break;

          case 'apply_preset':
            if (!tv.hasLayerSupport()) {
              results.failed.push({ tv_id: tvId, error: 'TV does not support layers' });
              continue;
            }
            // Preset application handled separately
            results.success.push({ tv_id: tvId, message: 'Ready for preset' });
            break;

          case 'send_command':
            if (mqttService.isConnected()) {
              await mqttService.publishCommand(tv.tv_id, updates.command, updates.params || {});
              results.success.push({ tv_id: tvId, message: 'Command sent' });
            } else {
              results.failed.push({ tv_id: tvId, error: 'MQTT not connected' });
            }
            break;

          default:
            results.failed.push({ tv_id: tvId, error: 'Unknown operation' });
        }
      } catch (err) {
        results.failed.push({ tv_id: tvId, error: err.message });
      }
    }

    res.json({
      success: true,
      data: results,
      summary: {
        total: tv_ids.length,
        succeeded: results.success.length,
        failed: results.failed.length
      }
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * @openapi
 * /api/bulk/location:
 *   post:
 *     summary: Location-based batch operation
 *     description: Applies an operation to all TVs in a specific location. Supports preset application, layer creation/deletion, and command broadcasting.
 *     tags:
 *       - Bulk Operations
 *     security:
 *       - AdminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - location
 *               - operation
 *               - data
 *             properties:
 *               location:
 *                 type: string
 *                 description: Location name to target
 *                 example: Courtroom 1
 *               operation:
 *                 type: string
 *                 enum: [apply_preset, create_layer, delete_layers, send_command]
 *                 description: Operation to perform on all TVs in location
 *               data:
 *                 type: object
 *                 description: Operation-specific parameters
 *                 example:
 *                   preset_id: "court-basic-3zone"
 *     responses:
 *       200:
 *         description: Location operation completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: array
 *                       items:
 *                         type: object
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                 summary:
 *                   type: object
 *                   properties:
 *                     location:
 *                       type: string
 *                     total_tvs:
 *                       type: integer
 *                     succeeded:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: No TVs found in location
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
async function locationOperation(req, res) {
  try {
    const { error, value } = locationOperationSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { location, operation, data } = value;

    // Find all TVs in this location
    const allTVs = await TV.findAll();
    const locationTVs = allTVs.filter(tv => tv.location === location);

    if (locationTVs.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No TVs found in location "${location}"`
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const tv of locationTVs) {
      try {
        switch (operation) {
          case 'apply_preset':
            if (!tv.hasLayerSupport()) {
              results.failed.push({ tv_id: tv.tv_id, error: 'No layer support' });
              continue;
            }

            const preset = await Preset.findByPresetId(data.preset_id);
            if (!preset) {
              results.failed.push({ tv_id: tv.tv_id, error: 'Preset not found' });
              continue;
            }

            const layerConfigs = preset.applyToTV(tv._id);
            for (const config of layerConfigs) {
              const layer = new Layer(config);
              await layer.save();
            }

            results.success.push({ tv_id: tv.tv_id, layers_created: layerConfigs.length });
            break;

          case 'create_layer':
            if (!tv.hasLayerSupport()) {
              results.failed.push({ tv_id: tv.tv_id, error: 'No layer support' });
              continue;
            }

            const layer = new Layer({ ...data.layer_config, tv_id: tv._id });
            await layer.save();
            results.success.push({ tv_id: tv.tv_id, layer_id: layer.layer_id });
            break;

          case 'delete_layers':
            if (!tv.hasLayerSupport()) {
              results.failed.push({ tv_id: tv.tv_id, error: 'No layer support' });
              continue;
            }

            const layers = await Layer.findByTv(tv._id);
            const tag = data.tag;
            const layersToDelete = tag
              ? layers.filter(l => l.tags && l.tags.includes(tag))
              : layers;

            for (const l of layersToDelete) {
              await l.delete();
            }

            results.success.push({ tv_id: tv.tv_id, layers_deleted: layersToDelete.length });
            break;

          case 'send_command':
            if (mqttService.isConnected()) {
              await mqttService.publishCommand(tv.tv_id, data.command, data.params || {});
              results.success.push({ tv_id: tv.tv_id, command: data.command });
            } else {
              results.failed.push({ tv_id: tv.tv_id, error: 'MQTT not connected' });
            }
            break;

          default:
            results.failed.push({ tv_id: tv.tv_id, error: 'Unknown operation' });
        }
      } catch (err) {
        results.failed.push({ tv_id: tv.tv_id, error: err.message });
      }
    }

    res.json({
      success: true,
      data: results,
      summary: {
        location,
        total_tvs: locationTVs.length,
        succeeded: results.success.length,
        failed: results.failed.length
      }
    });
  } catch (error) {
    console.error('Error in location operation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * @openapi
 * /api/bulk/layer:
 *   post:
 *     summary: Bulk create layer
 *     description: Creates the same layer configuration on multiple TVs simultaneously
 *     tags:
 *       - Bulk Operations
 *     security:
 *       - AdminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tv_ids
 *               - layer_config
 *             properties:
 *               tv_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 description: Array of TV IDs to create layer on
 *                 example: ["tv-001", "tv-002", "tv-003"]
 *               layer_config:
 *                 type: object
 *                 description: Layer configuration to apply
 *                 properties:
 *                   name:
 *                     type: string
 *                     example: Emergency Alert
 *                   type:
 *                     type: string
 *                     enum: [image, text, video]
 *                   position:
 *                     $ref: '#/components/schemas/Position'
 *                   visible:
 *                     type: boolean
 *                     default: true
 *                   z_index:
 *                     type: integer
 *                     minimum: 0
 *                     maximum: 100
 *                     default: 10
 *     responses:
 *       200:
 *         description: Bulk layer creation completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                           layer_id:
 *                             type: string
 *                           message:
 *                             type: string
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                           error:
 *                             type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     succeeded:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
async function bulkCreateLayer(req, res) {
  try {
    const { error, value } = bulkLayerSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { tv_ids, layer_config } = value;

    const results = {
      success: [],
      failed: []
    };

    for (const tvId of tv_ids) {
      try {
        const tv = await TV.findById(tvId);

        if (!tv) {
          results.failed.push({ tv_id: tvId, error: 'TV not found' });
          continue;
        }

        if (!tv.hasLayerSupport()) {
          results.failed.push({ tv_id: tvId, error: 'TV does not support layers' });
          continue;
        }

        const layer = new Layer({ ...layer_config, tv_id: tvId });
        await layer.save();

        results.success.push({
          tv_id: tvId,
          layer_id: layer.layer_id,
          message: 'Layer created'
        });
      } catch (err) {
        results.failed.push({ tv_id: tvId, error: err.message });
      }
    }

    res.json({
      success: true,
      data: results,
      summary: {
        total: tv_ids.length,
        succeeded: results.success.length,
        failed: results.failed.length
      }
    });
  } catch (error) {
    console.error('Error in bulk layer creation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * @openapi
 * /api/bulk/command:
 *   post:
 *     summary: Bulk send command
 *     description: Sends the same control command to multiple TVs via MQTT
 *     tags:
 *       - Bulk Operations
 *     security:
 *       - AdminAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tv_ids
 *               - command
 *             properties:
 *               tv_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 description: Array of TV IDs to send command to
 *                 example: ["tv-001", "tv-002", "tv-003"]
 *               command:
 *                 type: string
 *                 enum: [play, pause, next, previous, reboot, refresh_layers]
 *                 description: Command to send to all specified TVs
 *                 example: pause
 *     responses:
 *       200:
 *         description: Commands sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                           command:
 *                             type: string
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tv_id:
 *                             type: string
 *                           error:
 *                             type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     command:
 *                       type: string
 *                     total:
 *                       type: integer
 *                     succeeded:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       503:
 *         description: MQTT service unavailable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
async function bulkSendCommand(req, res) {
  try {
    const { error, value } = bulkCommandSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { tv_ids, command } = value;

    if (!mqttService.isConnected()) {
      return res.status(503).json({
        success: false,
        error: 'MQTT service not connected'
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const tvId of tv_ids) {
      try {
        const tv = await TV.findById(tvId);

        if (!tv) {
          results.failed.push({ tv_id: tvId, error: 'TV not found' });
          continue;
        }

        await mqttService.publishCommand(tv.tv_id, command, {});
        results.success.push({ tv_id: tvId, command });
      } catch (err) {
        results.failed.push({ tv_id: tvId, error: err.message });
      }
    }

    res.json({
      success: true,
      data: results,
      summary: {
        command,
        total: tv_ids.length,
        succeeded: results.success.length,
        failed: results.failed.length
      }
    });
  } catch (error) {
    console.error('Error sending bulk command:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * @openapi
 * /api/bulk/locations:
 *   get:
 *     summary: Get all locations
 *     description: Returns all unique TV locations with statistics for each location
 *     tags:
 *       - Bulk Operations
 *     responses:
 *       200:
 *         description: Location list with statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       location:
 *                         type: string
 *                         example: Courtroom 1
 *                       tv_count:
 *                         type: integer
 *                         description: Total TVs in this location
 *                       layer_support_count:
 *                         type: integer
 *                         description: TVs with layer support
 *                       online_count:
 *                         type: integer
 *                         description: Currently online TVs
 *                 count:
 *                   type: integer
 *                   description: Total number of unique locations
 */
async function getLocations(req, res) {
  try {
    const tvs = await TV.findAll();
    const locations = [...new Set(tvs.map(tv => tv.location || 'Unknown'))].sort();

    const locationStats = locations.map(loc => {
      const tvsInLocation = tvs.filter(tv => (tv.location || 'Unknown') === loc);
      return {
        location: loc,
        tv_count: tvsInLocation.length,
        layer_support_count: tvsInLocation.filter(tv => tv.hasLayerSupport()).length,
        online_count: tvsInLocation.filter(tv => tv.isOnline && tv.isOnline()).length
      };
    });

    res.json({
      success: true,
      data: locationStats,
      count: locations.length
    });
  } catch (error) {
    console.error('Error getting locations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  getGridView,
  bulkUpdateTVs,
  locationOperation,
  bulkCreateLayer,
  bulkSendCommand,
  getLocations
};
