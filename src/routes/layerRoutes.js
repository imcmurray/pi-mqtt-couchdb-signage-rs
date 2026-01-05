const express = require('express');
const router = express.Router();
const layerController = require('../controllers/layerController');
const { asyncHandler } = require('../middleware/errorHandler');

// Layer management routes
router.get('/tvs/:tv_id/layers', asyncHandler(layerController.getLayersByTv));
router.get('/tvs/:tv_id/layers/:layer_id', asyncHandler(layerController.getLayerById));
router.post('/tvs/:tv_id/layers', asyncHandler(layerController.createLayer));
router.put('/tvs/:tv_id/layers/:layer_id', asyncHandler(layerController.updateLayer));
router.delete('/tvs/:tv_id/layers/:layer_id', asyncHandler(layerController.deleteLayer));

// Layer animation routes
router.post('/tvs/:tv_id/layers/:layer_id/animate', asyncHandler(layerController.animateLayer));
router.post('/tvs/:tv_id/layers/:layer_id/visibility', asyncHandler(layerController.toggleLayerVisibility));
router.post('/tvs/:tv_id/layers/:layer_id/move', asyncHandler(layerController.moveLayer));
router.put('/tvs/:tv_id/layers/:layer_id/content', asyncHandler(layerController.updateLayerContent));

// Batch operations
router.post('/tvs/:tv_id/layers/batch', asyncHandler(layerController.batchLayerOperation));

// Animation status
router.get('/tvs/:tv_id/layers/animations/active', asyncHandler(layerController.getActiveAnimations));

// Save layer as template
router.post('/tvs/:tv_id/layers/:layer_id/save-as-template', asyncHandler(layerController.saveLayerAsTemplate));

module.exports = router;