const alertService = require('../services/alertService');
const Joi = require('joi');

const alertSchema = Joi.object({
  title: Joi.string().required().max(100),
  message: Joi.string().required().max(500),
  type: Joi.string().valid('CRITICAL', 'URGENT', 'INFO').default('INFO'),
  target_type: Joi.string().valid('all', 'specific', 'location').default('all'),
  target_ids: Joi.array().items(Joi.string()).when('target_type', {
    is: 'specific',
    then: Joi.required()
  }),
  target_location: Joi.string().when('target_type', {
    is: 'location',
    then: Joi.required()
  }),
  auto_dismiss_ms: Joi.number().min(0).optional(),
  created_by: Joi.string().default('admin')
});

class AlertController {
  async broadcastAlert(req, res) {
    const { error, value } = alertSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const result = await alertService.broadcastAlert(value);

    res.status(201).json({
      success: true,
      data: {
        alert: {
          alert_id: result.alert.alert_id,
          title: result.alert.title,
          message: result.alert.message,
          type: result.alert.type,
          priority: result.alert.priority,
          status: result.alert.status,
          created_at: result.alert.created_at
        },
        delivered_count: result.delivered_count,
        target_count: result.target_count,
        layers_created: result.layers.length
      }
    });
  }

  async dismissAlert(req, res) {
    const { alertId } = req.params;
    const { reason } = req.body;

    const result = await alertService.dismissAlert(alertId, reason);

    res.json({
      success: true,
      data: {
        alert_id: result.alert.alert_id,
        status: result.alert.status,
        dismissed_at: result.alert.dismissed_at,
        layers_dismissed: result.layers_dismissed
      }
    });
  }

  async getActiveAlerts(req, res) {
    const alerts = await alertService.getActiveAlerts();

    res.json({
      success: true,
      data: alerts.map(alert => ({
        alert_id: alert.alert_id,
        title: alert.title,
        message: alert.message,
        type: alert.type,
        priority: alert.priority,
        status: alert.status,
        created_at: alert.created_at,
        target_type: alert.target_type,
        delivered_to_count: alert.delivered_to.length
      }))
    });
  }

  async getAlertHistory(req, res) {
    const limit = parseInt(req.query.limit) || 50;
    const alerts = await alertService.getAlertHistory(limit);

    res.json({
      success: true,
      data: alerts.map(alert => ({
        alert_id: alert.alert_id,
        title: alert.title,
        message: alert.message,
        type: alert.type,
        status: alert.status,
        created_at: alert.created_at,
        dismissed_at: alert.dismissed_at,
        delivered_to_count: alert.delivered_to.length
      }))
    });
  }

  async getAlertStats(req, res) {
    const stats = await alertService.getAlertStats();

    res.json({
      success: true,
      data: stats
    });
  }

  async getAlertById(req, res) {
    const { alertId } = req.params;
    const alert = await alertService.findAlertById(alertId);

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }

    res.json({
      success: true,
      data: alert
    });
  }
}

module.exports = new AlertController();
