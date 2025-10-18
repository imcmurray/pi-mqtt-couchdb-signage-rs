const Layer = require('../models/Layer');
const TVMultilayer = require('../models/tv.multilayer');
const mqttService = require('./multilayer.mqttService');
const cron = require('node-cron');

class LayerAutomationService {
  constructor() {
    this.scheduledTasks = new Map();
    this.automationRules = new Map();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.setupCronJobs();
    this.startDataPolling();
    console.log('Layer automation service started');
  }

  stop() {
    this.isRunning = false;
    
    // Clear all cron jobs
    this.scheduledTasks.forEach(task => task.destroy());
    this.scheduledTasks.clear();
    
    console.log('Layer automation service stopped');
  }

  setupCronJobs() {
    // Example: Update court schedule every morning at 8 AM
    const morningUpdate = cron.schedule('0 8 * * *', async () => {
      await this.updateCourtScheduleLayers();
    }, { scheduled: false });
    
    morningUpdate.start();
    this.scheduledTasks.set('morning_update', morningUpdate);

    // Example: Clear emergency alerts every hour
    const emergencyCleanup = cron.schedule('0 * * * *', async () => {
      await this.cleanupExpiredEmergencyLayers();
    }, { scheduled: false });
    
    emergencyCleanup.start();
    this.scheduledTasks.set('emergency_cleanup', emergencyCleanup);

    // Example: Refresh data every 5 minutes
    const dataRefresh = cron.schedule('*/5 * * * *', async () => {
      await this.refreshDataLayers();
    }, { scheduled: false });
    
    dataRefresh.start();
    this.scheduledTasks.set('data_refresh', dataRefresh);
  }

  startDataPolling() {
    // Poll for external data changes every 30 seconds
    setInterval(async () => {
      if (this.isRunning) {
        await this.checkForDataUpdates();
      }
    }, 30000);
  }

  async updateCourtScheduleLayers() {
    try {
      // Get all TVs with layer support
      const tvs = await TVMultilayer.findWithLayerSupport();
      
      for (const tv of tvs) {
        // Get existing court schedule layers
        const layers = await Layer.findByTv(tv._id);
        const courtLayers = layers.filter(layer => 
          layer.name && layer.name.toLowerCase().includes('court')
        );

        // Simulate fetching new court schedule data
        const scheduleData = await this.fetchCourtScheduleData();
        
        // Update each court layer with new data
        for (let i = 0; i < Math.min(courtLayers.length, scheduleData.length); i++) {
          const layer = courtLayers[i];
          const scheduleItem = scheduleData[i];
          
          if (layer.content.text !== scheduleItem.text) {
            await layer.updateContent({
              text: scheduleItem.text,
              backgroundColor: scheduleItem.status === 'delayed' ? 'rgba(255, 165, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)'
            }, { duration: 500 });
            
            console.log(`Updated court layer ${layer.layer_id} with: ${scheduleItem.text}`);
          }
        }
      }
    } catch (error) {
      console.error('Error updating court schedule layers:', error);
    }
  }

  async cleanupExpiredEmergencyLayers() {
    try {
      const tvs = await TVMultilayer.findWithLayerSupport();
      
      for (const tv of tvs) {
        const layers = await Layer.findByTv(tv._id);
        const emergencyLayers = layers.filter(layer => 
          layer.layer_type === 'Emergency' || 
          (layer.name && layer.name.toLowerCase().includes('alert'))
        );

        for (const layer of emergencyLayers) {
          // Check if layer has auto-hide schedule
          if (layer.schedule && layer.schedule.auto_hide_after_ms) {
            const createdTime = new Date(layer.created_at || layer.updated_at);
            const expiryTime = new Date(createdTime.getTime() + layer.schedule.auto_hide_after_ms);
            
            if (new Date() > expiryTime) {
              // Fade out and delete expired emergency layer
              await layer.startAnimation('fade_out', 1000);
              
              setTimeout(async () => {
                await layer.delete();
                console.log(`Cleaned up expired emergency layer: ${layer.name}`);
              }, 1000);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up emergency layers:', error);
    }
  }

  async refreshDataLayers() {
    try {
      const tvs = await TVMultilayer.findWithLayerSupport();
      
      for (const tv of tvs) {
        const layers = await Layer.findByTv(tv._id);
        const dataLayers = layers.filter(layer => layer.layer_type === 'DataRow');

        // Check for layers with tags indicating they need refresh
        const refreshableLayers = dataLayers.filter(layer => 
          layer.tags && layer.tags.includes('auto-refresh')
        );

        for (const layer of refreshableLayers) {
          // Simulate data refresh - in real implementation, 
          // this would fetch from external APIs or databases
          const newData = await this.fetchUpdatedDataForLayer(layer);
          
          if (newData && newData.text !== layer.content.text) {
            await layer.updateContent(newData, { duration: 300 });
            console.log(`Refreshed data layer ${layer.layer_id}`);
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing data layers:', error);
    }
  }

  async checkForDataUpdates() {
    // Placeholder for checking external data sources
    // This could integrate with webhooks, APIs, or database change streams
    
    try {
      // Example: Check for emergency alerts
      const emergencyAlerts = await this.fetchEmergencyAlerts();
      
      if (emergencyAlerts.length > 0) {
        await this.createEmergencyLayers(emergencyAlerts);
      }
      
      // Example: Check for schedule changes
      const scheduleChanges = await this.fetchScheduleChanges();
      
      if (scheduleChanges.length > 0) {
        await this.updateScheduleLayers(scheduleChanges);
      }
    } catch (error) {
      console.error('Error checking for data updates:', error);
    }
  }

  async createEmergencyLayers(alerts) {
    const tvs = await TVMultilayer.findWithLayerSupport();
    
    for (const alert of alerts) {
      for (const tv of tvs) {
        // Check if alert already exists
        const existingLayers = await Layer.findByTv(tv._id);
        const alertExists = existingLayers.some(layer => 
          layer.content.text === alert.message
        );
        
        if (!alertExists) {
          const alertLayer = new Layer({
            tv_id: tv._id,
            name: `Emergency Alert: ${alert.type}`,
            layer_type: 'Emergency',
            content: {
              text: `🚨 ${alert.message}`,
              backgroundColor: 'rgba(255, 0, 0, 0.95)',
              textColor: 'rgba(255, 255, 255, 1)',
              fontSize: 32,
              alignment: 'center'
            },
            position: {
              x: 0,
              y: 50,
              width: 1920,
              height: 80
            },
            visible: true,
            opacity: 1.0,
            priority: 200, // Highest priority
            schedule: {
              enabled: true,
              auto_hide_after_ms: alert.duration || 300000 // 5 minutes default
            },
            tags: ['emergency', 'auto-generated']
          });
          
          await alertLayer.save();
          
          // Animate in
          await alertLayer.startAnimation('slide_down', 800);
          
          console.log(`Created emergency alert layer for TV ${tv._id}: ${alert.message}`);
          
          // Publish MQTT notification
          if (mqttService.isConnected()) {
            await mqttService.publishLayerUpdate(tv._id, alertLayer.layer_id, 'emergency_created', alertLayer);
          }
        }
      }
    }
  }

  async updateScheduleLayers(changes) {
    for (const change of changes) {
      const layers = await Layer.findByTv(change.tv_id);
      const targetLayer = layers.find(layer => 
        layer.content.text.includes(change.room) || 
        layer.content.text.includes(change.case)
      );
      
      if (targetLayer) {
        await targetLayer.updateContent({
          text: change.new_text,
          backgroundColor: change.status === 'delayed' ? 'rgba(255, 165, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)'
        }, { duration: 500 });
        
        console.log(`Updated schedule layer: ${change.new_text}`);
      }
    }
  }

  // Mock data functions - replace with real data sources
  async fetchCourtScheduleData() {
    // Simulate fetching from court management system
    return [
      { text: '9:00 AM - Room 101 - Smith vs. Johnson', status: 'on_time' },
      { text: '10:30 AM - Room 205 - State vs. Williams - DELAYED', status: 'delayed' },
      { text: '2:00 PM - Room 301 - Davis vs. Miller', status: 'on_time' },
    ];
  }

  async fetchEmergencyAlerts() {
    // Simulate checking emergency alert system
    // In production, this would connect to emergency notification APIs
    const random = Math.random();
    
    if (random < 0.1) { // 10% chance of emergency alert
      return [{
        type: 'security',
        message: 'Security alert in Building A - Please remain calm',
        duration: 600000 // 10 minutes
      }];
    }
    
    return [];
  }

  async fetchScheduleChanges() {
    // Simulate checking for schedule changes
    return [];
  }

  async fetchUpdatedDataForLayer(layer) {
    // Simulate fetching updated data for specific layer
    if (layer.name && layer.name.includes('Weather')) {
      return {
        text: `Weather: ${Math.round(Math.random() * 30 + 10)}°C, Partly Cloudy`,
        backgroundColor: 'rgba(0, 100, 200, 0.8)'
      };
    }
    
    if (layer.name && layer.name.includes('Time')) {
      return {
        text: `Current Time: ${new Date().toLocaleTimeString()}`,
        backgroundColor: 'rgba(0, 0, 0, 0.8)'
      };
    }
    
    return null;
  }

  // API methods for manual triggers
  async triggerEmergencyAlert(tvId, message, duration = 300000) {
    await this.createEmergencyLayers([{
      type: 'manual',
      message,
      duration
    }]);
  }

  async updateLayerContent(tvId, layerId, content, transition = null) {
    const layer = await Layer.findById(layerId);
    
    if (layer && layer.tv_id === tvId) {
      await layer.updateContent(content, transition);
      
      if (mqttService.isConnected()) {
        await mqttService.publishLayerContent(tvId, layerId, content, transition);
      }
      
      return true;
    }
    
    return false;
  }

  async scheduleLayerUpdate(tvId, layerId, content, scheduleTime) {
    const updateTime = new Date(scheduleTime);
    const now = new Date();
    
    if (updateTime <= now) {
      throw new Error('Schedule time must be in the future');
    }
    
    const delay = updateTime.getTime() - now.getTime();
    
    setTimeout(async () => {
      await this.updateLayerContent(tvId, layerId, content, { duration: 500 });
      console.log(`Scheduled layer update executed: ${layerId}`);
    }, delay);
    
    console.log(`Scheduled layer update for ${updateTime.toISOString()}: ${layerId}`);
  }
}

// Create singleton instance
const layerAutomationService = new LayerAutomationService();

module.exports = layerAutomationService;