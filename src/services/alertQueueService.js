const Alert = require('../models/Alert');
const Layer = require('../models/Layer');
const mqtt = require('./multilayer.mqttService');

class AlertQueueService {
  constructor() {
    this.queue = [];
    this.currentAlerts = new Map();
    this.processing = false;
    this.processingInterval = null;
  }

  start() {
    if (this.processingInterval) {
      return;
    }

    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, 1000);

    console.log('✅ Alert queue service started');
  }

  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    console.log('❌ Alert queue service stopped');
  }

  enqueue(alert, targetTvIds) {
    const queueItem = {
      alert,
      target_tv_ids: targetTvIds,
      queued_at: new Date().toISOString(),
      queue_position: this.queue.length
    };

    if (alert.alert_type === 'CRITICAL') {
      this.queue.unshift(queueItem);
      this.interruptCurrentAlerts(alert.alert_id);
      console.log(`🚨 CRITICAL alert "${alert.title}" added to front of queue (bypassing)`);
    } else {
      this.queue.push(queueItem);
      console.log(`📥 Alert "${alert.title}" added to queue (position ${this.queue.length})`);
    }

    this.updateQueuePositions();

    return queueItem;
  }

  interruptCurrentAlerts(criticalAlertId) {
    for (const [tvId, currentAlert] of this.currentAlerts.entries()) {
      if (currentAlert.alert.alert_type !== 'CRITICAL') {
        console.log(`⏸️ Interrupting ${currentAlert.alert.alert_type} alert on ${tvId} for CRITICAL alert`);

        currentAlert.interrupted_by = criticalAlertId;

        setTimeout(() => {
          this.currentAlerts.delete(tvId);
        }, 600);
      }
    }
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      const availableTvs = this.getAvailableTvs();

      if (availableTvs.length === 0) {
        this.processing = false;
        return;
      }

      const queueItem = this.queue[0];
      const targetTvs = queueItem.target_tv_ids.filter(tvId => availableTvs.includes(tvId));

      if (targetTvs.length === 0) {
        this.processing = false;
        return;
      }

      this.queue.shift();
      this.updateQueuePositions();

      for (const tvId of targetTvs) {
        this.currentAlerts.set(tvId, {
          alert: queueItem.alert,
          tv_id: tvId,
          started_at: new Date().toISOString(),
          interrupted_by: null
        });

        console.log(`▶️ Playing alert "${queueItem.alert.title}" on ${tvId}`);
      }

      this.scheduleAlertCompletion(queueItem.alert, targetTvs);
    } catch (error) {
      console.error('Error processing queue:', error);
    } finally {
      this.processing = false;
    }
  }

  scheduleAlertCompletion(alert, tvIds) {
    setTimeout(() => {
      for (const tvId of tvIds) {
        const current = this.currentAlerts.get(tvId);

        if (current && current.alert.alert_id === alert.alert_id && !current.interrupted_by) {
          this.currentAlerts.delete(tvId);
          console.log(`⏹️ Alert "${alert.title}" completed on ${tvId}`);
        }
      }
    }, alert.auto_dismiss_ms || 120000);
  }

  getAvailableTvs() {
    const allTvIds = new Set();

    for (const queueItem of this.queue) {
      queueItem.target_tv_ids.forEach(tvId => allTvIds.add(tvId));
    }

    return Array.from(allTvIds).filter(tvId => !this.currentAlerts.has(tvId));
  }

  updateQueuePositions() {
    this.queue.forEach((item, index) => {
      item.queue_position = index;
    });
  }

  dequeue(alertId) {
    const index = this.queue.findIndex(item => item.alert.alert_id === alertId);

    if (index === -1) {
      return null;
    }

    const removed = this.queue.splice(index, 1)[0];
    this.updateQueuePositions();

    console.log(`🗑️ Alert "${removed.alert.title}" removed from queue`);
    return removed;
  }

  clearQueue() {
    const count = this.queue.length;
    this.queue = [];

    console.log(`🧹 Cleared ${count} alerts from queue`);
    return count;
  }

  getQueueStatus() {
    return {
      queue_length: this.queue.length,
      current_alerts_count: this.currentAlerts.size,
      queue: this.queue.map(item => ({
        alert_id: item.alert.alert_id,
        title: item.alert.title,
        alert_type: item.alert.alert_type,
        priority: item.alert.priority,
        target_tv_count: item.target_tv_ids.length,
        queued_at: item.queued_at,
        queue_position: item.queue_position
      })),
      current_alerts: Array.from(this.currentAlerts.entries()).map(([tvId, current]) => ({
        tv_id: tvId,
        alert_id: current.alert.alert_id,
        title: current.alert.title,
        alert_type: current.alert.alert_type,
        started_at: current.started_at,
        interrupted_by: current.interrupted_by
      }))
    };
  }

  isAlertInQueue(alertId) {
    return this.queue.some(item => item.alert.alert_id === alertId);
  }

  isAlertCurrentlyPlaying(alertId) {
    for (const current of this.currentAlerts.values()) {
      if (current.alert.alert_id === alertId) {
        return true;
      }
    }
    return false;
  }

  getQueuePosition(alertId) {
    const queueItem = this.queue.find(item => item.alert.alert_id === alertId);
    return queueItem ? queueItem.queue_position : -1;
  }

  getEstimatedWaitTime(alertId) {
    const position = this.getQueuePosition(alertId);

    if (position === -1) {
      return 0;
    }

    let totalTime = 0;

    for (let i = 0; i < position; i++) {
      const item = this.queue[i];
      totalTime += item.alert.auto_dismiss_ms || 120000;
    }

    const transitionTime = position * 1200;

    return totalTime + transitionTime;
  }

  reorderQueue() {
    this.queue.sort((a, b) => {
      if (a.alert.priority !== b.alert.priority) {
        return b.alert.priority - a.alert.priority;
      }

      return new Date(a.queued_at) - new Date(b.queued_at);
    });

    this.updateQueuePositions();
    console.log('🔄 Queue reordered by priority and timestamp');
  }

  getQueueStatistics() {
    const stats = {
      total_queued: this.queue.length,
      total_playing: this.currentAlerts.size,
      by_type: {
        CRITICAL: 0,
        URGENT: 0,
        INFO: 0
      },
      average_wait_time: 0,
      longest_wait_time: 0
    };

    const now = new Date();

    this.queue.forEach(item => {
      stats.by_type[item.alert.alert_type]++;

      const queuedTime = now - new Date(item.queued_at);
      if (queuedTime > stats.longest_wait_time) {
        stats.longest_wait_time = queuedTime;
      }
    });

    if (this.queue.length > 0) {
      const totalWaitTime = this.queue.reduce((sum, item) => {
        return sum + (now - new Date(item.queued_at));
      }, 0);
      stats.average_wait_time = totalWaitTime / this.queue.length;
    }

    return stats;
  }
}

module.exports = new AlertQueueService();
