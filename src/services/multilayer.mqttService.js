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
    // Subscribe to layer-specific topics
    const topics = [
      `${config.mqtt.topics.prefix}/tv/+/layer/+/status`,
      `${config.mqtt.topics.prefix}/tv/+/layers/status`,
      `${config.mqtt.topics.prefix}/tv/+/animation/complete`
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

  async publishConfig(tvId, config) {
    const topic = config.getMqttTopic(tvId, 'config');
    this.publish(topic, config);
  }

  async publishImages(tvId, images) {
    const topic = config.getMqttTopic(tvId, 'images');
    this.publish(topic, { images });
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