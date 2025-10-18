const Preset = require('../models/Preset');
const Layer = require('../models/Layer');
const TV = require('../models/tv.multilayer');
const BUILTIN_PRESETS = require('../config/builtinPresets');
const Joi = require('joi');

/**
 * Preset Controller
 * Handles zone preset template management and application
 */

// Validation schemas
const createPresetSchema = Joi.object({
  name: Joi.string().required().min(3).max(100),
  description: Joi.string().allow('').max(500),
  category: Joi.string().valid('court', 'emergency', 'info', 'layout', 'custom').default('custom'),
  layers: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      layer_type: Joi.string().required().valid('DataRow', 'StaticOverlay', 'Emergency', 'DynamicText'),
      content: Joi.object().required(),
      position: Joi.object({
        x: Joi.number().required().min(0),
        y: Joi.number().required().min(0),
        width: Joi.number().required().min(1),
        height: Joi.number().required().min(1)
      }).required(),
      priority: Joi.number().default(10),
      visible: Joi.boolean().default(true),
      opacity: Joi.number().min(0).max(1).default(1.0),
      tags: Joi.array().items(Joi.string()),
      metadata: Joi.object()
    })
  ).min(1).required(),
  tags: Joi.array().items(Joi.string())
});

const applyPresetSchema = Joi.object({
  override_existing: Joi.boolean().default(false)
});

/**
 * Get all presets (built-in + custom)
 */
async function getAllPresets(req, res) {
  try {
    // Load built-in presets from config
    const builtinPresets = BUILTIN_PRESETS.map(p => new Preset(p));

    // Load custom presets from database
    const customPresets = await Preset.findCustom();

    // Combine and sort by usage
    const allPresets = [...builtinPresets, ...customPresets]
      .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));

    res.json({
      success: true,
      data: allPresets,
      count: allPresets.length,
      builtin_count: builtinPresets.length,
      custom_count: customPresets.length
    });
  } catch (error) {
    console.error('Error getting presets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get preset by ID or preset_id
 */
async function getPresetById(req, res) {
  try {
    const { id } = req.params;

    // Check if it's a built-in preset
    const builtinPreset = BUILTIN_PRESETS.find(p => p.preset_id === id);
    if (builtinPreset) {
      return res.json({
        success: true,
        data: new Preset(builtinPreset)
      });
    }

    // Check database for custom preset
    const preset = await Preset.findByPresetId(id) || await Preset.findById(id);

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    res.json({
      success: true,
      data: preset
    });
  } catch (error) {
    console.error('Error getting preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get presets by category
 */
async function getPresetsByCategory(req, res) {
  try {
    const { category } = req.params;

    // Filter built-in presets
    const builtinPresets = BUILTIN_PRESETS
      .filter(p => p.category === category)
      .map(p => new Preset(p));

    // Filter custom presets
    const customPresets = await Preset.findByCategory(category);

    const allPresets = [...builtinPresets, ...customPresets];

    res.json({
      success: true,
      data: allPresets,
      count: allPresets.length,
      category
    });
  } catch (error) {
    console.error('Error getting presets by category:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Get most used presets
 */
async function getMostUsed(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 5;

    // Get most used custom presets
    const mostUsedCustom = await Preset.findMostUsed(limit * 2);

    // Combine with built-in presets and sort
    const builtinPresets = BUILTIN_PRESETS.map(p => new Preset(p));
    const allPresets = [...builtinPresets, ...mostUsedCustom]
      .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
      .slice(0, limit);

    res.json({
      success: true,
      data: allPresets,
      count: allPresets.length
    });
  } catch (error) {
    console.error('Error getting most used presets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Create custom preset
 */
async function createPreset(req, res) {
  try {
    const { error, value } = createPresetSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    // Validate preset structure
    const validation = Preset.validatePresetStructure(value);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    const preset = new Preset({
      ...value,
      is_builtin: false,
      created_by: 'user'
    });

    await preset.save();

    res.status(201).json({
      success: true,
      data: preset,
      message: 'Preset created successfully'
    });
  } catch (error) {
    console.error('Error creating preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Update custom preset
 */
async function updatePreset(req, res) {
  try {
    const { id } = req.params;

    const preset = await Preset.findByPresetId(id) || await Preset.findById(id);

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    if (preset.is_builtin) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify built-in presets. Clone it to create a custom version.'
      });
    }

    const { error, value } = createPresetSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    await preset.update(value);

    res.json({
      success: true,
      data: preset,
      message: 'Preset updated successfully'
    });
  } catch (error) {
    console.error('Error updating preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Delete custom preset
 */
async function deletePreset(req, res) {
  try {
    const { id } = req.params;

    const preset = await Preset.findByPresetId(id) || await Preset.findById(id);

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    if (preset.is_builtin) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete built-in presets'
      });
    }

    await preset.delete();

    res.json({
      success: true,
      message: 'Preset deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Clone a preset as custom preset
 */
async function clonePreset(req, res) {
  try {
    const { id } = req.params;
    const { name } = req.body;

    // Find original preset (built-in or custom)
    let preset = BUILTIN_PRESETS.find(p => p.preset_id === id);
    if (preset) {
      preset = new Preset(preset);
    } else {
      preset = await Preset.findByPresetId(id) || await Preset.findById(id);
    }

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    const clonedPreset = await preset.clone(name);

    res.status(201).json({
      success: true,
      data: clonedPreset,
      message: 'Preset cloned successfully'
    });
  } catch (error) {
    console.error('Error cloning preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Apply preset to a TV
 */
async function applyPresetToTV(req, res) {
  try {
    const { tvId, presetId } = req.params;
    const { error, value } = applyPresetSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    // Verify TV exists and has layer support
    const tv = await TV.findById(tvId);
    if (!tv) {
      return res.status(404).json({
        success: false,
        error: 'TV not found'
      });
    }

    if (!tv.hasLayerSupport()) {
      return res.status(400).json({
        success: false,
        error: 'TV does not support multi-layer functionality'
      });
    }

    // Find preset
    let preset = BUILTIN_PRESETS.find(p => p.preset_id === presetId);
    if (preset) {
      preset = new Preset(preset);
    } else {
      preset = await Preset.findByPresetId(presetId) || await Preset.findById(presetId);
    }

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    // Get layer configurations from preset
    const layerConfigs = preset.applyToTV(tvId);

    // If override_existing, delete existing layers tagged with 'from-preset'
    if (value.override_existing) {
      const existingLayers = await Layer.findByTv(tvId);
      const presetLayers = existingLayers.filter(layer =>
        layer.tags && layer.tags.includes('from-preset')
      );

      for (const layer of presetLayers) {
        await layer.delete();
      }
    }

    // Create new layers
    const createdLayers = [];
    for (const config of layerConfigs) {
      const layer = new Layer(config);
      await layer.save();
      createdLayers.push(layer);
    }

    // Record preset usage (only if custom preset)
    if (!preset.is_builtin && preset._id) {
      await preset.recordUsage();
    }

    res.json({
      success: true,
      data: {
        preset: preset,
        layers_created: createdLayers.length,
        layers: createdLayers
      },
      message: `Preset "${preset.name}" applied to TV successfully`
    });
  } catch (error) {
    console.error('Error applying preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Save current TV layout as custom preset
 */
async function saveCurrentLayoutAsPreset(req, res) {
  try {
    const { tvId } = req.params;
    const { name, description, category } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Preset name is required'
      });
    }

    // Verify TV exists
    const tv = await TV.findById(tvId);
    if (!tv) {
      return res.status(404).json({
        success: false,
        error: 'TV not found'
      });
    }

    // Get current layers for TV
    const layers = await Layer.findByTv(tvId);

    if (layers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'TV has no layers to save as preset'
      });
    }

    // Convert layers to preset format (strip TV-specific data)
    const presetLayers = layers.map(layer => ({
      name: layer.name,
      layer_type: layer.layer_type,
      content: layer.content,
      position: layer.position,
      priority: layer.priority,
      visible: layer.visible,
      opacity: layer.opacity,
      tags: layer.tags ? layer.tags.filter(tag => !tag.startsWith('preset:')) : [],
      metadata: {}
    }));

    // Create preset
    const preset = new Preset({
      name,
      description: description || `Saved from ${tv.tv_id}`,
      category: category || 'custom',
      layers: presetLayers,
      is_builtin: false,
      created_by: 'user',
      tags: ['saved-layout', `from-tv:${tv.tv_id}`]
    });

    await preset.save();

    res.status(201).json({
      success: true,
      data: preset,
      message: `Current layout saved as preset "${name}"`
    });
  } catch (error) {
    console.error('Error saving layout as preset:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  getAllPresets,
  getPresetById,
  getPresetsByCategory,
  getMostUsed,
  createPreset,
  updatePreset,
  deletePreset,
  clonePreset,
  applyPresetToTV,
  saveCurrentLayoutAsPreset
};
