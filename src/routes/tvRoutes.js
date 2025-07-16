const express = require('express');
const router = express.Router();
const Joi = require('joi');
const tvController = require('../controllers/tvController');
const { validate, tvSchemas, paramSchemas, querySchemas, layerSchemas } = require('../middleware/validation');
const { registrationLimiter, strictLimiter, adminAuth, tvTokenAuth } = require('../middleware/security');

// GET /api/tvs - Get all TVs
router.get('/', 
  validate(querySchemas.tvs, 'query'),
  async (req, res, next) => {
    try {
      await tvController.getAllTvs(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/tvs/:id - Get specific TV
router.get('/:id', 
  validate(paramSchemas.id, 'params'),
  async (req, res, next) => {
    try {
      await tvController.getTvById(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/tvs - Create new TV
router.post('/', 
  adminAuth,
  validate(tvSchemas.create, 'body'),
  async (req, res, next) => {
    try {
      await tvController.createTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/tvs/register - Register TV endpoint (for auto-registration)
router.post('/register', 
  registrationLimiter,
  tvTokenAuth,
  validate(tvSchemas.registration, 'body'),
  async (req, res, next) => {
    try {
      await tvController.registerTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/tvs/:id - Update TV
router.put('/:id', 
  adminAuth,
  validate(paramSchemas.id, 'params'),
  validate(tvSchemas.update, 'body'),
  async (req, res, next) => {
    try {
      await tvController.updateTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/tvs/:id - Delete TV
router.delete('/:id', 
  adminAuth,
  validate(paramSchemas.id, 'params'),
  async (req, res, next) => {
    try {
      await tvController.deleteTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/tvs/:id/control/:action - Control TV slideshow
router.post('/:id/control/:action', 
  strictLimiter,
  validate(paramSchemas.tvIdAndAction, 'params'),
  async (req, res, next) => {
    try {
      await tvController.controlTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/tvs/:id/config - Update TV configuration
router.put('/:id/config', 
  validate(paramSchemas.id, 'params'),
  validate(tvSchemas.configUpdate, 'body'),
  async (req, res, next) => {
    try {
      await tvController.updateTvConfig(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/tvs/status/:status - Get TVs by status
router.get('/status/:status', 
  validate(paramSchemas.status, 'params'),
  async (req, res, next) => {
    try {
      await tvController.getTvsByStatus(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// Layer management endpoints (Phase 2)

// GET /api/tvs/:id/layers - Get layer configuration
router.get('/:id/layers', 
  validate(paramSchemas.id, 'params'),
  async (req, res, next) => {
    try {
      await tvController.getTvLayers(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/tvs/:id/layers - Update layer configuration
router.put('/:id/layers', 
  validate(paramSchemas.id, 'params'),
  validate(layerSchemas.layerConfig, 'body'),
  async (req, res, next) => {
    try {
      await tvController.updateTvLayers(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/tvs/:id/layers/:layerId - Add or update specific layer
router.post('/:id/layers/:layerId', 
  validate(Joi.object({
    id: paramSchemas.id.extract('id'),
    layerId: Joi.string().min(1).max(50).required()
  }), 'params'),
  validate(layerSchemas.layer, 'body'),
  async (req, res, next) => {
    try {
      await tvController.updateTvLayer(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/tvs/:id/layers/:layerId - Remove specific layer
router.delete('/:id/layers/:layerId', 
  validate(Joi.object({
    id: paramSchemas.id.extract('id'),
    layerId: Joi.string().min(1).max(50).required()
  }), 'params'),
  async (req, res, next) => {
    try {
      await tvController.deleteTvLayer(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/tvs/:id/layers/:layerId/visibility - Toggle layer visibility
router.post('/:id/layers/:layerId/visibility', 
  validate(Joi.object({
    id: paramSchemas.id.extract('id'),
    layerId: Joi.string().min(1).max(50).required()
  }), 'params'),
  validate(Joi.object({
    visible: Joi.boolean().required()
  }), 'body'),
  async (req, res, next) => {
    try {
      await tvController.setTvLayerVisibility(req, res);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;