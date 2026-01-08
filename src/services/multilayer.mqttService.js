const mqtt = require('mqtt');
const EventEmitter = require('events');
const config = require('../config/multilayer.config');

class MultilayerMqttService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.reconnectAttempts = 0;
  }

  async connect() {
    const options = {
      clientId: config.mqtt.clientId,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: config.mqtt.reconnectPeriod,
      username: config.mqtt.username,
      password: config.mqtt.password,
    };

    this.client = mqtt.connect(config.mqtt.brokerUrl, options);

    this.client.on('connect', () => {
      console.log('Connected to MQTT broker (multi-layer mode)');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
      this.subscribeToTopics();
    });

    this.client.on('error', (error) => {
      console.error('MQTT error:', error);
      this.emit('error', error);
    });

    this.client.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`MQTT reconnecting... (attempt ${this.reconnectAttempts})`);
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });
  }

  subscribeToTopics() {
    // Subscribe to layer-specific topics and TV status topics
    const topics = [
      // Layer-specific topics (signage_dev prefix)
      `${config.mqtt.topics.prefix}/tv/+/layer/+/status`,
      `${config.mqtt.topics.prefix}/tv/+/layers/status`,
      `${config.mqtt.topics.prefix}/tv/+/animation/complete`,
      // TV status topics - subscribe to BOTH prefixes for compatibility with Rust endpoints
      `signage/tv/+/heartbeat`,
      `signage/tv/+/status`,
      `signage/tv/+/image/current`,
      `${config.mqtt.topics.prefix}/tv/+/heartbeat`,
      `${config.mqtt.topics.prefix}/tv/+/status`,
      `${config.mqtt.topics.prefix}/tv/+/image/current`
    ];

    topics.forEach(topic => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`Subscribed to ${topic}`);
        }
      });
    });
  }

  handleMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      this.emit('message', { topic, payload });
    } catch (error) {
      console.error('Error parsing MQTT message:', error);
    }
  }

  // Layer control methods
  async publishLayerUpdate(tvId, layerId, action, layerData = null) {
    const topic = config.getLayerMqttTopic(tvId, layerId, 'update');
    const payload = {
      action,
      layer_id: layerId,
      timestamp: new Date().toISOString(),
      data: layerData
    };
    
    this.publish(topic, payload);
  }

  async publishLayerAnimation(tvId, layerId, animation) {
    const topic = config.getLayerMqttTopic(tvId, layerId, 'animate');
    const payload = {
      layer_id: layerId,
      animation,
      timestamp: new Date().toISOString()
    };
    
    this.publish(topic, payload);
  }

  async publishLayerVisibility(tvId, layerId, visible, transition = null) {
    const topic = config.getLayerMqttTopic(tvId, layerId, 'visibility');
    const payload = {
      layer_id: layerId,
      visible,
      transition,
      timestamp: new Date().toISOString()
    };
    
    this.publish(topic, payload);
  }

  async publishLayerMove(tvId, layerId, x, y, animate, duration) {
    const topic = config.getLayerMqttTopic(tvId, layerId, 'move');
    const payload = {
      layer_id: layerId,
      position: { x, y },
      animate,
      duration,
      timestamp: new Date().toISOString()
    };
    
    this.publish(topic, payload);
  }

  async publishLayerContent(tvId, layerId, content, transition = null) {
    const topic = config.getLayerMqttTopic(tvId, layerId, 'content');
    const payload = {
      layer_id: layerId,
      content,
      transition,
      timestamp: new Date().toISOString()
    };
    
    this.publish(topic, payload);
  }

  async publishLayerBatch(tvId, operation, results) {
    const topic = config.getLayersBatchMqttTopic(tvId);
    const payload = {
      operation,
      results,
      count: results.length,
      timestamp: new Date().toISOString()
    };
    
    this.publish(topic, payload);
  }

  // Standard TV control methods (inherited from original)
  async publishCommand(tvId, command) {
    const topic = config.getMqttTopic(tvId, 'command');
    this.publish(topic, command);
  }

  async publishConfig(tvId, configData) {
    const topic = config.getMqttTopic(tvId, 'config');
    this.publish(topic, configData);
  }

  async updateConfig(tvId, configData) {
    console.log(`🔄 SENDING CONFIG UPDATE to TV ${tvId}:`, configData);
    return this.publishConfig(tvId, configData);
  }

  async publishImages(tvId, images) {
    const topic = config.getMqttTopic(tvId, 'images');
    this.publish(topic, { images });
  }

  // Send image updates to TV slideshow (uses base 'signage' prefix, not 'signage_dev')
  // This is the command format the Rust slideshow client expects
  async updateImages(tvId, imageList) {
    const topic = `signage/tv/${tvId}/command`;
    const message = JSON.stringify({
      command: 'update_images',
      payload: { images: imageList },
      timestamp: new Date().toISOString()
    });

    console.log(`📤 MQTT: Sending update_images to ${topic} with ${imageList.length} images`);

    if (!this.connected) {
      console.warn(`⚠️ MQTT not connected, cannot send update_images to TV ${tvId}`);
      return;
    }

    this.client.publish(topic, message, { qos: 1 }, (error) => {
      if (error) {
        console.error(`❌ MQTT: Failed to send update_images to ${topic}:`, error);
      } else {
        console.log(`✅ MQTT: update_images sent to ${topic}`);
      }
    });
  }

  // Generic command sender (uses base 'signage' prefix for Rust client compatibility)
  async sendCommand(tvId, command, payload = {}) {
    const topic = `signage/tv/${tvId}/command`;
    const message = JSON.stringify({
      command,
      payload,
      timestamp: new Date().toISOString()
    });

    if (!this.connected) {
      console.warn(`⚠️ MQTT not connected, cannot send ${command} to TV ${tvId}`);
      return;
    }

    this.client.publish(topic, message, { qos: 1 }, (error) => {
      if (error) {
        console.error(`❌ MQTT: Failed to send ${command} to ${topic}:`, error);
      } else {
        console.log(`✅ MQTT: ${command} sent to ${topic}`);
      }
    });
  }

  // TV Control Commands
  async playSlideshow(tvId) {
    return this.sendCommand(tvId, 'play');
  }

  async pauseSlideshow(tvId) {
    return this.sendCommand(tvId, 'pause');
  }

  async nextImage(tvId) {
    return this.sendCommand(tvId, 'next');
  }

  async previousImage(tvId) {
    return this.sendCommand(tvId, 'previous');
  }

  async rebootTv(tvId) {
    return this.sendCommand(tvId, 'reboot');
  }

  // Layer Management Commands
  async updateLayerConfig(tvId, layerConfig) {
    console.log(`🔄 SENDING LAYER CONFIG UPDATE to TV ${tvId}:`, layerConfig);
    return this.sendCommand(tvId, 'update_layer_config', layerConfig);
  }

  async updateSpecificLayer(tvId, layerId, layerData) {
    console.log(`🔄 SENDING LAYER UPDATE to TV ${tvId}, layer ${layerId}:`, layerData);
    return this.sendCommand(tvId, 'update_layer', { layer_id: layerId, layer_data: layerData });
  }

  async removeLayer(tvId, layerId) {
    console.log(`🔄 SENDING LAYER REMOVAL to TV ${tvId}, layer ${layerId}`);
    return this.sendCommand(tvId, 'remove_layer', { layer_id: layerId });
  }

  async setLayerVisibility(tvId, layerId, visible) {
    console.log(`🔄 SENDING LAYER VISIBILITY UPDATE to TV ${tvId}, layer ${layerId}: ${visible}`);
    return this.sendCommand(tvId, 'set_layer_visibility', { layer_id: layerId, visible: visible });
  }

  // Helper methods
  publish(topic, payload, qos = config.mqtt.qos) {
    if (!this.connected) {
      console.error('MQTT not connected, cannot publish to', topic);
      return;
    }

    const message = JSON.stringify(payload);
    this.client.publish(topic, message, { qos }, (err) => {
      if (err) {
        console.error(`Failed to publish to ${topic}:`, err);
      } else {
        console.log(`Published to ${topic}`);
      }
    });
  }

  publishRetained(topic, payload, qos = config.mqtt.qos) {
    if (!this.connected) {
      console.error('MQTT not connected, cannot publish retained to', topic);
      return;
    }

    const message = JSON.stringify(payload);
    this.client.publish(topic, message, { qos, retain: true }, (err) => {
      if (err) {
        console.error(`Failed to publish retained to ${topic}:`, err);
      } else {
        console.log(`📌 Published retained to ${topic}`);
      }
    });
  }

  isConnected() {
    return this.connected;
  }

  async disconnect() {
    if (this.client) {
      this.client.end();
      this.connected = false;
    }
  }
}

// Create singleton instance
const mqttService = new MultilayerMqttService();

module.exports = mqttService;