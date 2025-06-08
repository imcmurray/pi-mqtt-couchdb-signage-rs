const mqtt = require('mqtt');
const TV = require('../models/tv');
require('dotenv').config();

class MQTTService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.subscribers = new Map();
    this.heartbeatTimeout = 90000; // 90 seconds (30s heartbeat + 60s grace)
    this.offlineCheckInterval = 30000; // Check every 30 seconds
    this.offlineCheckTimer = null;
  }

  async connect() {
    const options = {
      keepalive: 60,
      connectTimeout: 30 * 1000,
      reconnectPeriod: 1000,
      clean: true,
    };

    if (process.env.MQTT_USERNAME && process.env.MQTT_PASSWORD) {
      options.username = process.env.MQTT_USERNAME;
      options.password = process.env.MQTT_PASSWORD;
    }

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.215:1883', options);

      this.client.on('connect', () => {
        console.log('Connected to MQTT broker');
        this.isConnected = true;
        this.setupSubscriptions();
        this.startOfflineMonitoring();
        resolve();
      });

      this.client.on('error', (error) => {
        console.error('MQTT connection error:', error);
        reject(error);
      });

      this.client.on('offline', () => {
        console.log('MQTT client offline');
        this.isConnected = false;
      });

      this.client.on('reconnect', () => {
        console.log('MQTT client reconnecting');
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });
    });
  }

  setupSubscriptions() {
    // Subscribe to all TV status updates
    this.client.subscribe('signage/tv/+/status');
    this.client.subscribe('signage/tv/+/heartbeat');
    this.client.subscribe('signage/tv/+/error');
    this.client.subscribe('signage/tv/+/image/current');
    
    // Subscribe to all MQTT messages for activity monitoring
    this.client.subscribe('#'); // This subscribes to all topics
    
    console.log('Subscribed to MQTT topics');
  }

  async handleMessage(topic, message) {
    try {
      let payload;
      
      // Try to parse as JSON, fallback to string
      try {
        payload = JSON.parse(message.toString());
      } catch {
        payload = message.toString();
      }

      // Handle digital signage specific messages
      if (topic.startsWith('signage/tv/')) {
        const parts = topic.split('/');
        if (parts.length >= 4) {
          const [, , tvId, messageType] = parts;

          switch (messageType) {
            case 'status':
              await this.handleStatusUpdate(tvId, payload);
              break;
            case 'heartbeat':
              await this.handleHeartbeat(tvId, payload);
              break;
            case 'error':
              await this.handleError(tvId, payload);
              break;
            case 'image':
              if (parts[4] === 'current') {
                await this.handleCurrentImageUpdate(tvId, payload);
              }
              break;
          }
        }
      }

      // Notify WebSocket subscribers of ALL messages for activity monitoring
      this.notifySubscribers(topic, payload);
    } catch (error) {
      console.error('Error handling MQTT message:', error);
    }
  }

  async handleStatusUpdate(tvId, payload) {
    try {
      const tv = await TV.findById(`tv_${tvId}`);
      if (tv) {
        await tv.update({
          status: payload.status,
          last_heartbeat: new Date().toISOString()
        });
        console.log(`TV ${tvId} status updated to ${payload.status}`);
      }
    } catch (error) {
      console.error(`Error updating TV ${tvId} status:`, error);
    }
  }

  async handleHeartbeat(tvId, payload) {
    try {
      const tv = await TV.findById(`tv_${tvId}`);
      if (tv) {
        await tv.updateHeartbeat();
      }
    } catch (error) {
      console.error(`Error updating TV ${tvId} heartbeat:`, error);
    }
  }

  async handleError(tvId, payload) {
    console.error(`TV ${tvId} reported error:`, payload);
    // Could store errors in database or send alerts
  }

  async handleCurrentImageUpdate(tvId, payload) {
    try {
      const tv = await TV.findById(`tv_${tvId}`);
      if (tv) {
        await tv.update({
          current_image: payload.image_id,
          last_heartbeat: new Date().toISOString()
        });
        console.log(`TV ${tvId} current image updated to ${payload.image_id}`);
      }
    } catch (error) {
      console.error(`Error updating TV ${tvId} current image:`, error);
    }
  }

  // Send commands to TVs
  async sendCommand(tvId, command, payload = {}) {
    if (!this.isConnected) {
      throw new Error('MQTT client not connected');
    }

    const topic = `signage/tv/${tvId}/command`;
    const message = JSON.stringify({
      command,
      payload,
      timestamp: new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`Command sent to TV ${tvId}: ${command}`);
          resolve();
        }
      });
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

  async updateImages(tvId, imageList) {
    return this.sendCommand(tvId, 'update_images', { images: imageList });
  }

  async updateConfig(tvId, config) {
    return this.sendCommand(tvId, 'update_config', config);
  }

  async rebootTv(tvId) {
    return this.sendCommand(tvId, 'reboot');
  }

  // WebSocket notification system
  addSubscriber(id, callback) {
    this.subscribers.set(id, callback);
  }

  removeSubscriber(id) {
    this.subscribers.delete(id);
  }

  notifySubscribers(topic, payload) {
    this.subscribers.forEach((callback) => {
      try {
        callback({ topic, payload });
      } catch (error) {
        console.error('Error notifying subscriber:', error);
      }
    });
  }

  startOfflineMonitoring() {
    if (this.offlineCheckTimer) {
      clearInterval(this.offlineCheckTimer);
    }
    
    this.offlineCheckTimer = setInterval(async () => {
      await this.checkForOfflineTVs();
    }, this.offlineCheckInterval);
    
    console.log('Started offline TV monitoring');
  }

  async checkForOfflineTVs() {
    try {
      const allTVs = await TV.findAll();
      const now = new Date();
      
      for (const tvData of allTVs) {
        if (tvData.status === 'online' && tvData.last_heartbeat) {
          const lastHeartbeat = new Date(tvData.last_heartbeat);
          const timeSinceHeartbeat = now - lastHeartbeat;
          
          if (timeSinceHeartbeat > this.heartbeatTimeout) {
            console.log(`TV ${tvData._id} appears offline - last heartbeat ${Math.round(timeSinceHeartbeat/1000)}s ago`);
            
            const tv = await TV.findById(tvData._id);
            if (tv && tv.status === 'online') {
              await tv.update({ status: 'offline' });
              console.log(`Updated TV ${tvData._id} status to offline`);
              
              // Notify WebSocket subscribers about status change
              this.notifySubscribers(`signage/tv/${tvData.tv_id}/status`, {
                status: 'offline',
                timestamp: new Date().toISOString(),
                reason: 'heartbeat_timeout'
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking for offline TVs:', error);
    }
  }

  disconnect() {
    if (this.offlineCheckTimer) {
      clearInterval(this.offlineCheckTimer);
      this.offlineCheckTimer = null;
    }
    
    if (this.client) {
      this.client.end();
      this.isConnected = false;
      console.log('Disconnected from MQTT broker');
    }
  }
}

module.exports = new MQTTService();