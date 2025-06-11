const express = require('express');
const router = express.Router();
const path = require('path');
const sharp = require('sharp');
const Image = require('../models/image');
const TV = require('../models/tv');
const mqttService = require('../services/mqttService');
const { upload, handleUploadErrors } = require('../middleware/upload');
const Joi = require('joi');

// Validation schemas
const imageUpdateSchema = Joi.object({
  original_name: Joi.string(),
  status: Joi.string().valid('active', 'inactive'),
  metadata: Joi.object({
    description: Joi.string().allow(''),
    tags: Joi.array().items(Joi.string())
  }),
  schedule: Joi.object({
    start_time: Joi.string().isoDate().allow(null),
    end_time: Joi.string().isoDate().allow(null),
    days_of_week: Joi.array().items(Joi.number().min(0).max(6))
  })
});

const assignmentSchema = Joi.object({
  tv_ids: Joi.array().items(Joi.string()).required(),
  order: Joi.number().min(0).default(0)
});

const reorderSchema = Joi.object({
  images: Joi.array().items(
    Joi.object({
      image_id: Joi.string().required(),
      order: Joi.number().min(0).required()
    })
  ).required()
});

// GET /api/images - Get all images with optional filtering
router.get('/', async (req, res) => {
  try {
    const { tv_id, status, tags } = req.query;
    
    let images;
    if (tv_id) {
      images = await Image.findByTvId(tv_id);
    } else if (status) {
      images = await Image.findByStatus(status);
    } else {
      images = await Image.findAll();
    }

    // Filter by tags if provided
    if (tags) {
      const tagArray = tags.split(',');
      images = images.filter(img => 
        tagArray.some(tag => img.metadata.tags?.includes(tag))
      );
    }

    // Transform response for Rust client compatibility when tv_id is provided
    if (tv_id && images.length > 0) {
      const transformedImages = images.map(img => ({
        id: img._id,
        path: `api/images/${img._id}/attachment`,
        order: img.tv_orders[tv_id] || 0,
        url: `${req.protocol}://${req.get('host')}/api/images/${img._id}/attachment`,
        extension: img.getFileExtension()
      }));
      return res.json(transformedImages);
    }

    res.json(images);
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// GET /api/images/:id - Get specific image
router.get('/:id', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json(image);
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

// GET /api/images/:id/attachment - Serve image attachment
router.get('/:id/attachment', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const imageBuffer = await image.getAttachment();
    
    // Set appropriate headers
    res.set({
      'Content-Type': image.mimetype,
      'Content-Length': imageBuffer.length,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    });
    
    res.send(imageBuffer);
  } catch (error) {
    console.error('Error serving image attachment:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// POST /api/images/upload - Upload new images
router.post('/upload', upload.array('images', 10), handleUploadErrors, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedImages = [];
    
    for (const file of req.files) {
      try {
        // Get image metadata using sharp from buffer
        const metadata = await sharp(file.buffer).metadata();
        
        const image = new Image({
          original_name: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          metadata: {
            width: metadata.width,
            height: metadata.height,
            description: req.body.description || '',
            tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : []
          }
        });

        // Save image with attachment
        await image.saveWithAttachment(file.buffer, file.mimetype);
        uploadedImages.push(image);
        
      } catch (imageError) {
        console.error(`Error processing image ${file.originalname}:`, imageError);
      }
    }

    if (uploadedImages.length === 0) {
      return res.status(400).json({ error: 'Failed to process any uploaded images' });
    }

    res.status(201).json({
      message: `Successfully uploaded ${uploadedImages.length} image(s)`,
      images: uploadedImages
    });

  } catch (error) {
    console.error('Error uploading images:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// PUT /api/images/:id - Update image metadata
router.put('/:id', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const { error, value } = imageUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const updatedImage = await image.update(value);
    res.json(updatedImage);
  } catch (error) {
    console.error('Error updating image:', error);
    res.status(500).json({ error: 'Failed to update image' });
  }
});

// DELETE /api/images/:id - Delete image
router.delete('/:id', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Remove from all assigned TVs via MQTT
    for (const tvId of image.assigned_tvs) {
      try {
        const remainingImages = await Image.findByTvId(tvId);
        const updatedImageList = remainingImages
          .filter(img => img._id !== image._id)
          .map(img => ({
            id: img._id,
            path: `api/images/${img._id}/attachment`,
            order: img.tv_orders[tvId] || 0,
            extension: img.getFileExtension()
          }));
        
        // Get TV document to extract TV ID for MQTT (remove tv_ prefix)
        const tv = await TV.findById(tvId);
        if (tv) {
          await mqttService.updateImages(tv._id.replace('tv_', ''), updatedImageList);
        }
      } catch (mqttError) {
        console.error(`Error updating TV ${tvId} after image deletion:`, mqttError);
      }
    }

    await image.delete();
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// POST /api/images/:id/assign - Assign image to TVs
router.post('/:id/assign', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const { error, value } = assignmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { tv_ids, order } = value;

    // Validate all TV IDs exist
    for (const tvId of tv_ids) {
      const tv = await TV.findById(tvId);
      if (!tv) {
        return res.status(400).json({ error: `TV ${tvId} not found` });
      }
    }

    const updatedImage = await image.bulkAssignToTvs(tv_ids, order);

    // Update TVs via MQTT
    for (const tvId of tv_ids) {
      try {
        const tvImages = await Image.findByTvId(tvId);
        const imageList = tvImages.map(img => ({
          id: img._id,
          path: `api/images/${img._id}/attachment`,
          order: img.tv_orders[tvId] || 0,
          extension: img.getFileExtension()
        }));
        
        if (mqttService.isConnected) {
          // Get TV document to extract TV ID for MQTT (remove tv_ prefix)
          const tv = await TV.findById(tvId);
          if (tv) {
            await mqttService.updateImages(tv._id.replace('tv_', ''), imageList);
          }
        } else {
          console.log(`MQTT not connected, skipping TV ${tvId} update`);
        }
      } catch (mqttError) {
        console.error(`Error updating TV ${tvId}:`, mqttError);
      }
    }

    res.json(updatedImage);
  } catch (error) {
    console.error('Error assigning image to TVs:', error);
    res.status(500).json({ error: 'Failed to assign image to TVs' });
  }
});

// DELETE /api/images/:id/assign/:tvId - Unassign image from specific TV
router.delete('/:id/assign/:tvId', async (req, res) => {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const { tvId } = req.params;
    
    if (!image.assigned_tvs.includes(tvId)) {
      return res.status(400).json({ error: 'Image not assigned to this TV' });
    }

    const updatedImage = await image.unassignFromTv(tvId);

    // Update TV via MQTT
    try {
      const remainingImages = await Image.findByTvId(tvId);
      const imageList = remainingImages.map(img => ({
        id: img._id,
        path: `api/images/${img._id}/attachment`,
        order: img.tv_orders[tvId] || 0,
        extension: img.getFileExtension()
      }));
      
      // Get TV document to extract TV ID for MQTT (remove tv_ prefix)
      const tv = await TV.findById(tvId);
      if (tv) {
        await mqttService.updateImages(tv._id.replace('tv_', ''), imageList);
      }
    } catch (mqttError) {
      console.error(`Error updating TV ${tvId}:`, mqttError);
    }

    res.json(updatedImage);
  } catch (error) {
    console.error('Error unassigning image from TV:', error);
    res.status(500).json({ error: 'Failed to unassign image from TV' });
  }
});

// POST /api/images/reorder/:tvId - Reorder images for specific TV
router.post('/reorder/:tvId', async (req, res) => {
  try {
    const { tvId } = req.params;
    
    // Validate TV exists
    const tv = await TV.findById(tvId);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const { error, value } = reorderSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { images } = value;
    const updatedImages = [];

    // Update order for each image
    for (const { image_id, order } of images) {
      const image = await Image.findById(image_id);
      if (image && image.assigned_tvs.includes(tvId)) {
        const updated = await image.updateOrderForTv(tvId, order);
        updatedImages.push(updated);
      }
    }

    // Send updated order to TV via MQTT
    try {
      const tvImages = await Image.findByTvId(tvId);
      const imageList = tvImages.map(img => ({
        id: img._id,
        path: `api/images/${img._id}/attachment`,
        order: img.tv_orders[tvId] || 0,
        extension: img.getFileExtension()
      }));
      
      // Get TV document to extract TV ID for MQTT (remove tv_ prefix)
      const tv = await TV.findById(tvId);
      if (tv) {
        await mqttService.updateImages(tv._id.replace('tv_', ''), imageList);
      }
    } catch (mqttError) {
      console.error(`Error updating TV ${tvId} order:`, mqttError);
    }

    res.json({
      message: `Reordered ${updatedImages.length} images for TV ${tvId}`,
      images: updatedImages
    });
  } catch (error) {
    console.error('Error reordering images:', error);
    res.status(500).json({ error: 'Failed to reorder images' });
  }
});

// POST /api/images/shuffle/:tvId - Shuffle images for specific TV
router.post('/shuffle/:tvId', async (req, res) => {
  try {
    const { tvId } = req.params;
    
    const tv = await TV.findById(tvId);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }

    const images = await Image.findByTvId(tvId);
    if (images.length === 0) {
      return res.status(400).json({ error: 'No images assigned to this TV' });
    }

    // Shuffle array and assign new orders
    const shuffledImages = [...images].sort(() => Math.random() - 0.5);
    const updatedImages = [];

    for (let i = 0; i < shuffledImages.length; i++) {
      const updated = await shuffledImages[i].updateOrderForTv(tvId, i);
      updatedImages.push(updated);
    }

    // Send updated order to TV via MQTT
    try {
      const imageList = updatedImages.map(img => ({
        id: img._id,
        path: `api/images/${img._id}/attachment`,
        order: img.tv_orders[tvId] || 0,
        extension: img.getFileExtension()
      }));
      
      // Get TV document to extract TV ID for MQTT (remove tv_ prefix)
      const tv = await TV.findById(tvId);
      if (tv) {
        await mqttService.updateImages(tv._id.replace('tv_', ''), imageList);
      }
    } catch (mqttError) {
      console.error(`Error updating TV ${tvId} after shuffle:`, mqttError);
    }

    res.json({
      message: `Shuffled ${updatedImages.length} images for TV ${tvId}`,
      images: updatedImages
    });
  } catch (error) {
    console.error('Error shuffling images:', error);
    res.status(500).json({ error: 'Failed to shuffle images' });
  }
});

module.exports = router;