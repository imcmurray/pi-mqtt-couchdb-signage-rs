const Joi = require('joi');

// Common validation patterns
const commonPatterns = {
  id: Joi.string().min(1).max(100).required(),
  ipAddress: Joi.string().ip().required(),
  url: Joi.string().uri().optional(),
  timestamp: Joi.string().isoDate().optional(),
  email: Joi.string().email().optional(),
  orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait'),
  transitionEffect: Joi.string().valid('fade', 'slide', 'wipe', 'dissolve'),
  status: Joi.string().valid('active', 'inactive', 'online', 'offline')
};

// Layer validation schemas
const layerSchemas = {
  position: Joi.object({
    x: Joi.number().min(0).required(),
    y: Joi.number().min(0).required(),
    width: Joi.number().min(1).required(),
    height: Joi.number().min(1).required()
  }),
  
  layer: Joi.object({
    enabled: Joi.boolean().default(true),
    position: Joi.object({
      x: Joi.number().min(0).required(),
      y: Joi.number().min(0).required(),
      width: Joi.number().min(1).required(),
      height: Joi.number().min(1).required()
    }).required(),
    priority: Joi.number().min(0).max(255).default(10),
    opacity: Joi.number().min(0).max(1).default(1.0),
    image_path: Joi.string().optional(),
    name: Joi.string().max(100).optional()
  }),
  
  layerConfig: Joi.object({
    slideshow: Joi.object({
      enabled: Joi.boolean().default(true),
      position: Joi.object({
        x: Joi.number().min(0).default(0),
        y: Joi.number().min(0).default(0),
        width: Joi.number().min(1).default(1920),
        height: Joi.number().min(1).default(1080)
      }).default(),
      priority: Joi.number().min(0).max(255).default(1),
      opacity: Joi.number().min(0).max(1).default(1.0)
    }).default(),
    overlay: Joi.object({
      enabled: Joi.boolean().default(false),
      position: Joi.object({
        x: Joi.number().min(0).required(),
        y: Joi.number().min(0).required(),
        width: Joi.number().min(1).required(),
        height: Joi.number().min(1).required()
      }).optional(),
      priority: Joi.number().min(0).max(255).default(10),
      opacity: Joi.number().min(0).max(1).default(0.8),
      image_path: Joi.string().optional(),
      name: Joi.string().max(100).optional()
    }).optional()
  }).unknown(true), // Allow additional custom layers
  
  layerSettings: Joi.object({
    max_layers: Joi.number().min(1).max(50).default(10),
    compositing_timeout_ms: Joi.number().min(1000).max(30000).default(5000),
    cache_composites: Joi.boolean().default(true)
  })
};

// TV validation schemas
const tvSchemas = {
  create: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    location: Joi.string().min(1).max(200).required(),
    ip_address: commonPatterns.ipAddress,
    config: Joi.object({
      transition_effect: commonPatterns.transitionEffect.default('fade'),
      display_duration: Joi.number().min(1000).max(60000).default(5000),
      resolution: Joi.string().pattern(/^\d+x\d+$/).default('1920x1080'),
      orientation: commonPatterns.orientation.default('landscape'),
      layers: layerSchemas.layerConfig.optional(),
      layer_settings: layerSchemas.layerSettings.optional()
    }).default({})
  }),

  update: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    location: Joi.string().min(1).max(200).optional(),
    ip_address: commonPatterns.ipAddress.optional(),
    config: Joi.object({
      transition_effect: commonPatterns.transitionEffect.optional(),
      display_duration: Joi.number().min(1000).max(60000).optional(),
      resolution: Joi.string().pattern(/^\d+x\d+$/).optional(),
      orientation: commonPatterns.orientation.optional(),
      layers: layerSchemas.layerConfig.optional(),
      layer_settings: layerSchemas.layerSettings.optional()
    }).optional()
  }),

  configUpdate: Joi.object({
    transition_effect: commonPatterns.transitionEffect.optional(),
    display_duration: Joi.number().min(1000).max(60000).optional(),
    resolution: Joi.string().pattern(/^\d+x\d+$/).optional(),
    orientation: commonPatterns.orientation.optional(),
    layers: layerSchemas.layerConfig.optional(),
    layer_settings: layerSchemas.layerSettings.optional()
  }).min(1), // At least one field required

  registration: Joi.object({
    tv_id: Joi.string().min(1).max(50).required(),
    hostname: Joi.string().min(1).max(100).required(),
    ip_address: commonPatterns.ipAddress,
    platform: Joi.string().max(50).default('raspberry-pi'),
    version: Joi.string().max(20).default('unknown'),
    orientation: commonPatterns.orientation.default('landscape'),
    layer_support: Joi.boolean().default(true) // Indicates if TV supports layer system
  }),
  
  layerUpdate: Joi.object({
    layer_id: Joi.string().min(1).max(50).required(),
    layer_data: layerSchemas.layer.required()
  }),

  control: Joi.object({
    action: Joi.string().valid('play', 'pause', 'next', 'previous', 'reboot').required()
  })
};

// Image validation schemas
const imageSchemas = {
  update: Joi.object({
    original_name: Joi.string().min(1).max(255).optional(),
    status: commonPatterns.status.optional(),
    metadata: Joi.object({
      description: Joi.string().max(1000).allow('').optional(),
      tags: Joi.array().items(Joi.string().min(1).max(50)).max(20).optional()
    }).optional(),
    schedule: Joi.object({
      start_time: commonPatterns.timestamp.allow(null).optional(),
      end_time: commonPatterns.timestamp.allow(null).optional(),
      days_of_week: Joi.array().items(Joi.number().min(0).max(6)).max(7).optional()
    }).optional()
  }).min(1), // At least one field required

  assignment: Joi.object({
    tv_ids: Joi.array().items(Joi.string().min(1).max(100)).min(1).max(50).required(),
    order: Joi.number().min(0).max(999).default(0)
  }),

  reorder: Joi.object({
    images: Joi.array().items(
      Joi.object({
        image_id: Joi.string().min(1).max(100).required(),
        order: Joi.number().min(0).max(999).required()
      })
    ).min(1).max(100).required()
  }),

  upload: Joi.object({
    description: Joi.string().max(1000).allow('').optional(),
    tags: Joi.string().max(500).optional() // Comma-separated string
  })
};

// Query parameter validation schemas
const querySchemas = {
  images: Joi.object({
    tv_id: Joi.string().min(1).max(100).optional(),
    status: commonPatterns.status.optional(),
    tags: Joi.string().max(200).optional(), // Comma-separated
    limit: Joi.number().min(1).max(100).default(50).optional(),
    offset: Joi.number().min(0).default(0).optional()
  }),

  tvs: Joi.object({
    status: commonPatterns.status.optional(),
    location: Joi.string().max(200).optional(),
    limit: Joi.number().min(1).max(100).default(50).optional(),
    offset: Joi.number().min(0).default(0).optional()
  })
};

// Parameter validation schemas (for URL params)
const paramSchemas = {
  id: Joi.object({
    id: commonPatterns.id
  }),

  tvIdAndImageId: Joi.object({
    id: commonPatterns.id,
    tvId: commonPatterns.id
  }),

  tvIdAndAction: Joi.object({
    id: commonPatterns.id,
    action: Joi.string().valid('play', 'pause', 'next', 'previous', 'reboot').required()
  }),

  tvId: Joi.object({
    tvId: commonPatterns.id
  }),

  status: Joi.object({
    status: commonPatterns.status
  })
};

// Middleware factory for validation
const validate = (schema, target = 'body') => {
  return (req, res, next) => {
    let dataToValidate;
    
    switch (target) {
      case 'body':
        dataToValidate = req.body;
        break;
      case 'query':
        dataToValidate = req.query;
        break;
      case 'params':
        dataToValidate = req.params;
        break;
      default:
        return res.status(500).json({ error: 'Invalid validation target' });
    }

    const { error, value } = schema.validate(dataToValidate, {
      allowUnknown: false,
      stripUnknown: true,
      abortEarly: false
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context.value
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
        timestamp: new Date().toISOString()
      });
    }

    // Replace original data with validated/cleaned data
    switch (target) {
      case 'body':
        req.body = value;
        break;
      case 'query':
        req.query = value;
        break;
      case 'params':
        req.params = value;
        break;
    }

    next();
  };
};

// File upload validation
const fileValidation = {
  validateImageUpload: (req, res, next) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxFiles = 10;

    if (req.files.length > maxFiles) {
      return res.status(400).json({ 
        error: `Too many files. Maximum ${maxFiles} files allowed.` 
      });
    }

    for (const file of req.files) {
      // Check file size
      if (file.size > maxFileSize) {
        return res.status(400).json({ 
          error: `File ${file.originalname} is too large. Maximum size is 10MB.` 
        });
      }

      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({ 
          error: `File ${file.originalname} has invalid type. Only JPEG, PNG, GIF, and WebP are allowed.` 
        });
      }

      // Check filename
      if (!file.originalname || file.originalname.length > 255) {
        return res.status(400).json({ 
          error: `File ${file.originalname} has invalid filename.` 
        });
      }

      // Basic security check - no executable extensions
      const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.scr', '.vbs', '.js', '.jar'];
      const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
      if (dangerousExtensions.includes(fileExtension)) {
        return res.status(400).json({ 
          error: `File ${file.originalname} has a potentially dangerous extension.` 
        });
      }
    }

    next();
  }
};

module.exports = {
  validate,
  tvSchemas,
  imageSchemas,
  querySchemas,
  paramSchemas,
  layerSchemas,
  fileValidation,
  commonPatterns
};