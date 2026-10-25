const express = require('express');
const router = express.Router();
const datasetController = require('../controllers/datasetController');
const { asyncHandler } = require('../middleware/errorHandler');

// Data sets that feed live layers (court calendar tables, weather tokens)
router.get('/', asyncHandler(datasetController.listDatasets));
router.get('/court_calendar/sample', asyncHandler(datasetController.getCalendarSample));
router.get('/court_calendar/source', asyncHandler(datasetController.getCalendarSource));
router.put('/court_calendar/source', asyncHandler(datasetController.setCalendarSource));
router.delete('/court_calendar/source', asyncHandler(datasetController.clearCalendarSource));
router.put('/court_calendar', asyncHandler(datasetController.uploadCalendar));
router.get('/:id', asyncHandler(datasetController.getDataset));

module.exports = router;
