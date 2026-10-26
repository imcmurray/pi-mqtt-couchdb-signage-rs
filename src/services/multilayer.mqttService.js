const mqtt = require('mqtt');
const EventEmitter = require('events');
const config = require('../config/multilayer.config');

class MultilayerMqttService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    // Latest live state each TV reported over MQTT, keyed by TV doc _id ("tv_<id>")
    this.liveState = new Map();
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
      this.trackLiveState(topic, payload);
      this.emit('message', { topic, payload });
    } catch (error) {
      console.error('Error parsing MQTT message:', error);
    }
  }

  // The Pi doesn't write heartbeats, metrics or auto-advance images to CouchDB,
  // so the stored values go stale; remember what each TV last reported.
  trackLiveState(topic, payload) {
    const match = topic.match(/\/tv\/([^/]+)\/(heartbeat|status|image\/current)$/);
    if (!match) return;

    const [, tvId, messageType] = match;
    const state = this.liveState.get(`tv_${tvId}`) || {};
    state.last_heartbeat = new Date().toISOString();

    if (messageType === 'heartbeat' && payload.system_metrics) {
      state.system_metrics = payload.system_metrics;
    }
    if (messageType === 'status' && payload.status) {
      state.slideshow_state = payload.status;
    }
    if ('clip_id' in payload || 'current_clip' in payload) {
      // Sequence playback: a scene clip shows no image (image_id is null)
      state.current_image = payload.image_id ?? payload.current_image ?? null;
      const clip = payload.clip_id ?? payload.current_clip ?? null;
      // When the clip last changed, to spot a TV stuck on one clip (monitorService)
      if (clip !== state.current_clip || !state.clip_changed_at) state.clip_changed_at = new Date().toISOString();
      state.current_clip = clip;
      state.current_scene = payload.scene_id ?? payload.current_scene ?? null;
    } else {
      const imageId = payload.image_id || payload.current_image;
      if (imageId) {
        state.current_image = imageId;
      }
    }

    this.liveState.set(`tv_${tvId}`, state);
  }

  // Overlay live state onto a TV loaded from CouchDB (API responses only, never saved).
  // The Pi stores its slideshow state (playing/paused) in `status`; connection
  // status is derived from heartbeat age instead.
  applyLiveState(tv) {
    const live = this.liveState.get(tv._id) || {};
    const storedState = ['online', 'offline'].includes(tv.status) ? null : tv.status;
    const lastSeen = [live.last_heartbeat, tv.last_heartbeat]
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

    if ('current_clip' in live) {
      tv.current_image = live.current_image;
      tv.current_clip = live.current_clip;
      tv.current_scene = live.current_scene;
    } else {
      tv.current_image = live.current_image || tv.current_image;
    }
    tv.system_metrics = live.system_metrics || tv.system_metrics;
    tv.slideshow_state = live.slideshow_state || storedState || tv.slideshow_state;
    tv.last_heartbeat = lastSeen || null;
    tv.status = lastSeen && Date.now() - Date.parse(lastSeen) < config.tvDefaults.heartbeatTimeout
      ? 'online'
      : 'offline';
    return tv;
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

  // Jump to an image in the TV's playlist; hold pauses on it
  // Send the TV its full Layer Control layer list; the Pi replaces its synced
  // layers with it. Alert layers are excluded (they arrive on the alerts topic).
  // Bursts (e.g. applying a template) are collapsed into one message per TV.
  syncLayers(tvId) {
    this.pendingLayerSyncs = this.pendingLayerSyncs || new Map();
    clearTimeout(this.pendingLayerSyncs.get(tvId));
    this.pendingLayerSyncs.set(tvId, setTimeout(async () => {
      this.pendingLayerSyncs.delete(tvId);
      try {
        const Layer = require('../models/Layer');
        const layers = (await Layer.findByTv(tvId)).filter(layer => !Layer.isAlertLayer(layer));
        await this.sendCommand(tvId.replace(/^tv_/, ''), 'sync_layers', {
          layers: layers.map(layer => ({
            layer_id: layer.layer_id,
            name: layer.name,
            layer_type: layer.layer_type,
            content: layer.content,
            position: layer.position,
            visible: layer.visible,
            opacity: layer.opacity,
            priority: layer.priority
          }))
        });
      } catch (error) {
        console.error(`Failed to sync layers to TV ${tvId}:`, error);
      }
    }, 250));
  }

  async animateLayer(tvId, layerId, animation) {
    return this.sendCommand(tvId.replace(/^tv_/, ''), 'animate_layer', {
      layer_id: layerId,
      animation_type: animation.type,
      duration_ms: animation.duration,
      distance: animation.distance
    });
  }

  // Jump to a sequence clip now; hold pauses on it
  async showClip(tvId, clipId, hold = false) {
    return this.sendCommand(tvId.replace(/^tv_/, ''), 'show_image', { clip_id: clipId, hold });
  }

  async resume(tvId) {
    return this.sendCommand(tvId.replace(/^tv_/, ''), 'play');
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