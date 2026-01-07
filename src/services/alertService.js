const Alert = require('../models/Alert');
const Layer = require('../models/Layer');
const TV = require('../models/tv.multilayer');
const mqtt = require('./multilayer.mqttService');
const queueService = require('./alertQueueService');

class AlertService {
  async broadcastAlert(alertData, options = {}) {
    const useQueue = options.use_queue !== undefined ? options.use_queue : false;

    if (useQueue) {
      return await this.broadcastWithQueue(alertData);
    }

    return await this.broadcastImmediate(alertData);
  }

  async broadcastWithQueue(alertData) {
    const alert = new Alert(alertData);
    alert.status = 'queued';
    await alert.save();

    const targetTVs = await this.getTargetTVs(alert);
    const targetTvIds = targetTVs.map(tv => tv._id);

    alert.queued_at = new Date().toISOString();
    await alert.save();

    const queueItem = queueService.enqueue(alert, targetTvIds);

    return {
      alert,
      queued: true,
      queue_position: queueItem.queue_position,
      estimated_wait_ms: queueService.getEstimatedWaitTime(alert.alert_id),
      target_count: targetTvIds.length
    };
  }

  async broadcastImmediate(alertData) {
    const alert = new Alert(alertData);
    await alert.save();

    const targetTVs = await this.getTargetTVs(alert);
    const createdLayers = [];

    for (const tv of targetTVs) {
      try {
        const layerData = alert.toLayer(tv._id);
        const layer = new Layer(layerData);
        await layer.save();

        await this.publishAlertToTV(tv._id, layer);

        await alert.markDelivered(tv._id);
        createdLayers.push(layer);

        console.log(`✅ Alert ${alert.alert_id} delivered to TV ${tv._id}`);
      } catch (error) {
        console.error(`❌ Failed to deliver alert to TV ${tv._id}:`, error.message);
      }
    }

    // Schedule auto-dismiss
    if (alert.auto_dismiss_ms > 0) {
      this.scheduleAutoDismiss(alert, createdLayers);
    }

    return {
      alert,
      delivered_count: createdLayers.length,
      target_count: targetTVs.length,
      layers: createdLayers
    };
  }

  async getTargetTVs(alert) {
    switch (alert.target_type) {
      case 'all':
        return await TV.findAll();

      case 'specific':
        if (!alert.target_ids || alert.target_ids.length === 0) {
          throw new Error('No target TV IDs specified');
        }
        const tvs = [];
        for (const tvId of alert.target_ids) {
          const tv = await TV.findById(tvId);
          if (tv) tvs.push(tv);
        }
        return tvs;

      case 'location':
        if (!alert.target_location) {
          throw new Error('No target location specified');
        }
        return await TV.findByLocation(alert.target_location);

      default:
        throw new Error(`Unknown target type: ${alert.target_type}`);
    }
  }

  async publishAlertToTV(tvId, layer) {
    const mqttTvId = tvId.replace(/^tv_/, '');
    const topic = `signage/tv/${mqttTvId}/alert`;
    const message = {
      type: 'emergency_alert',
      alert_id: layer.group,
      layer: {
        layer_id: layer.layer_id,
        priority: layer.priority,
        content: layer.content,
        position: layer.position,
        schedule: layer.schedule
      },
      timestamp: new Date().toISOString()
    };

    mqtt.publish(topic, message);
    console.log(`📡 Published alert to ${topic}`);
  }

  scheduleAutoDismiss(alert, layers) {
    setTimeout(async () => {
      try {
        for (const layer of layers) {
          // Find and delete the layer
          const existingLayer = await Layer.findById(layer._id);
          if (existingLayer && existingLayer.visible) {
            await existingLayer.setVisibility(false, { duration: 500 });

            // Wait for fade out, then delete
            setTimeout(async () => {
              await existingLayer.delete();
            }, 600);
          }
        }

        await alert.expire();
        console.log(`⏰ Auto-dismissed alert ${alert.alert_id}`);
      } catch (error) {
        console.error(`Failed to auto-dismiss alert ${alert.alert_id}:`, error.message);
      }
    }, alert.auto_dismiss_ms);
  }

  async dismissAlert(alertId, reason = 'manual') {
    const alert = await this.findAlertById(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }

    if (!alert.isActive()) {
      throw new Error('Alert is not active');
    }

    const layers = await Layer.findByGroup(`alert_${alertId}`);

    for (const layer of layers) {
      await layer.setVisibility(false, { duration: 500 });

      setTimeout(async () => {
        try {
          await layer.delete();
        } catch (error) {
          console.error(`Failed to delete layer ${layer._id}:`, error.message);
        }
      }, 600);
    }

    await alert.dismiss(reason);

    return {
      alert,
      layers_dismissed: layers.length
    };
  }

  async findAlertById(alertId) {
    const alerts = await Alert.findAll();
    return alerts.find(a => a.alert_id === alertId);
  }

  async getActiveAlerts() {
    return await Alert.findActive();
  }

  async getAlertHistory(limit = 50) {
    return await Alert.findRecent(limit);
  }

  async getAlertStats() {
    const allAlerts = await Alert.findAll();
    const activeAlerts = allAlerts.filter(a => a.status === 'active');
    const dismissedAlerts = allAlerts.filter(a => a.status === 'dismissed');
    const expiredAlerts = allAlerts.filter(a => a.status === 'expired');

    const byType = {
      CRITICAL: allAlerts.filter(a => a.type === 'CRITICAL').length,
      URGENT: allAlerts.filter(a => a.type === 'URGENT').length,
      INFO: allAlerts.filter(a => a.type === 'INFO').length
    };

    return {
      total: allAlerts.length,
      active: activeAlerts.length,
      dismissed: dismissedAlerts.length,
      expired: expiredAlerts.length,
      by_type: byType
    };
  }
}

module.exports = new AlertService();
