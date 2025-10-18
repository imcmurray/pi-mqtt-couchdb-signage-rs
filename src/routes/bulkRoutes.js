const express = require('express');
const router = express.Router();
const bulkController = require('../controllers/bulkController');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Bulk Operations Routes
 * Multi-TV and batch management endpoints
 */

// Get multi-TV grid view
router.get('/grid-view', asyncHandler(bulkController.getGridView));

// Get all locations
router.get('/locations', asyncHandler(bulkController.getLocations));

// Bulk update multiple TVs
router.post('/tvs/update', asyncHandler(bulkController.bulkUpdateTVs));

// Apply operation to all TVs in a location
router.post('/location/operation', asyncHandler(bulkController.locationOperation));

// Create layer on multiple TVs
router.post('/layers/create', asyncHandler(bulkController.bulkCreateLayer));

// Send command to multiple TVs
router.post('/command', asyncHandler(bulkController.bulkSendCommand));

module.exports = router;
