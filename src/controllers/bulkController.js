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
 * Get multi-TV grid view data
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
 * Bulk update multiple TVs
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
 * Apply operation to all TVs in a location
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
 * Create same layer on multiple TVs
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
 * Send command to multiple TVs
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
 * Get all unique locations
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
