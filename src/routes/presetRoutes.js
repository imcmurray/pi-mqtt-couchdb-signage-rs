const express = require('express');
const router = express.Router();
const presetController = require('../controllers/presetController');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Preset Routes
 * Zone preset template management endpoints
 */

// Get all presets (built-in + custom)
router.get('/', asyncHandler(presetController.getAllPresets));

// Get most used presets
router.get('/most-used', asyncHandler(presetController.getMostUsed));

// Get presets by category
router.get('/category/:category', asyncHandler(presetController.getPresetsByCategory));

// Get specific preset
router.get('/:id', asyncHandler(presetController.getPresetById));

// Create custom preset
router.post('/', asyncHandler(presetController.createPreset));

// Update custom preset
router.put('/:id', asyncHandler(presetController.updatePreset));

// Delete custom preset
router.delete('/:id', asyncHandler(presetController.deletePreset));

// Clone preset as custom preset
router.post('/:id/clone', asyncHandler(presetController.clonePreset));

// Apply preset to TV
router.post('/apply/:tvId/:presetId', asyncHandler(presetController.applyPresetToTV));

// Save current TV layout as preset
router.post('/save-layout/:tvId', asyncHandler(presetController.saveCurrentLayoutAsPreset));

module.exports = router;
