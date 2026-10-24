const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');
const { upload, handleUploadErrors } = require('../middleware/upload');
const { validate, imageSchemas, paramSchemas, querySchemas, fileValidation } = require('../middleware/validation');
const { uploadLimiter, adminAuth } = require('../middleware/security');

// GET /api/images - Get all images with optional filtering
router.get('/', 
  validate(querySchemas.images, 'query'),
  async (req, res, next) => {
    try {
      await imageController.getAllImages(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/images/:id - Get specific image
router.get('/:id', 
  validate(paramSchemas.id, 'params'),
  async (req, res, next) => {
    try {
      await imageController.getImageById(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/images/:id/attachment - Serve image attachment
router.get('/:id/attachment', 
  validate(paramSchemas.id, 'params'),
  async (req, res, next) => {
    try {
      await imageController.getImageAttachment(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/images/upload - Upload new images
router.post('/upload', 
  uploadLimiter,
  adminAuth,
  upload.array('images', 10), 
  handleUploadErrors,
  fileValidation.validateImageUpload,
  validate(imageSchemas.upload, 'body'),
  async (req, res, next) => {
    try {
      await imageController.uploadImages(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/images/:id - Update image metadata
router.put('/:id', 
  adminAuth,
  validate(paramSchemas.id, 'params'),
  validate(imageSchemas.update, 'body'),
  async (req, res, next) => {
    try {
      await imageController.updateImage(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/images/:id - Delete image
router.delete('/:id', 
  adminAuth,
  validate(paramSchemas.id, 'params'),
  async (req, res, next) => {
    try {
      await imageController.deleteImage(req, res);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;