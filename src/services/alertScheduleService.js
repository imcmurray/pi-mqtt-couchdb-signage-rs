const cron = require('node-cron');
const Alert = require('../models/Alert');
const alertService = require('./alertService');

class AlertScheduleService {
  constructor() {
    this.scheduledJobs = new Map();
    this.cronJob = null;
  }

  start() {
    if (this.cronJob) {
      return;
    }

    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkScheduledAlerts();
    });

    console.log('✅ Alert schedule service started (checking every minute)');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    this.scheduledJobs.forEach(job => {
      if (job.timeout) {
        clearTimeout(job.timeout);
      }
    });

    this.scheduledJobs.clear();
    console.log('❌ Alert schedule service stopped');
  }

  async scheduleAlert(alertData, scheduleOptions) {
    const alert = new Alert({
      ...alertData,
      status: 'scheduled',
      scheduled_for: scheduleOptions.scheduled_for,
      is_scheduled: true,
      recurrence_pattern: scheduleOptions.recurrence_pattern || null,
      recurrence_end: scheduleOptions.recurrence_end || null
    });

    await alert.save();

    const scheduledTime = new Date(scheduleOptions.scheduled_for);
    const now = new Date();

    if (scheduledTime <= now) {
      return {
        alert,
        scheduled: false,
        error: 'Scheduled time must be in the future'
      };
    }

    const timeUntil = scheduledTime - now;

    if (timeUntil < 86400000) {
      const timeout = setTimeout(async () => {
        await this.executeScheduledAlert(alert.alert_id);
        this.scheduledJobs.delete(alert.alert_id);
      }, timeUntil);

      this.scheduledJobs.set(alert.alert_id, {
        alert_id: alert.alert_id,
        scheduled_for: scheduleOptions.scheduled_for,
        timeout
      });
    }

    console.log(`📅 Alert "${alert.title}" scheduled for ${scheduleOptions.scheduled_for}`);

    return {
      alert,
      scheduled: true,
      scheduled_for: scheduleOptions.scheduled_for,
      time_until_ms: timeUntil
    };
  }

  async executeScheduledAlert(alertId) {
    try {
      const alerts = await Alert.findAll();
      const alert = alerts.find(a => a.alert_id === alertId);

      if (!alert || alert.status !== 'scheduled') {
        console.log(`⚠️ Scheduled alert ${alertId} not found or already executed`);
        return;
      }

      console.log(`⏰ Executing scheduled alert: ${alert.title}`);

      alert.status = 'active';
      alert.is_scheduled = false;
      await alert.save();

      const result = await alertService.broadcastAlert(alert.toJSON());

      if (alert.recurrence_pattern && alert.recurrence_end) {
        await this.scheduleRecurrence(alert);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to execute scheduled alert ${alertId}:`, error);
      throw error;
    }
  }

  async scheduleRecurrence(alert) {
    const nextSchedule = this.calculateNextRecurrence(
      new Date(alert.scheduled_for),
      alert.recurrence_pattern
    );

    if (!nextSchedule || nextSchedule > new Date(alert.recurrence_end)) {
      console.log(`🏁 Recurrence ended for alert: ${alert.title}`);
      return;
    }

    const recurringAlert = new Alert({
      ...alert.toJSON(),
      _id: undefined,
      _rev: undefined,
      alert_id: alert.generateAlertId(),
      scheduled_for: nextSchedule.toISOString(),
      status: 'scheduled',
      created_at: new Date().toISOString()
    });

    await this.scheduleAlert(recurringAlert.toJSON(), {
      scheduled_for: nextSchedule.toISOString(),
      recurrence_pattern: alert.recurrence_pattern,
      recurrence_end: alert.recurrence_end
    });

    console.log(`🔄 Recurring alert rescheduled for ${nextSchedule.toISOString()}`);
  }

  calculateNextRecurrence(currentDate, pattern) {
    const next = new Date(currentDate);

    switch (pattern) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;

      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;

      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;

      case 'hourly':
        next.setHours(next.getHours() + 1);
        break;

      default:
        return null;
    }

    return next;
  }

  async checkScheduledAlerts() {
    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 3600000);

      const alerts = await Alert.findAll();
      const scheduledAlerts = alerts.filter(a =>
        a.status === 'scheduled' &&
        a.scheduled_for &&
        new Date(a.scheduled_for) <= oneHourFromNow
      );

      for (const alert of scheduledAlerts) {
        const scheduledTime = new Date(alert.scheduled_for);

        if (scheduledTime <= now) {
          await this.executeScheduledAlert(alert.alert_id);
        } else if (!this.scheduledJobs.has(alert.alert_id)) {
          const timeUntil = scheduledTime - now;

          const timeout = setTimeout(async () => {
            await this.executeScheduledAlert(alert.alert_id);
            this.scheduledJobs.delete(alert.alert_id);
          }, timeUntil);

          this.scheduledJobs.set(alert.alert_id, {
            alert_id: alert.alert_id,
            scheduled_for: alert.scheduled_for,
            timeout
          });

          console.log(`⏱️ Loaded scheduled alert: ${alert.title} (${Math.round(timeUntil / 1000)}s until execution)`);
        }
      }
    } catch (error) {
      console.error('Error checking scheduled alerts:', error);
    }
  }

  async cancelScheduledAlert(alertId) {
    const alerts = await Alert.findAll();
    const alert = alerts.find(a => a.alert_id === alertId);

    if (!alert || alert.status !== 'scheduled') {
      throw new Error('Scheduled alert not found');
    }

    alert.status = 'cancelled';
    await alert.save();

    if (this.scheduledJobs.has(alertId)) {
      const job = this.scheduledJobs.get(alertId);
      if (job.timeout) {
        clearTimeout(job.timeout);
      }
      this.scheduledJobs.delete(alertId);
    }

    console.log(`🚫 Cancelled scheduled alert: ${alert.title}`);
    return alert;
  }

  async getScheduledAlerts() {
    const alerts = await Alert.findAll();
    return alerts.filter(a => a.status === 'scheduled');
  }

  async getUpcomingAlerts(limitHours = 24) {
    const now = new Date();
    const futureLimit = new Date(now.getTime() + (limitHours * 3600000));

    const alerts = await Alert.findAll();
    return alerts.filter(a =>
      a.status === 'scheduled' &&
      a.scheduled_for &&
      new Date(a.scheduled_for) > now &&
      new Date(a.scheduled_for) <= futureLimit
    ).sort((a, b) =>
      new Date(a.scheduled_for) - new Date(b.scheduled_for)
    );
  }

  getScheduleStatistics() {
    const stats = {
      total_scheduled: this.scheduledJobs.size,
      in_memory_jobs: this.scheduledJobs.size,
      upcoming_executions: []
    };

    for (const [alertId, job] of this.scheduledJobs.entries()) {
      const timeUntil = new Date(job.scheduled_for) - new Date();

      stats.upcoming_executions.push({
        alert_id: alertId,
        scheduled_for: job.scheduled_for,
        time_until_ms: Math.max(0, timeUntil)
      });
    }

    stats.upcoming_executions.sort((a, b) => a.time_until_ms - b.time_until_ms);

    return stats;
  }
}

module.exports = new AlertScheduleService();
