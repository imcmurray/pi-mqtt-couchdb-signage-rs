const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { asyncHandler } = require('../middleware/errorHandler');

// Notifications (ntfy), fleet versions and backups
router.get('/notifications', asyncHandler(systemController.getNotifications));
router.put('/notifications', asyncHandler(systemController.setNotifications));
router.post('/notifications/test', asyncHandler(systemController.testNotification));
router.get('/fleet', asyncHandler(systemController.getFleet));
router.get('/backups', asyncHandler(systemController.getBackups));
router.post('/backups', asyncHandler(systemController.runBackup));
router.get('/backups/:file', asyncHandler(systemController.downloadBackup));

module.exports = router;
