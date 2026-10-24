const express = require('express');
const router = express.Router();
const demoService = require('../services/demoService');
const { asyncHandler } = require('../middleware/errorHandler');

// Guided tour on one TV: scenes, overlays and alerts, then everything is put back
router.get('/', (req, res) => res.json(demoService.status()));

router.post('/:tvId', asyncHandler(async (req, res) => {
  try {
    res.status(202).json(await demoService.start(req.params.tvId));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}));

router.delete('/:tvId', (req, res) => {
  if (!demoService.stop(req.params.tvId)) return res.status(404).json({ error: 'No demo is running on this TV' });
  res.json({ message: 'Stopping the demo and restoring the TV' });
});

module.exports = router;
