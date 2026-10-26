const alertService = require('./alertService');

// Test alert generator for the Alert Templates page: when switched on, every
// `interval` seconds there's a `chance`% of an INFO alert on every TV, to see
// alerts working without composing one. Off by default and after a restart.
// (Live data comes from data sets now: see datasetService, calendarSourceService
// and weatherService.)
const TEST_MESSAGES = [
  'Security alert in Building A - Please remain calm',
  'Fire drill in progress - Please proceed to nearest exit',
  'Weather advisory: Severe thunderstorm warning',
  'System maintenance scheduled in 30 minutes',
  'Visitor announcement: John Smith to main lobby'
];

class LayerAutomationService {
  constructor() {
    this.isRunning = false;
    this.testAlertConfig = {
      enabled: false,
      chance: 10,      // percentage (1-50)
      interval: 30     // seconds (10-120)
    };
    this.pollingInterval = null;
  }

  getTestAlertConfig() {
    return { ...this.testAlertConfig };
  }

  setTestAlertConfig(config) {
    if (typeof config.enabled === 'boolean') {
      this.testAlertConfig.enabled = config.enabled;
    }
    if (typeof config.chance === 'number') {
      this.testAlertConfig.chance = Math.max(1, Math.min(50, config.chance));
    }
    if (typeof config.interval === 'number') {
      this.testAlertConfig.interval = Math.max(10, Math.min(120, config.interval));
    }
    if (this.isRunning) this.restartPolling();

    console.log(`Test alert config updated: enabled=${this.testAlertConfig.enabled}, chance=${this.testAlertConfig.chance}%, interval=${this.testAlertConfig.interval}s`);
    return this.getTestAlertConfig();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startPolling();
  }

  stop() {
    this.isRunning = false;
    clearInterval(this.pollingInterval);
    this.pollingInterval = null;
  }

  startPolling() {
    this.pollingInterval = setInterval(() => this.maybeSendTestAlert(), this.testAlertConfig.interval * 1000);
  }

  restartPolling() {
    clearInterval(this.pollingInterval);
    this.startPolling();
  }

  async maybeSendTestAlert() {
    if (!this.isRunning || !this.testAlertConfig.enabled) return;
    if (Math.random() * 100 >= this.testAlertConfig.chance) return;
    const message = TEST_MESSAGES[Math.floor(Math.random() * TEST_MESSAGES.length)];
    console.log(`🧪 Test alert generated (${this.testAlertConfig.chance}% chance): ${message}`);
    try {
      await alertService.broadcastAlert({
        title: message.split(' - ')[0],
        message: `[TEST] ${message}`,
        type: 'INFO',
        target_type: 'all',
        auto_dismiss_ms: 60000,
        created_by: 'test-generator'
      });
    } catch (error) {
      console.error('Error sending test alert:', error);
    }
  }
}

module.exports = new LayerAutomationService();
