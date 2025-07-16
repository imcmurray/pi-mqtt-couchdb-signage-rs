const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// GET /api/dashboard/overview - Get dashboard overview
router.get('/overview', async (req, res, next) => {
  try {
    await dashboardController.getOverview(req, res);
  } catch (error) {
    next(error);
  }
});

module.exports = router;