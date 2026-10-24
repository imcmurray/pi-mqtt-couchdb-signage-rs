const express = require('express');
const router = express.Router();
const sceneController = require('../controllers/sceneController');
const { asyncHandler } = require('../middleware/errorHandler');

// Scenes: designed screens that sequences play as clips
router.get('/', asyncHandler(sceneController.listScenes));
router.get('/starters', asyncHandler(sceneController.listStarters));
router.post('/', asyncHandler(sceneController.createScene));
router.get('/:sceneId', asyncHandler(sceneController.getScene));
router.put('/:sceneId', asyncHandler(sceneController.updateScene));
router.delete('/:sceneId', asyncHandler(sceneController.deleteScene));
router.post('/:sceneId/duplicate', asyncHandler(sceneController.duplicateScene));

// Elements (same shape and routes as Layer Control layers, so one editor serves both)
router.get('/:sceneId/elements', asyncHandler(sceneController.listElements));
router.post('/:sceneId/elements', asyncHandler(sceneController.createElement));
router.put('/:sceneId/elements/:elementId', asyncHandler(sceneController.updateElement));
router.delete('/:sceneId/elements/:elementId', asyncHandler(sceneController.deleteElement));
router.post('/:sceneId/elements/:elementId/move', asyncHandler(sceneController.moveElement));
router.post('/:sceneId/elements/:elementId/visibility', asyncHandler(sceneController.setElementVisibility));

module.exports = router;
