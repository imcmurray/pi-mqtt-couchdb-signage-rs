// Test environment setup
process.env.NODE_ENV = 'test';
process.env.PORT = 3001;
process.env.COUCHDB_URL = 'http://localhost:5984';
process.env.COUCHDB_USER = 'test_user';
process.env.COUCHDB_PASSWORD = 'test_password';
process.env.MQTT_BROKER = 'mqtt://localhost:1883';

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

// Global test helpers
global.testHelpers = {
  // Generate test TV data
  generateTV: (overrides = {}) => ({
    name: 'Test TV',
    location: 'Test Location',
    ip_address: '192.168.1.100',
    config: {
      transition_effect: 'fade',
      display_duration: 5000,
      resolution: '1920x1080',
      orientation: 'landscape',
      layers: {
        slideshow: {
          enabled: true,
          position: { x: 0, y: 0, width: 1920, height: 1080 },
          priority: 1,
          opacity: 1.0
        }
      },
      layer_settings: {
        max_layers: 10,
        compositing_timeout_ms: 5000,
        cache_composites: true
      }
    },
    ...overrides
  }),
  
  // Generate test image data
  generateImage: (overrides = {}) => ({
    original_filename: 'test.jpg',
    title: 'Test Image',
    description: 'Test image description',
    tags: ['test'],
    tv_assignments: [],
    ...overrides
  }),
  
  // Wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};