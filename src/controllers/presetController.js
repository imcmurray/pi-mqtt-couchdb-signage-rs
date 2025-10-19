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
 * @openapi
 * /api/presets:
 *   get:
 *     summary: Get all zone presets
 *     description: Returns all built-in and custom zone preset templates, sorted by usage count
 *     tags:
 *       - Presets
 *     responses:
 *       200:
 *         description: List of all presets
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
 *                     $ref: '#/components/schemas/Preset'
 *                 count:
 *                   type: integer
 *                   description: Total number of presets
 *                   example: 12
 *                 builtin_count:
 *                   type: integer
 *                   description: Number of built-in presets
 *                   example: 8
 *                 custom_count:
 *                   type: integer
 *                   description: Number of custom presets
 *                   example: 4
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/{id}:
 *   get:
 *     summary: Get preset by ID
 *     description: Returns a specific preset by its ID or preset_id (supports both built-in and custom presets)
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Preset ID or preset_id
 *         example: court-basic-3zone
 *     responses:
 *       200:
 *         description: Preset found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Preset'
 *       404:
 *         description: Preset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/category/{category}:
 *   get:
 *     summary: Get presets by category
 *     description: Returns all presets (built-in and custom) filtered by category
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *           enum: [court, emergency, info, layout, custom]
 *         description: Preset category to filter by
 *         example: court
 *     responses:
 *       200:
 *         description: List of presets in category
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
 *                     $ref: '#/components/schemas/Preset'
 *                 count:
 *                   type: integer
 *                   example: 5
 *                 category:
 *                   type: string
 *                   example: court
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/most-used:
 *   get:
 *     summary: Get most used presets
 *     description: Returns the most frequently used presets sorted by usage count
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of presets to return
 *         example: 10
 *     responses:
 *       200:
 *         description: List of most used presets
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
 *                     $ref: '#/components/schemas/Preset'
 *                 count:
 *                   type: integer
 *                   example: 5
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets:
 *   post:
 *     summary: Create custom preset
 *     description: Creates a new custom zone preset template with layer configurations
 *     tags:
 *       - Presets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - layers
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *                 description: Preset name
 *                 example: My Custom Court Layout
 *               description:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional description
 *                 example: 3-zone layout for main courtroom displays
 *               category:
 *                 type: string
 *                 enum: [court, emergency, info, layout, custom]
 *                 default: custom
 *                 example: custom
 *               layers:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - name
 *                     - layer_type
 *                     - content
 *                     - position
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: Top Header
 *                     layer_type:
 *                       type: string
 *                       enum: [DataRow, StaticOverlay, Emergency, DynamicText]
 *                       example: StaticOverlay
 *                     content:
 *                       type: object
 *                       description: Layer-specific content configuration
 *                     position:
 *                       $ref: '#/components/schemas/Position'
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: [courtroom, header]
 *     responses:
 *       201:
 *         description: Preset created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Preset'
 *                 message:
 *                   type: string
 *                   example: Preset created successfully
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/{id}:
 *   put:
 *     summary: Update custom preset
 *     description: Updates an existing custom preset (built-in presets cannot be modified)
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Preset ID
 *         example: custom-preset-123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - layers
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *               description:
 *                 type: string
 *                 maxLength: 500
 *               category:
 *                 type: string
 *                 enum: [court, emergency, info, layout, custom]
 *               layers:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Preset updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Preset'
 *                 message:
 *                   type: string
 *                   example: Preset updated successfully
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       403:
 *         description: Cannot modify built-in preset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: Cannot modify built-in presets. Clone it to create a custom version.
 *       404:
 *         description: Preset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/{id}:
 *   delete:
 *     summary: Delete custom preset
 *     description: Deletes a custom preset (built-in presets cannot be deleted)
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Preset ID
 *         example: custom-preset-123
 *     responses:
 *       200:
 *         description: Preset deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Preset deleted successfully
 *       403:
 *         description: Cannot delete built-in preset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: Cannot delete built-in presets
 *       404:
 *         description: Preset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/{id}/clone:
 *   post:
 *     summary: Clone preset as custom
 *     description: Creates a custom copy of an existing preset (built-in or custom) with optional new name
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Preset ID to clone
 *         example: court-basic-3zone
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name for cloned preset (auto-generated if not provided)
 *                 example: My Custom Court Layout
 *     responses:
 *       201:
 *         description: Preset cloned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Preset'
 *                 message:
 *                   type: string
 *                   example: Preset cloned successfully
 *       404:
 *         description: Preset not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/{presetId}/apply/{tvId}:
 *   post:
 *     summary: Apply preset to TV
 *     description: Applies a preset's layer configuration to a specific TV, creating new layers. Optionally removes existing preset-based layers first.
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: presetId
 *         required: true
 *         schema:
 *           type: string
 *         description: Preset ID to apply
 *         example: court-basic-3zone
 *       - in: path
 *         name: tvId
 *         required: true
 *         schema:
 *           type: string
 *         description: TV ID to apply preset to
 *         example: tv-001
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               override_existing:
 *                 type: boolean
 *                 default: false
 *                 description: If true, removes existing layers tagged with 'from-preset' before applying
 *                 example: true
 *     responses:
 *       200:
 *         description: Preset applied successfully
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
 *                     preset:
 *                       $ref: '#/components/schemas/Preset'
 *                     layers_created:
 *                       type: integer
 *                       example: 3
 *                     layers:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Layer'
 *                 message:
 *                   type: string
 *                   example: Preset "Court Basic 3-Zone" applied to TV successfully
 *       400:
 *         description: Validation error or TV does not support layers
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Preset or TV not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @openapi
 * /api/presets/save-layout/{tvId}:
 *   post:
 *     summary: Save TV layout as preset
 *     description: Creates a new custom preset from the current layer configuration of a TV
 *     tags:
 *       - Presets
 *     parameters:
 *       - in: path
 *         name: tvId
 *         required: true
 *         schema:
 *           type: string
 *         description: TV ID whose layout to save
 *         example: tv-001
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name for the new preset
 *                 example: Main Courtroom Custom Layout
 *               description:
 *                 type: string
 *                 description: Optional description (auto-generated if not provided)
 *                 example: Custom layout saved from main courtroom display
 *               category:
 *                 type: string
 *                 enum: [court, emergency, info, layout, custom]
 *                 default: custom
 *                 example: custom
 *     responses:
 *       201:
 *         description: Layout saved as preset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Preset'
 *                 message:
 *                   type: string
 *                   example: Current layout saved as preset "Main Courtroom Custom Layout"
 *       400:
 *         description: Validation error or TV has no layers
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
