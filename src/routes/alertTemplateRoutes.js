const express = require('express');
const router = express.Router();
const alertTemplateController = require('../controllers/alertTemplateController');
const { asyncHandler } = require('../middleware/errorHandler');

// Get template statistics (must be before /:templateId routes)
router.get('/stats', asyncHandler(alertTemplateController.getTemplateStats));

// Search templates
router.get('/search', asyncHandler(alertTemplateController.searchTemplates));

// Get all templates (with optional filters)
router.get('/', asyncHandler(alertTemplateController.getAllTemplates));

// Create custom template
router.post('/', asyncHandler(alertTemplateController.createTemplate));

// Get template by ID
router.get('/:templateId', asyncHandler(alertTemplateController.getTemplateById));

// Update custom template
router.put('/:templateId', asyncHandler(alertTemplateController.updateTemplate));

// Delete custom template
router.delete('/:templateId', asyncHandler(alertTemplateController.deleteTemplate));

// Send alert from template (quick-send)
router.post('/:templateId/send', asyncHandler(alertTemplateController.sendFromTemplate));

// Preview template rendering
router.post('/:templateId/preview', asyncHandler(alertTemplateController.previewTemplate));

// Duplicate template
router.post('/:templateId/duplicate', asyncHandler(alertTemplateController.duplicateTemplate));

module.exports = router;
