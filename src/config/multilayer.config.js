// Multi-layer development configuration
// Uses isolated databases and MQTT topics to avoid conflicts with main branch

const baseConfig = require('./index');

// Override configuration for multi-layer development
const multilayerConfig = {
  ...baseConfig,
  
  // Override database configuration
  database: {
    ...baseConfig.database,
    name: 'signage_multilayer',
    // Database names for isolated development
    databases: {
      main: 'signage_multilayer',
      tvs: 'tvs_multilayer', 
      images: 'images_multilayer',
      layers: 'layers_multilayer' // New database for layer configs
    }
  },

  // Override MQTT configuration  
  mqtt: {
    ...baseConfig.mqtt,
    clientId: 'signage-management-multilayer',
    topics: {
      ...baseConfig.mqtt.topics,
      prefix: 'signage_dev', // New prefix to avoid conflicts
      // Layer-specific topics
      layer: 'layer',
      layerCommand: 'layer/command',
      layerStatus: 'layer/status',
      layersBatch: 'layers/batch'
    }
  },

  // Enhanced layer system configuration
  layers: {
    ...baseConfig.layers,
    maxLayers: 50, // Support many individual data row layers
    animation: {
      defaultDuration: 500, // ms
      defaultEasing: 'ease-in-out',
      slideDistance: 100, // pixels for slide animations
      fadeOpacityMin: 0,
      fadeOpacityMax: 1,
      supportedEasings: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bounce', 'elastic']
    },
    dataRow: {
      defaultHeight: 40, // pixels
      defaultFontSize: 24,
      defaultPadding: 10,
      defaultBackgroundOpacity: 0.8
    }
  },

  // Development mode settings
  development: {
    ...baseConfig.development,
    enableLayerDebug: true,
    enableAnimationPreview: true,
    mockLayerData: true
  }
};

// Override helper functions for multi-layer topics
multilayerConfig.getMqttTopic = (tvId, topicType) => {
  return `${multilayerConfig.mqtt.topics.prefix}/tv/${tvId}/${topicType}`;
};

multilayerConfig.getLayerMqttTopic = (tvId, layerId, topicType) => {
  return `${multilayerConfig.mqtt.topics.prefix}/tv/${tvId}/layer/${layerId}/${topicType}`;
};

multilayerConfig.getLayersBatchMqttTopic = (tvId) => {
  return `${multilayerConfig.mqtt.topics.prefix}/tv/${tvId}/layers/batch`;
};

// Database URL helpers for each isolated database
multilayerConfig.getDatabaseUrls = () => {
  const baseUrl = multilayerConfig.getDatabaseUrl();
  const { databases } = multilayerConfig.database;
  
  return {
    main: `${baseUrl}/${databases.main}`,
    tvs: `${baseUrl}/${databases.tvs}`,
    images: `${baseUrl}/${databases.images}`,
    layers: `${baseUrl}/${databases.layers}`
  };
};

module.exports = multilayerConfig;