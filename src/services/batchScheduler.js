const Layer = require('../models/Layer');
const TV = require('../models/tv.multilayer');
const Preset = require('../models/Preset');
const cron = require('node-cron');

/**
 * Batch Scheduler Service
 * Schedules layer operations to execute at specific times
 */

class BatchScheduler {
  constructor() {
    this.scheduledTasks = new Map();
    this.isRunning = false;
  }

  /**
   * Start the batch scheduler
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.loadScheduledTasks();
    console.log('Batch scheduler started');
  }

  /**
   * Stop the batch scheduler
   */
  stop() {
    this.isRunning = false;

    // Clear all scheduled tasks
    this.scheduledTasks.forEach(task => {
      if (task.cronJob) {
        task.cronJob.stop();
      }
    });
    this.scheduledTasks.clear();

    console.log('Batch scheduler stopped');
  }

  /**
   * Load scheduled tasks from database or config
   */
  async loadScheduledTasks() {
    // In a production system, these would be loaded from a database
    // For now, we'll set up some common default schedules

    // Enable court schedule at 8 AM weekdays
    this.addRecurringSchedule({
      name: 'enable_court_schedule',
      cronPattern: '0 8 * * 1-5', // 8 AM Mon-Fri
      action: 'set_layer_visibility',
      params: {
        tag: 'court-schedule',
        visible: true
      }
    });

    // Disable court schedule at 5 PM weekdays
    this.addRecurringSchedule({
      name: 'disable_court_schedule',
      cronPattern: '0 17 * * 1-5', // 5 PM Mon-Fri
      action: 'set_layer_visibility',
      params: {
        tag: 'court-schedule',
        visible: false
      }
    });

    // Example: Apply different presets during business hours
    // Morning preset at 7:30 AM
    this.addRecurringSchedule({
      name: 'morning_preset',
      cronPattern: '30 7 * * 1-5',
      action: 'apply_preset',
      params: {
        preset_id: 'court-schedule-left',
        location: 'Lobby'
      }
    });

    console.log(`Loaded ${this.scheduledTasks.size} scheduled tasks`);
  }

  /**
   * Add a recurring scheduled task
   */
  addRecurringSchedule(config) {
    const { name, cronPattern, action, params } = config;

    // Validate cron pattern
    if (!cron.validate(cronPattern)) {
      console.error(`Invalid cron pattern for ${name}: ${cronPattern}`);
      return false;
    }

    // Create cron job
    const cronJob = cron.schedule(cronPattern, async () => {
      console.log(`Running scheduled task: ${name}`);
      await this.executeScheduledAction(action, params);
    }, { scheduled: true });

    this.scheduledTasks.set(name, {
      name,
      cronPattern,
      action,
      params,
      cronJob,
      type: 'recurring',
      created_at: new Date()
    });

    console.log(`Added recurring schedule: ${name} (${cronPattern})`);
    return true;
  }

  /**
   * Schedule a one-time action at specific time
   */
  scheduleOnce(config) {
    const { name, executeAt, action, params } = config;

    const executeTime = new Date(executeAt);
    const now = new Date();

    if (executeTime <= now) {
      console.error(`Cannot schedule task in the past: ${name}`);
      return false;
    }

    const delay = executeTime.getTime() - now.getTime();

    const timeoutId = setTimeout(async () => {
      console.log(`Executing scheduled task: ${name}`);
      await this.executeScheduledAction(action, params);

      // Remove from scheduled tasks after execution
      this.scheduledTasks.delete(name);
    }, delay);

    this.scheduledTasks.set(name, {
      name,
      executeAt,
      action,
      params,
      timeoutId,
      type: 'once',
      created_at: new Date()
    });

    console.log(`Scheduled one-time task: ${name} at ${executeTime.toISOString()}`);
    return true;
  }

  /**
   * Execute a scheduled action
   */
  async executeScheduledAction(action, params) {
    try {
      switch (action) {
        case 'set_layer_visibility':
          await this.setLayerVisibility(params.tag, params.visible);
          break;

        case 'apply_preset':
          await this.applyPresetToLocation(params.preset_id, params.location);
          break;

        case 'create_layer':
          await this.createLayerOnTVs(params.tv_ids || params.location, params.layer_config);
          break;

        case 'delete_layers':
          await this.deleteLayersByTag(params.tag, params.tv_ids || params.location);
          break;

        case 'send_command':
          await this.sendCommandToTVs(params.tv_ids || params.location, params.command);
          break;

        default:
          console.error(`Unknown scheduled action: ${action}`);
      }
    } catch (error) {
      console.error(`Error executing scheduled action ${action}:`, error);
    }
  }

  /**
   * Set visibility of layers by tag
   */
  async setLayerVisibility(tag, visible) {
    try {
      const allLayers = await Layer.findAll();
      const taggedLayers = allLayers.filter(layer =>
        layer.tags && layer.tags.includes(tag)
      );

      console.log(`Setting visibility of ${taggedLayers.length} layers with tag "${tag}" to ${visible}`);

      for (const layer of taggedLayers) {
        await layer.setVisibility(visible, { duration: 500 });
      }
    } catch (error) {
      console.error('Error setting layer visibility:', error);
    }
  }

  /**
   * Apply preset to all TVs in a location
   */
  async applyPresetToLocation(presetId, location) {
    try {
      const allTVs = await TV.findAll();
      const locationTVs = allTVs.filter(tv =>
        tv.location === location && tv.hasLayerSupport()
      );

      console.log(`Applying preset "${presetId}" to ${locationTVs.length} TVs in ${location}`);

      const preset = await Preset.findByPresetId(presetId);
      if (!preset) {
        console.error(`Preset not found: ${presetId}`);
        return;
      }

      for (const tv of locationTVs) {
        const layerConfigs = preset.applyToTV(tv._id);
        for (const config of layerConfigs) {
          const layer = new Layer(config);
          await layer.save();
        }
      }
    } catch (error) {
      console.error('Error applying preset to location:', error);
    }
  }

  /**
   * Create layer on multiple TVs
   */
  async createLayerOnTVs(target, layerConfig) {
    try {
      let tvs;

      if (Array.isArray(target)) {
        // Array of TV IDs
        tvs = await Promise.all(target.map(id => TV.findById(id)));
        tvs = tvs.filter(tv => tv && tv.hasLayerSupport());
      } else {
        // Location string
        const allTVs = await TV.findAll();
        tvs = allTVs.filter(tv =>
          tv.location === target && tv.hasLayerSupport()
        );
      }

      console.log(`Creating layer on ${tvs.length} TVs`);

      for (const tv of tvs) {
        const layer = new Layer({ ...layerConfig, tv_id: tv._id });
        await layer.save();
      }
    } catch (error) {
      console.error('Error creating layers:', error);
    }
  }

  /**
   * Delete layers by tag
   */
  async deleteLayersByTag(tag, target) {
    try {
      let tvIds;

      if (Array.isArray(target)) {
        tvIds = target;
      } else {
        // Location string
        const allTVs = await TV.findAll();
        tvIds = allTVs
          .filter(tv => tv.location === target)
          .map(tv => tv._id);
      }

      for (const tvId of tvIds) {
        const layers = await Layer.findByTv(tvId);
        const taggedLayers = layers.filter(layer =>
          layer.tags && layer.tags.includes(tag)
        );

        for (const layer of taggedLayers) {
          await layer.delete();
        }
      }

      console.log(`Deleted layers with tag "${tag}" from ${tvIds.length} TVs`);
    } catch (error) {
      console.error('Error deleting layers:', error);
    }
  }

  /**
   * Send command to TVs
   */
  async sendCommandToTVs(target, command) {
    try {
      let tvs;

      if (Array.isArray(target)) {
        tvs = await Promise.all(target.map(id => TV.findById(id)));
        tvs = tvs.filter(tv => tv);
      } else {
        const allTVs = await TV.findAll();
        tvs = allTVs.filter(tv => tv.location === target);
      }

      const mqttService = require('./multilayer.mqttService');
      if (!mqttService.isConnected()) {
        console.error('MQTT not connected, cannot send command');
        return;
      }

      for (const tv of tvs) {
        await mqttService.publishCommand(tv.tv_id, command, {});
      }

      console.log(`Sent command "${command}" to ${tvs.length} TVs`);
    } catch (error) {
      console.error('Error sending command:', error);
    }
  }

  /**
   * Remove a scheduled task
   */
  removeSchedule(name) {
    const task = this.scheduledTasks.get(name);

    if (!task) {
      return false;
    }

    if (task.cronJob) {
      task.cronJob.stop();
    } else if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }

    this.scheduledTasks.delete(name);
    console.log(`Removed scheduled task: ${name}`);
    return true;
  }

  /**
   * Get all scheduled tasks
   */
  getScheduledTasks() {
    return Array.from(this.scheduledTasks.values()).map(task => ({
      name: task.name,
      type: task.type,
      action: task.action,
      params: task.params,
      cronPattern: task.cronPattern,
      executeAt: task.executeAt,
      created_at: task.created_at
    }));
  }

  /**
   * Get task by name
   */
  getTask(name) {
    const task = this.scheduledTasks.get(name);
    if (!task) return null;

    return {
      name: task.name,
      type: task.type,
      action: task.action,
      params: task.params,
      cronPattern: task.cronPattern,
      executeAt: task.executeAt,
      created_at: task.created_at
    };
  }
}

// Create singleton instance
const batchScheduler = new BatchScheduler();

module.exports = batchScheduler;
