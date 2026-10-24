const sharp = require('sharp');
const Image = require('../models/image');
const mqttService = require('../services/multilayer.mqttService');
const Joi = require('joi');
const { imageSchemas } = require('../middleware/validation');

// Resized thumbnails served via /api/images/:id/attachment?width=N, cached in
// memory by id + revision (oldest evicted first)
const THUMBNAIL_WIDTHS = [160, 400, 960];
const THUMBNAIL_CACHE_MAX = 500;
const thumbnailCache = new Map();

// Validation schemas
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
      const transformedImages = images.filter(img => img.isEnabledForTv(tv_id)).map(img => ({
        id: img._id,
        path: `api/images/${img._id}/attachment`,
        order: img.getOrderForTv(tv_id),
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

    // Optional ?width= returns a resized thumbnail for grids/cards: JPEG, or PNG
    // when the image has transparency (e.g. a seal or logo)
    const width = THUMBNAIL_WIDTHS.includes(Number(req.query.width)) ? Number(req.query.width) : null;
    const thumbKey = width && `${image._id}:${image._rev}:${width}`;

    let thumbnail = thumbKey && thumbnailCache.get(thumbKey);
    let imageBuffer = thumbnail?.buffer;
    if (!imageBuffer) {
      imageBuffer = await image.getAttachment();
      if (width) {
        const source = sharp(imageBuffer).rotate();
        const { hasAlpha } = await source.metadata();
        const resized = source.resize({ width, withoutEnlargement: true });
        imageBuffer = await (hasAlpha ? resized.png() : resized.jpeg({ quality: 80 })).toBuffer();
        thumbnail = { buffer: imageBuffer, type: hasAlpha ? 'image/png' : 'image/jpeg' };
        if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
          thumbnailCache.delete(thumbnailCache.keys().next().value);
        }
        thumbnailCache.set(thumbKey, thumbnail);
      }
    }

    // Set appropriate headers
    res.set({
      'Content-Type': thumbnail ? thumbnail.type : image.mimetype,
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

    const { error, value } = imageSchemas.update.validate(req.body);
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

    // Take it out of every sequence; those TVs re-read their sequence
    const sequenceService = require('../services/sequenceService');
    for (const tvId of await sequenceService.removeRef(image._id)) {
      mqttService.syncLayers(tvId);
    }

    await image.delete();
    res.status(204).send();
  }

}

module.exports = new ImageController();