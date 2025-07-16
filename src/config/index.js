require('dotenv').config();

// Environment validation helper
const getEnvVar = (name, defaultValue = null, required = false) => {
  const value = process.env[name];
  
  if (required && !value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  
  return value || defaultValue;
};

// Parse boolean environment variables
const parseBoolean = (value, defaultValue = false) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return defaultValue;
};

// Parse integer environment variables
const parseInteger = (value, defaultValue = 0) => {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Parse array from comma-separated string
const parseArray = (value, defaultValue = []) => {
  if (!value) return defaultValue;
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
};

const config = {
  // Server configuration
  server: {
    port: parseInteger(getEnvVar('PORT'), 3000),
    host: getEnvVar('HOST', '0.0.0.0'),
    environment: getEnvVar('NODE_ENV', 'development'),
    shutdownTimeout: parseInteger(getEnvVar('SHUTDOWN_TIMEOUT'), 10000)
  },

  // Database configuration
  database: {
    url: getEnvVar('COUCHDB_URL', 'http://localhost:5984'),
    name: getEnvVar('COUCHDB_NAME', 'digital_signage'),
    username: getEnvVar('COUCHDB_USERNAME'),
    password: getEnvVar('COUCHDB_PASSWORD'),
    maxRetries: parseInteger(getEnvVar('DB_MAX_RETRIES'), 3),
    retryDelay: parseInteger(getEnvVar('DB_RETRY_DELAY'), 1000)
  },

  // MQTT configuration
  mqtt: {
    brokerUrl: getEnvVar('MQTT_BROKER_URL', 'mqtt://localhost:1883'),
    username: getEnvVar('MQTT_USERNAME'),
    password: getEnvVar('MQTT_PASSWORD'),
    clientId: getEnvVar('MQTT_CLIENT_ID', 'signage-management'),
    reconnectPeriod: parseInteger(getEnvVar('MQTT_RECONNECT_PERIOD'), 1000),
    maxReconnectAttempts: parseInteger(getEnvVar('MQTT_MAX_RECONNECT_ATTEMPTS'), 10),
    qos: parseInteger(getEnvVar('MQTT_QOS'), 1),
    topics: {
      prefix: getEnvVar('MQTT_TOPIC_PREFIX', 'signage'),
      heartbeat: getEnvVar('MQTT_HEARTBEAT_TOPIC', 'heartbeat'),
      command: getEnvVar('MQTT_COMMAND_TOPIC', 'command'),
      status: getEnvVar('MQTT_STATUS_TOPIC', 'status'),
      config: getEnvVar('MQTT_CONFIG_TOPIC', 'config'),
      images: getEnvVar('MQTT_IMAGES_TOPIC', 'images')
    }
  },

  // Security configuration
  security: {
    apiKey: getEnvVar('API_KEY'),
    tvToken: getEnvVar('TV_TOKEN'),
    adminKey: getEnvVar('ADMIN_KEY'),
    allowedOrigins: parseArray(getEnvVar('ALLOWED_ORIGINS')),
    allowedIPs: parseArray(getEnvVar('ALLOWED_IPS')),
    sessionSecret: getEnvVar('SESSION_SECRET', 'dev-secret-change-in-production'),
    
    // Rate limiting
    rateLimit: {
      windowMs: parseInteger(getEnvVar('RATE_LIMIT_WINDOW'), 15 * 60 * 1000), // 15 minutes
      maxRequests: parseInteger(getEnvVar('RATE_LIMIT_MAX'), 1000),
      strictWindowMs: parseInteger(getEnvVar('RATE_LIMIT_STRICT_WINDOW'), 15 * 60 * 1000),
      strictMaxRequests: parseInteger(getEnvVar('RATE_LIMIT_STRICT_MAX'), 50),
      uploadWindowMs: parseInteger(getEnvVar('RATE_LIMIT_UPLOAD_WINDOW'), 60 * 60 * 1000), // 1 hour
      uploadMaxRequests: parseInteger(getEnvVar('RATE_LIMIT_UPLOAD_MAX'), 100)
    }
  },

  // File upload configuration
  upload: {
    maxFileSize: parseInteger(getEnvVar('MAX_FILE_SIZE'), 10 * 1024 * 1024), // 10MB
    maxFiles: parseInteger(getEnvVar('MAX_FILES_PER_UPLOAD'), 10),
    allowedMimeTypes: parseArray(getEnvVar('ALLOWED_MIME_TYPES'), [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp'
    ]),
    tempDir: getEnvVar('UPLOAD_TEMP_DIR', './temp'),
    storageDir: getEnvVar('UPLOAD_STORAGE_DIR', './uploads')
  },

  // Image processing configuration
  imageProcessing: {
    enableSharpOptimization: parseBoolean(getEnvVar('ENABLE_SHARP_OPTIMIZATION'), true),
    thumbnailWidth: parseInteger(getEnvVar('THUMBNAIL_WIDTH'), 300),
    thumbnailHeight: parseInteger(getEnvVar('THUMBNAIL_HEIGHT'), 200),
    imageQuality: parseInteger(getEnvVar('IMAGE_QUALITY'), 85),
    maxImageDimensions: {
      width: parseInteger(getEnvVar('MAX_IMAGE_WIDTH'), 4096),
      height: parseInteger(getEnvVar('MAX_IMAGE_HEIGHT'), 4096)
    }
  },

  // TV configuration defaults
  tvDefaults: {
    transitionEffect: getEnvVar('DEFAULT_TRANSITION_EFFECT', 'fade'),
    displayDuration: parseInteger(getEnvVar('DEFAULT_DISPLAY_DURATION'), 5000),
    resolution: getEnvVar('DEFAULT_RESOLUTION', '1920x1080'),
    orientation: getEnvVar('DEFAULT_ORIENTATION', 'landscape'),
    heartbeatInterval: parseInteger(getEnvVar('TV_HEARTBEAT_INTERVAL'), 30000), // 30 seconds
    heartbeatTimeout: parseInteger(getEnvVar('TV_HEARTBEAT_TIMEOUT'), 120000)  // 2 minutes
  },

  // Layer system configuration (Phase 2)
  layers: {
    maxLayers: parseInteger(getEnvVar('MAX_LAYERS_PER_TV'), 10),
    defaultOpacity: parseFloat(getEnvVar('DEFAULT_LAYER_OPACITY')) || 1.0,
    compositingTimeout: parseInteger(getEnvVar('COMPOSITING_TIMEOUT'), 5000),
    cacheLayerComposites: parseBoolean(getEnvVar('CACHE_LAYER_COMPOSITES'), true)
  },

  // WebSocket configuration
  websocket: {
    heartbeatInterval: parseInteger(getEnvVar('WS_HEARTBEAT_INTERVAL'), 30000),
    maxConnections: parseInteger(getEnvVar('WS_MAX_CONNECTIONS'), 100),
    enableCompression: parseBoolean(getEnvVar('WS_ENABLE_COMPRESSION'), true)
  },

  // Logging configuration
  logging: {
    level: getEnvVar('LOG_LEVEL', 'info'),
    enableFileLogging: parseBoolean(getEnvVar('ENABLE_FILE_LOGGING'), false),
    logFile: getEnvVar('LOG_FILE', './logs/app.log'),
    enableRequestLogging: parseBoolean(getEnvVar('ENABLE_REQUEST_LOGGING'), false),
    enableSqlLogging: parseBoolean(getEnvVar('ENABLE_SQL_LOGGING'), false)
  },

  // Development/debugging configuration
  development: {
    enableDebugRoutes: parseBoolean(getEnvVar('ENABLE_DEBUG_ROUTES'), false),
    enableSwagger: parseBoolean(getEnvVar('ENABLE_SWAGGER'), false),
    mockExternalServices: parseBoolean(getEnvVar('MOCK_EXTERNAL_SERVICES'), false),
    enableVerboseErrors: parseBoolean(getEnvVar('ENABLE_VERBOSE_ERRORS'), true)
  },

  // Performance configuration
  performance: {
    enableResponseCache: parseBoolean(getEnvVar('ENABLE_RESPONSE_CACHE'), false),
    cacheTimeout: parseInteger(getEnvVar('CACHE_TIMEOUT'), 300000), // 5 minutes
    enableGzip: parseBoolean(getEnvVar('ENABLE_GZIP'), true),
    maxConcurrentUploads: parseInteger(getEnvVar('MAX_CONCURRENT_UPLOADS'), 5)
  }
};

// Configuration validation
const validateConfig = () => {
  const errors = [];

  // Validate required configurations in production
  if (config.server.environment === 'production') {
    if (!config.security.apiKey) {
      errors.push('API_KEY is required in production');
    }
    if (!config.security.tvToken) {
      errors.push('TV_TOKEN is required in production');
    }
    if (!config.security.adminKey) {
      errors.push('ADMIN_KEY is required in production');
    }
    if (config.security.sessionSecret === 'dev-secret-change-in-production') {
      errors.push('SESSION_SECRET must be changed in production');
    }
  }

  // Validate numeric ranges
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (config.imageProcessing.imageQuality < 1 || config.imageProcessing.imageQuality > 100) {
    errors.push('IMAGE_QUALITY must be between 1 and 100');
  }

  if (config.layers.defaultOpacity < 0 || config.layers.defaultOpacity > 1) {
    errors.push('DEFAULT_LAYER_OPACITY must be between 0 and 1');
  }

  // Validate MQTT QoS
  if (![0, 1, 2].includes(config.mqtt.qos)) {
    errors.push('MQTT_QOS must be 0, 1, or 2');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
};

// Validate configuration on load
validateConfig();

// Helper functions
config.isDevelopment = () => config.server.environment === 'development';
config.isProduction = () => config.server.environment === 'production';
config.isTest = () => config.server.environment === 'test';

// Generate MQTT topic names
config.getMqttTopic = (tvId, topicType) => {
  return `${config.mqtt.topics.prefix}/tv/${tvId}/${topicType}`;
};

// Get database connection string with auth
config.getDatabaseUrl = () => {
  const { url, username, password } = config.database;
  if (username && password) {
    const urlObj = new URL(url);
    urlObj.username = username;
    urlObj.password = password;
    return urlObj.toString();
  }
  return url;
};

module.exports = config;