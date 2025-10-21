const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { asyncHandler } = require('../middleware/errorHandler');

// Broadcast emergency alert
router.post('/broadcast', asyncHandler(alertController.broadcastAlert));

// Dismiss alert
router.post('/:alertId/dismiss', asyncHandler(alertController.dismissAlert));

// Get active alerts
router.get('/active', asyncHandler(alertController.getActiveAlerts));

// Get alert history
router.get('/history', asyncHandler(alertController.getAlertHistory));

// Get alert statistics
router.get('/stats', asyncHandler(alertController.getAlertStats));

// Queue management (must come before /:alertId to avoid matching 'queue' as alert ID)
router.get('/queue', asyncHandler(alertController.getQueueStatus));
router.post('/queue/clear', asyncHandler(alertController.clearQueue));
router.delete('/queue/:alertId', asyncHandler(alertController.removeFromQueue));

// Alert scheduling (must come before /:alertId)
router.post('/schedule', asyncHandler(alertController.scheduleAlert));
router.get('/scheduled', asyncHandler(alertController.getScheduledAlerts));
router.delete('/scheduled/:alertId', asyncHandler(alertController.cancelScheduledAlert));

// Alert preview (must come before /:alertId)
router.post('/preview', asyncHandler(alertController.previewAlert));

// Get specific alert (this must come last among GET routes)
router.get('/:alertId', asyncHandler(alertController.getAlertById));

module.exports = router;
