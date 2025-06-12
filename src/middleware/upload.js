const multer = require('multer');

// Use memory storage instead of disk storage for CouchDB attachments
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 10 // Maximum 10 files per request
  },
  fileFilter: fileFilter
});

// Error handling middleware
const handleUploadErrors = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({ 
          error: 'File too large', 
          message: `Maximum file size is ${(parseInt(process.env.MAX_FILE_SIZE) || 10485760) / 1024 / 1024}MB` 
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ 
          error: 'Too many files', 
          message: 'Maximum 10 files allowed per upload' 
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ 
          error: 'Unexpected field', 
          message: 'Unexpected file field in upload' 
        });
      default:
        return res.status(400).json({ 
          error: 'Upload error', 
          message: error.message 
        });
    }
  } else if (error) {
    return res.status(400).json({ 
      error: 'Upload error', 
      message: error.message 
    });
  }
  next();
};

module.exports = {
  upload,
  handleUploadErrors
};