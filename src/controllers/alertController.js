const alertService = require('../services/alertService');
const queueService = require('../services/alertQueueService');
const scheduleService = require('../services/alertScheduleService');
const Alert = require('../models/Alert');
const Joi = require('joi');
const { broadcastToClients } = require('../server');

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
  /**
   * @openapi
   * /api/alerts/broadcast:
   *   post:
   *     summary: Broadcast emergency alert
   *     description: Creates and broadcasts an emergency alert to all or specific TVs, creating emergency layers
   *     tags:
   *       - Alerts
   *     security:
   *       - AdminAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *               - message
   *             properties:
   *               title:
   *                 type: string
   *                 maxLength: 100
   *                 description: Alert title
   *                 example: Building Evacuation
   *               message:
   *                 type: string
   *                 maxLength: 500
   *                 description: Alert message content
   *                 example: Please evacuate the building immediately via the nearest exit.
   *               type:
   *                 type: string
   *                 enum: [CRITICAL, URGENT, INFO]
   *                 default: INFO
   *                 description: Alert severity level
   *               target_type:
   *                 type: string
   *                 enum: [all, specific, location]
   *                 default: all
   *                 description: Targeting strategy for alert distribution
   *               target_ids:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Specific TV IDs (required when target_type is 'specific')
   *                 example: ["tv_001", "tv_002"]
   *               target_location:
   *                 type: string
   *                 description: Location filter (required when target_type is 'location')
   *                 example: Building A
   *               auto_dismiss_ms:
   *                 type: integer
   *                 minimum: 0
   *                 description: Auto-dismiss after milliseconds (optional)
   *                 example: 60000
   *               created_by:
   *                 type: string
   *                 default: admin
   *                 description: Alert creator identifier
   *     responses:
   *       201:
   *         description: Alert broadcast successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     alert:
   *                       $ref: '#/components/schemas/Alert'
   *                     delivered_count:
   *                       type: integer
   *                       description: Number of TVs that received the alert
   *                     target_count:
   *                       type: integer
   *                       description: Total number of targeted TVs
   *                     layers_created:
   *                       type: integer
   *                       description: Number of emergency layers created
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   */
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
          alert_type: result.alert.alert_type,
          priority: result.alert.priority,
          status: result.alert.status,
          created_at: result.alert.created_at
        },
        delivered_count: result.delivered_count,
        target_count: result.target_count,
        layers_created: result.layers.length
      }
    });

    broadcastToClients('alerts_updated', { type: 'active' });
    broadcastToClients('alerts_updated', { type: 'queue' });
  }

  /**
   * @openapi
   * /api/alerts/{alertId}/dismiss:
   *   post:
   *     summary: Dismiss alert
   *     description: Dismisses an active alert and removes emergency layers from all affected TVs
   *     tags:
   *       - Alerts
   *     security:
   *       - AdminAuth: []
   *     parameters:
   *       - in: path
   *         name: alertId
   *         required: true
   *         schema:
   *           type: string
   *         description: Alert identifier
   *         example: alert-123
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason:
   *                 type: string
   *                 description: Optional dismissal reason
   *                 example: All clear - false alarm
   *     responses:
   *       200:
   *         description: Alert dismissed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     alert_id:
   *                       type: string
   *                     status:
   *                       type: string
   *                       example: dismissed
   *                     dismissed_at:
   *                       type: string
   *                       format: date-time
   *                     layers_dismissed:
   *                       type: integer
   *                       description: Number of layers removed
   */
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

    broadcastToClients('alerts_updated', { type: 'active' });
    broadcastToClients('alerts_updated', { type: 'queue' });
  }

  /**
   * @openapi
   * /api/alerts/active:
   *   get:
   *     summary: Get active alerts
   *     description: Returns all currently active (non-dismissed) alerts
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: List of active alerts
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Alert'
   */
  async getActiveAlerts(req, res) {
    const alerts = await alertService.getActiveAlerts();

    res.json({
      success: true,
      data: alerts.map(alert => ({
        alert_id: alert.alert_id,
        title: alert.title,
        message: alert.message,
        alert_type: alert.alert_type,
        priority: alert.priority,
        status: alert.status,
        created_at: alert.created_at,
        target_type: alert.target_type,
        delivered_to_count: alert.delivered_to.length
      }))
    });
  }

  /**
   * @openapi
   * /api/alerts/history:
   *   get:
   *     summary: Get alert history
   *     description: Returns historical alerts (both active and dismissed) with optional limit
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *           minimum: 1
   *           maximum: 500
   *         description: Maximum number of alerts to return
   *     responses:
   *       200:
   *         description: Alert history
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Alert'
   */
  async getAlertHistory(req, res) {
    const limit = parseInt(req.query.limit) || 50;
    const alerts = await alertService.getAlertHistory(limit);

    res.json({
      success: true,
      data: alerts.map(alert => ({
        alert_id: alert.alert_id,
        title: alert.title,
        message: alert.message,
        alert_type: alert.alert_type,
        status: alert.status,
        created_at: alert.created_at,
        dismissed_at: alert.dismissed_at,
        delivered_to_count: alert.delivered_to.length
      }))
    });
  }

  /**
   * @openapi
   * /api/alerts/stats:
   *   get:
   *     summary: Get alert statistics
   *     description: Returns aggregated statistics about alert system usage
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: Alert statistics
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     total_alerts:
   *                       type: integer
   *                     active_alerts:
   *                       type: integer
   *                     dismissed_alerts:
   *                       type: integer
   *                     by_type:
   *                       type: object
   *                       properties:
   *                         CRITICAL:
   *                           type: integer
   *                         URGENT:
   *                           type: integer
   *                         INFO:
   *                           type: integer
   */
  async getAlertStats(req, res) {
    const stats = await alertService.getAlertStats();

    res.json({
      success: true,
      data: stats
    });
  }

  /**
   * @openapi
   * /api/alerts/{alertId}:
   *   get:
   *     summary: Get alert by ID
   *     description: Returns detailed information about a specific alert
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: alertId
   *         required: true
   *         schema:
   *           type: string
   *         description: Alert identifier
   *         example: alert-123
   *     responses:
   *       200:
   *         description: Alert found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/Alert'
   *       404:
   *         description: Alert not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: string
   *                   example: Alert not found
   */
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

  /**
   * @openapi
   * /api/alerts/queue:
   *   get:
   *     summary: Get alert queue status
   *     description: Returns current queue status and statistics
   *     tags:
   *       - Alert Queue
   *     responses:
   *       200:
   *         description: Queue status
   */
  async getQueueStatus(req, res) {
    const status = queueService.getQueueStatus();
    const stats = queueService.getQueueStatistics();

    res.json({
      success: true,
      data: {
        ...status,
        statistics: stats
      }
    });
  }

  /**
   * @openapi
   * /api/alerts/queue/clear:
   *   post:
   *     summary: Clear alert queue
   *     description: Removes all queued alerts (does not affect currently playing alerts)
   *     tags:
   *       - Alert Queue
   *     responses:
   *       200:
   *         description: Queue cleared
   */
  async clearQueue(req, res) {
    const count = queueService.clearQueue();

    res.json({
      success: true,
      data: {
        cleared_count: count,
        message: `Cleared ${count} alerts from queue`
      }
    });

    broadcastToClients('alerts_updated', { type: 'queue' });
  }

  /**
   * @openapi
   * /api/alerts/queue/{alertId}:
   *   delete:
   *     summary: Remove alert from queue
   *     description: Removes a specific alert from the queue
   *     tags:
   *       - Alert Queue
   *     parameters:
   *       - in: path
   *         name: alertId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Alert removed from queue
   *       404:
   *         description: Alert not in queue
   */
  async removeFromQueue(req, res) {
    const { alertId } = req.params;

    const removed = queueService.dequeue(alertId);

    if (!removed) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found in queue'
      });
    }

    res.json({
      success: true,
      data: {
        alert_id: removed.alert.alert_id,
        message: 'Alert removed from queue'
      }
    });

    broadcastToClients('alerts_updated', { type: 'queue' });
  }

  /**
   * @openapi
   * /api/alerts/schedule:
   *   post:
   *     summary: Schedule alert for future broadcast
   *     description: Creates a scheduled alert that will broadcast at a specified time
   *     tags:
   *       - Alert Scheduling
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *               - message
   *               - scheduled_for
   *             properties:
   *               title:
   *                 type: string
   *               message:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [CRITICAL, URGENT, INFO]
   *               scheduled_for:
   *                 type: string
   *                 format: date-time
   *               recurrence_pattern:
   *                 type: string
   *                 enum: [hourly, daily, weekly, monthly]
   *               recurrence_end:
   *                 type: string
   *                 format: date-time
   *     responses:
   *       201:
   *         description: Alert scheduled successfully
   */
  async scheduleAlert(req, res) {
    const scheduleSchema = Joi.object({
      title: Joi.string().required().max(100),
      message: Joi.string().required().max(500),
      type: Joi.string().valid('CRITICAL', 'URGENT', 'INFO').default('INFO'),
      target_type: Joi.string().valid('all', 'specific', 'location').default('all'),
      target_ids: Joi.array().items(Joi.string()).optional(),
      target_location: Joi.string().optional(),
      scheduled_for: Joi.string().isoDate().required(),
      recurrence_pattern: Joi.string().valid('hourly', 'daily', 'weekly', 'monthly').optional(),
      recurrence_end: Joi.string().isoDate().optional(),
      created_by: Joi.string().default('admin')
    });

    const { error, value } = scheduleSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    try {
      const result = await scheduleService.scheduleAlert(value, {
        scheduled_for: value.scheduled_for,
        recurrence_pattern: value.recurrence_pattern,
        recurrence_end: value.recurrence_end
      });

      if (!result.scheduled) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.status(201).json({
        success: true,
        data: {
          alert_id: result.alert.alert_id,
          title: result.alert.title,
          scheduled_for: result.scheduled_for,
          time_until_ms: result.time_until_ms,
          recurrence: value.recurrence_pattern ? {
            pattern: value.recurrence_pattern,
            end: value.recurrence_end
          } : null
        }
      });

      broadcastToClients('alerts_updated', { type: 'scheduled' });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/scheduled:
   *   get:
   *     summary: Get scheduled alerts
   *     description: Returns all scheduled alerts or upcoming within specified hours
   *     tags:
   *       - Alert Scheduling
   *     parameters:
   *       - in: query
   *         name: hours
   *         schema:
   *           type: integer
   *           default: 24
   *         description: Limit to alerts within next N hours
   *     responses:
   *       200:
   *         description: List of scheduled alerts
   */
  async getScheduledAlerts(req, res) {
    const hours = parseInt(req.query.hours) || null;

    try {
      const alerts = hours
        ? await scheduleService.getUpcomingAlerts(hours)
        : await scheduleService.getScheduledAlerts();

      res.json({
        success: true,
        data: alerts.map(alert => ({
          alert_id: alert.alert_id,
          title: alert.title,
          message: alert.message,
          alert_type: alert.alert_type,
          scheduled_for: alert.scheduled_for,
          recurrence_pattern: alert.recurrence_pattern,
          recurrence_end: alert.recurrence_end,
          time_until_ms: new Date(alert.scheduled_for) - new Date()
        }))
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/scheduled/{alertId}:
   *   delete:
   *     summary: Cancel scheduled alert
   *     description: Cancels a scheduled alert before it executes
   *     tags:
   *       - Alert Scheduling
   *     parameters:
   *       - in: path
   *         name: alertId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Alert cancelled
   */
  async cancelScheduledAlert(req, res) {
    const { alertId } = req.params;

    try {
      const alert = await scheduleService.cancelScheduledAlert(alertId);

      res.json({
        success: true,
        data: {
          alert_id: alert.alert_id,
          message: 'Scheduled alert cancelled'
        }
      });

      broadcastToClients('alerts_updated', { type: 'scheduled' });
    } catch (err) {
      return res.status(404).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/preview:
   *   post:
   *     summary: Preview alert without broadcasting
   *     description: Generates a preview of how the alert will appear
   *     tags:
   *       - Alert Preview
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *               - message
   *             properties:
   *               title:
   *                 type: string
   *               message:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [CRITICAL, URGENT, INFO]
   *     responses:
   *       200:
   *         description: Preview generated
   */
  async previewAlert(req, res) {
    const previewSchema = Joi.object({
      title: Joi.string().required().max(100),
      message: Joi.string().required().max(500),
      type: Joi.string().valid('CRITICAL', 'URGENT', 'INFO').default('INFO')
    });

    const { error, value } = previewSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    try {
      const alert = new Alert({
        ...value,
        target_type: 'all',
        created_by: 'preview'
      });

      const previewLayer = alert.toLayer('preview_tv');

      res.json({
        success: true,
        data: {
          rendered: {
            title: alert.title,
            message: alert.message,
            alert_type: alert.alert_type,
            priority: alert.priority
          },
          layer: previewLayer,
          visual_treatment: {
            position: previewLayer.position,
            background_color: previewLayer.content.backgroundColor,
            text_color: previewLayer.content.textColor,
            font_size: previewLayer.content.fontSize,
            auto_dismiss_ms: alert.auto_dismiss_ms
          }
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
}

module.exports = new AlertController();
