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

// POST /api/images/:id/assign - Assign image to TVs
router.post('/:id/assign', 
  validate(paramSchemas.id, 'params'),
  validate(imageSchemas.assignment, 'body'),
  async (req, res, next) => {
    try {
      await imageController.assignImageToTvs(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/images/:id/assign/:tvId - Unassign image from specific TV
router.delete('/:id/assign/:tvId', 
  validate(paramSchemas.tvIdAndImageId, 'params'),
  async (req, res, next) => {
    try {
      await imageController.unassignImageFromTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/images/reorder/:tvId - Reorder images for specific TV
router.post('/reorder/:tvId', 
  validate(paramSchemas.tvId, 'params'),
  validate(imageSchemas.reorder, 'body'),
  async (req, res, next) => {
    try {
      await imageController.reorderImagesForTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/images/shuffle/:tvId - Shuffle images for specific TV
router.post('/shuffle/:tvId', 
  validate(paramSchemas.tvId, 'params'),
  async (req, res, next) => {
    try {
      await imageController.shuffleImagesForTv(req, res);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;