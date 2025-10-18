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

// Get specific alert
router.get('/:alertId', asyncHandler(alertController.getAlertById));

module.exports = router;
