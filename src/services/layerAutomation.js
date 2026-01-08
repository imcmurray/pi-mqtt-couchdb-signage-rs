const Layer = require('../models/Layer');
const TVMultilayer = require('../models/tv.multilayer');
const mqttService = require('./multilayer.mqttService');
const courtDisplayService = require('./courtDisplayService');
const alertService = require('./alertService');
const cron = require('node-cron');

class LayerAutomationService {
  constructor() {
    this.scheduledTasks = new Map();
    this.automationRules = new Map();
    this.isRunning = false;

    // Test alert configuration - disabled by default
    this.testAlertConfig = {
      enabled: false,
      chance: 10,      // percentage (1-50)
      interval: 30     // seconds (10-120)
    };
    this.dataPollingInterval = null;
  }

  /**
   * Get current test alert configuration
   * @returns {Object} Test alert config
   */
  getTestAlertConfig() {
    return { ...this.testAlertConfig };
  }

  /**
   * Update test alert configuration
   * @param {Object} config - New configuration
   * @returns {Object} Updated config
   */
  setTestAlertConfig(config) {
    if (typeof config.enabled === 'boolean') {
      this.testAlertConfig.enabled = config.enabled;
    }

    if (typeof config.chance === 'number') {
      // Clamp to 1-50%
      this.testAlertConfig.chance = Math.max(1, Math.min(50, config.chance));
    }

    if (typeof config.interval === 'number') {
      // Clamp to 10-120 seconds
      this.testAlertConfig.interval = Math.max(10, Math.min(120, config.interval));
    }

    // Restart polling with new interval if running
    if (this.isRunning && this.dataPollingInterval) {
      this.restartDataPolling();
    }

    console.log(`Test alert config updated: enabled=${this.testAlertConfig.enabled}, chance=${this.testAlertConfig.chance}%, interval=${this.testAlertConfig.interval}s`);
    return this.getTestAlertConfig();
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
    // Refresh court schedule every 5 minutes
    const courtRefresh = cron.schedule('*/5 * * * *', async () => {
      console.log('Running scheduled court schedule refresh...');
      await this.updateCourtScheduleLayers();
    }, { scheduled: false });

    courtRefresh.start();
    this.scheduledTasks.set('court_refresh', courtRefresh);

    // Update court schedule every morning at 8 AM
    const morningUpdate = cron.schedule('0 8 * * *', async () => {
      console.log('Running morning court schedule update...');
      await this.updateCourtScheduleLayers();
    }, { scheduled: false });

    morningUpdate.start();
    this.scheduledTasks.set('morning_update', morningUpdate);

    // Clean up old court schedules daily at 2 AM
    const courtCleanup = cron.schedule('0 2 * * *', async () => {
      console.log('Running court schedule cleanup...');
      await courtDisplayService.cleanupOldSchedules(24);
    }, { scheduled: false });

    courtCleanup.start();
    this.scheduledTasks.set('court_cleanup', courtCleanup);

    // Refresh data layers every 5 minutes
    const dataRefresh = cron.schedule('*/5 * * * *', async () => {
      await this.refreshDataLayers();
    }, { scheduled: false });

    dataRefresh.start();
    this.scheduledTasks.set('data_refresh', dataRefresh);
  }

  startDataPolling() {
    // Poll for external data changes using configurable interval
    const intervalMs = this.testAlertConfig.interval * 1000;
    this.dataPollingInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.checkForDataUpdates();
      }
    }, intervalMs);
  }

  restartDataPolling() {
    if (this.dataPollingInterval) {
      clearInterval(this.dataPollingInterval);
      this.dataPollingInterval = null;
    }
    this.startDataPolling();
    console.log(`Data polling restarted with ${this.testAlertConfig.interval}s interval`);
  }

  async updateCourtScheduleLayers() {
    try {
      const result = await courtDisplayService.refreshScheduleDisplay();
      console.log(`Court schedule refresh complete: ${result.tvs_updated} TVs, ${result.hearings_displayed} hearings, ${result.layers_created} layers created, ${result.layers_removed} layers removed`);
      return result;
    } catch (error) {
      console.error('Error updating court schedule layers:', error);
      return { error: error.message };
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
      // Check for test alerts (when enabled via UI)
      const testAlerts = await this.fetchEmergencyAlerts();

      for (const alert of testAlerts) {
        await alertService.broadcastAlert({
          title: alert.message.split(' - ')[0] || 'Test Alert',
          message: alert.message,
          type: 'INFO',
          target_type: 'all',
          auto_dismiss_ms: alert.duration || 60000,
          created_by: 'test-generator'
        });
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
    // Only generate test alerts if enabled via UI
    if (!this.testAlertConfig.enabled) {
      return [];
    }

    // Generate random test alerts based on configured chance
    const random = Math.random() * 100;

    if (random < this.testAlertConfig.chance) {
      const testMessages = [
        'Security alert in Building A - Please remain calm',
        'Fire drill in progress - Please proceed to nearest exit',
        'Weather advisory: Severe thunderstorm warning',
        'System maintenance scheduled in 30 minutes',
        'Visitor announcement: John Smith to main lobby'
      ];
      const message = testMessages[Math.floor(Math.random() * testMessages.length)];

      console.log(`🧪 Test alert generated (${this.testAlertConfig.chance}% chance): ${message}`);
      return [{
        type: 'test',
        message: `[TEST] ${message}`,
        duration: 60000 // 1 minute for test alerts
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