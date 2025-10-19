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
        type: alert.type,
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
        type: alert.type,
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
}

module.exports = new AlertController();
