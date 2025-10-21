const express = require('express');
const router = express.Router();
const courtHearingController = require('../controllers/courtHearingController');
const { asyncHandler } = require('../middleware/errorHandler');

// Create new hearing
router.post('/', asyncHandler(courtHearingController.createHearing));

// Get all hearings
router.get('/', asyncHandler(courtHearingController.getAllHearings));

// Get today's schedule
router.get('/today', asyncHandler(courtHearingController.getTodaysSchedule));

// Get upcoming hearings
router.get('/upcoming', asyncHandler(courtHearingController.getUpcomingHearings));

// Get hearings by date
router.get('/date/:date', asyncHandler(courtHearingController.getHearingsByDate));

// Get hearings by court room
router.get('/room/:room', asyncHandler(courtHearingController.getHearingsByRoom));

// Get statistics
router.get('/stats', asyncHandler(courtHearingController.getStats));

// Refresh display
router.post('/refresh-display', asyncHandler(courtHearingController.refreshDisplay));

// Import from CSV
router.post('/import', asyncHandler(courtHearingController.importFromCSV));

// Import from JSON
router.post('/import/json', asyncHandler(courtHearingController.importFromJSON));

// Get specific hearing
router.get('/:id', asyncHandler(courtHearingController.getHearingById));

// Update hearing
router.put('/:id', asyncHandler(courtHearingController.updateHearing));

// Delete hearing
router.delete('/:id', asyncHandler(courtHearingController.deleteHearing));

// Status management
router.post('/:id/delay', asyncHandler(courtHearingController.markDelayed));
router.post('/:id/in-progress', asyncHandler(courtHearingController.markInProgress));
router.post('/:id/complete', asyncHandler(courtHearingController.markCompleted));
router.post('/:id/cancel', asyncHandler(courtHearingController.cancelHearing));

module.exports = router;
