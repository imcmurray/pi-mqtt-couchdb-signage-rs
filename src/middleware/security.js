const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// General API rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Strict rate limiting for authentication/registration endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Very strict rate limiting for file uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Limit each IP to 100 uploads per hour
  message: {
    error: 'Upload limit exceeded, please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// TV registration rate limiting (prevent spam registrations)
const registrationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit each IP to 10 registrations per 5 minutes
  message: {
    error: 'Too many TV registrations from this IP, please try again later.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Progressive delay for repeated requests
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Allow 100 requests per windowMs without delay
  delayMs: () => 500, // Add 500ms delay after delayAfter requests (v2 API)
  maxDelayMs: 20000, // Maximum delay of 20 seconds
});

// API key authentication middleware (basic)
const apiKeyAuth = (req, res, next) => {
  // Skip authentication in development if no API key is set
  if (process.env.NODE_ENV === 'development' && !process.env.API_KEY) {
    return next();
  }

  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    return res.status(500).json({ 
      error: 'Server configuration error: API key not configured' 
    });
  }

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'API key required',
      message: 'Include API key in X-API-Key header or api_key query parameter'
    });
  }

  if (apiKey !== validApiKey) {
    return res.status(401).json({ 
      error: 'Invalid API key' 
    });
  }

  next();
};

// TV token authentication (for TV endpoints to register/communicate)
const tvTokenAuth = (req, res, next) => {
  // Skip authentication in development if no TV token is set
  if (process.env.NODE_ENV === 'development' && !process.env.TV_TOKEN) {
    return next();
  }

  const tvToken = req.headers['x-tv-token'] || req.body.tv_token;
  const validTvToken = process.env.TV_TOKEN;

  if (!validTvToken) {
    return res.status(500).json({ 
      error: 'Server configuration error: TV token not configured' 
    });
  }

  if (!tvToken) {
    return res.status(401).json({ 
      error: 'TV token required',
      message: 'Include TV token in X-TV-Token header or tv_token body parameter'
    });
  }

  if (tvToken !== validTvToken) {
    return res.status(401).json({ 
      error: 'Invalid TV token' 
    });
  }

  next();
};

// Admin authentication for sensitive operations
const adminAuth = (req, res, next) => {
  // Skip authentication in development if no admin key is set
  if (process.env.NODE_ENV === 'development' && !process.env.ADMIN_KEY) {
    return next();
  }

  const adminKey = req.headers['x-admin-key'];
  const validAdminKey = process.env.ADMIN_KEY;

  if (!validAdminKey) {
    return res.status(500).json({ 
      error: 'Server configuration error: Admin key not configured' 
    });
  }

  if (!adminKey) {
    return res.status(401).json({ 
      error: 'Admin authentication required',
      message: 'Include admin key in X-Admin-Key header'
    });
  }

  if (adminKey !== validAdminKey) {
    return res.status(401).json({ 
      error: 'Invalid admin credentials' 
    });
  }

  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Add additional security headers beyond Helmet
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
};

// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, postman, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // In production, check allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',') : [];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200 // Support legacy browsers
};

// IP whitelist for sensitive endpoints
const ipWhitelist = (req, res, next) => {
  const allowedIPs = process.env.ALLOWED_IPS ? 
    process.env.ALLOWED_IPS.split(',') : [];
    
  // Skip IP filtering in development or if no IPs are configured
  if (process.env.NODE_ENV === 'development' || allowedIPs.length === 0) {
    return next();
  }
  
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  
  if (!allowedIPs.includes(clientIP)) {
    return res.status(403).json({ 
      error: 'Access denied from this IP address' 
    });
  }
  
  next();
};

// Request size limiting
const requestSizeLimit = {
  json: '10mb',     // JSON payload limit
  urlencoded: '10mb', // URL-encoded payload limit
  raw: '50mb'       // Raw payload limit (for file uploads)
};

module.exports = {
  // Rate limiters
  generalLimiter,
  strictLimiter,
  uploadLimiter,
  registrationLimiter,
  speedLimiter,
  
  // Authentication middleware
  apiKeyAuth,
  tvTokenAuth,
  adminAuth,
  
  // Security middleware
  securityHeaders,
  corsOptions,
  ipWhitelist,
  requestSizeLimit
};