const sharp = require('sharp');
const Image = require('../models/image');
const TV = require('../models/tv.multilayer');
const mqttService = require('../services/multilayer.mqttService');
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

class ImageController {
  /**
   * @openapi
   * /api/images:
   *   get:
   *     summary: Get all images
   *     description: Returns all images with optional filtering by TV, status, or tags
   *     tags:
   *       - Images
   *     parameters:
   *       - in: query
   *         name: tv_id
   *         schema:
   *           type: string
   *         description: Filter images by TV assignment (returns Rust-compatible format)
   *         example: tv_001
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [active, inactive]
   *         description: Filter images by status
   *       - in: query
   *         name: tags
   *         schema:
   *           type: string
   *         description: Comma-separated tag filter
   *         example: courtroom,header
   *     responses:
   *       200:
   *         description: List of images
   *         content:
   *           application/json:
   *             schema:
   *               oneOf:
   *                 - type: array
   *                   items:
   *                     $ref: '#/components/schemas/Image'
   *                   description: Standard image format
   *                 - type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       path:
   *                         type: string
   *                       order:
   *                         type: integer
   *                       url:
   *                         type: string
   *                       extension:
   *                         type: string
   *                   description: Rust client compatible format (when tv_id provided)
   */
  async getAllImages(req, res) {
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
  }

  /**
   * @openapi
   * /api/images/{id}:
   *   get:
   *     summary: Get image by ID
   *     description: Returns image metadata and assignment information
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Image identifier
   *         example: img_abc123
   *     responses:
   *       200:
   *         description: Image found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Image'
   *       404:
   *         description: Image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getImageById(req, res) {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json(image);
  }

  /**
   * @openapi
   * /api/images/{id}/attachment:
   *   get:
   *     summary: Get image file
   *     description: Returns the actual image file binary data with appropriate caching headers
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: img_abc123
   *     responses:
   *       200:
   *         description: Image file
   *         headers:
   *           Content-Type:
   *             schema:
   *               type: string
   *               example: image/jpeg
   *           Cache-Control:
   *             schema:
   *               type: string
   *               example: public, max-age=31536000
   *         content:
   *           image/jpeg:
   *             schema:
   *               type: string
   *               format: binary
   *           image/png:
   *             schema:
   *               type: string
   *               format: binary
   *       404:
   *         description: Image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getImageAttachment(req, res) {
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
  }

  /**
   * @openapi
   * /api/images/upload:
   *   post:
   *     summary: Upload images
   *     description: Uploads one or more images with automatic metadata extraction using Sharp
   *     tags:
   *       - Images
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - images
   *             properties:
   *               images:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Image files to upload
   *               description:
   *                 type: string
   *                 description: Optional description for all uploaded images
   *               tags:
   *                 type: string
   *                 description: Comma-separated tags for all images
   *                 example: courtroom,header,logo
   *     responses:
   *       201:
   *         description: Images uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Successfully uploaded 3 image(s)
   *                 images:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Image'
   *       400:
   *         description: No files uploaded or processing error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   */
  async uploadImages(req, res) {
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
  }

  /**
   * @openapi
   * /api/images/{id}:
   *   put:
   *     summary: Update image metadata
   *     description: Updates image properties (name, status, tags, schedule)
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: img_abc123
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               original_name:
   *                 type: string
   *               status:
   *                 type: string
   *                 enum: [active, inactive]
   *               metadata:
   *                 type: object
   *                 properties:
   *                   description:
   *                     type: string
   *                   tags:
   *                     type: array
   *                     items:
   *                       type: string
   *               schedule:
   *                 type: object
   *                 properties:
   *                   start_time:
   *                     type: string
   *                     format: date-time
   *                   end_time:
   *                     type: string
   *                     format: date-time
   *                   days_of_week:
   *                     type: array
   *                     items:
   *                       type: integer
   *                       minimum: 0
   *                       maximum: 6
   *     responses:
   *       200:
   *         description: Image updated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Image'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: Image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async updateImage(req, res) {
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
  }

  /**
   * @openapi
   * /api/images/{id}:
   *   delete:
   *     summary: Delete image
   *     description: Deletes image and unassigns from all TVs via MQTT
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: img_abc123
   *     responses:
   *       204:
   *         description: Image deleted successfully
   *       404:
   *         description: Image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async deleteImage(req, res) {
    const image = await Image.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Remove from all assigned TVs via MQTT
    for (const tvId of image.assigned_tvs) {
      try {
        await this._updateTvImageList(tvId, image._id, 'remove');
      } catch (mqttError) {
        console.error(`Error updating TV ${tvId} after image deletion:`, mqttError);
      }
    }

    await image.delete();
    res.status(204).send();
  }

  /**
   * @openapi
   * /api/images/{id}/assign:
   *   post:
   *     summary: Assign image to TVs
   *     description: Assigns image to one or more TV displays and sends MQTT updates
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         example: img_abc123
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - tv_ids
   *             properties:
   *               tv_ids:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Array of TV IDs to assign image to
   *                 example: ["tv_001", "tv_002"]
   *               order:
   *                 type: integer
   *                 minimum: 0
   *                 default: 0
   *                 description: Display order for this image
   *     responses:
   *       200:
   *         description: Image assigned successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Image'
   *       400:
   *         description: Validation error or TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: Image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async assignImageToTvs(req, res) {
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
        await this._updateTvImageList(tvId);
      } catch (mqttError) {
        console.error(`Error updating TV ${tvId}:`, mqttError);
      }
    }

    res.json(updatedImage);
  }

  /**
   * @openapi
   * /api/images/{id}/unassign/{tvId}:
   *   delete:
   *     summary: Unassign image from TV
   *     description: Removes image assignment from a specific TV and sends MQTT update
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Image ID
   *         example: img_abc123
   *       - in: path
   *         name: tvId
   *         required: true
   *         schema:
   *           type: string
   *         description: TV ID to unassign from
   *         example: tv_001
   *     responses:
   *       200:
   *         description: Image unassigned successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Image'
   *       400:
   *         description: Image not assigned to this TV
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: Image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async unassignImageFromTv(req, res) {
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
      await this._updateTvImageList(tvId);
    } catch (mqttError) {
      console.error(`Error updating TV ${tvId}:`, mqttError);
    }

    res.json(updatedImage);
  }

  /**
   * @openapi
   * /api/images/tv/{tvId}/reorder:
   *   put:
   *     summary: Reorder images for TV
   *     description: Sets custom display order for images on a specific TV and sends MQTT update
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: tvId
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - images
   *             properties:
   *               images:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required:
   *                     - image_id
   *                     - order
   *                   properties:
   *                     image_id:
   *                       type: string
   *                       example: img_abc123
   *                     order:
   *                       type: integer
   *                       minimum: 0
   *                       example: 0
   *     responses:
   *       200:
   *         description: Images reordered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Reordered 5 images for TV tv_001
   *                 images:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Image'
   *       400:
   *         description: Validation error
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
   */
  async reorderImagesForTv(req, res) {
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
      await this._updateTvImageList(tvId);
    } catch (mqttError) {
      console.error(`Error updating TV ${tvId} order:`, mqttError);
    }

    res.json({
      message: `Reordered ${updatedImages.length} images for TV ${tvId}`,
      images: updatedImages
    });
  }

  /**
   * @openapi
   * /api/images/tv/{tvId}/shuffle:
   *   post:
   *     summary: Shuffle images for TV
   *     description: Randomly shuffles the display order of images on a specific TV and sends MQTT update
   *     tags:
   *       - Images
   *     parameters:
   *       - in: path
   *         name: tvId
   *         required: true
   *         schema:
   *           type: string
   *         example: tv_001
   *     responses:
   *       200:
   *         description: Images shuffled successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Shuffled 5 images for TV tv_001
   *                 images:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Image'
   *       400:
   *         description: No images assigned to TV
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
   */
  async shuffleImagesForTv(req, res) {
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
      await this._updateTvImageList(tvId);
    } catch (mqttError) {
      console.error(`Error updating TV ${tvId} after shuffle:`, mqttError);
    }

    res.json({
      message: `Shuffled ${updatedImages.length} images for TV ${tvId}`,
      images: updatedImages
    });
  }

  // Private helper method to update TV image list via MQTT
  async _updateTvImageList(tvId, excludeImageId = null) {
    const images = await Image.findByTvId(tvId);
    const imageList = images
      .filter(img => img._id !== excludeImageId)
      .map(img => ({
        id: img._id,
        path: `api/images/${img._id}/attachment`,
        order: img.tv_orders[tvId] || 0,
        extension: img.getFileExtension()
      }));

    console.log(`📋 Updating TV ${tvId} image list: ${imageList.length} images`);

    if (mqttService.connected) {
      const tv = await TV.findById(tvId);
      if (tv) {
        const mqttTvId = tv._id.replace('tv_', '');
        await mqttService.updateImages(mqttTvId, imageList);
      } else {
        console.warn(`⚠️ TV ${tvId} not found in database`);
      }
    } else {
      console.warn(`⚠️ MQTT not connected, skipping update for TV ${tvId}`);
    }
  }
}

module.exports = new ImageController();