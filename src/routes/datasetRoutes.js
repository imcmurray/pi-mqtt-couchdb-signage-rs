const express = require('express');
const router = express.Router();
const datasetController = require('../controllers/datasetController');
const { asyncHandler } = require('../middleware/errorHandler');

// Data sets that feed live layers (court calendar tables, weather tokens)
router.get('/', asyncHandler(datasetController.listDatasets));
router.get('/court_calendar/sample', asyncHandler(datasetController.getCalendarSample));
router.put('/court_calendar', asyncHandler(datasetController.uploadCalendar));
router.get('/:id', asyncHandler(datasetController.getDataset));

module.exports = router;
