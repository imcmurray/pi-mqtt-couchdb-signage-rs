const express = require('express');
const router = express.Router();
const TV = require('../models/tv');
const Image = require('../models/image');

// GET /api/dashboard/overview - Get dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const [allTvs, allImages] = await Promise.all([
      TV.findAll(),
      Image.findAll()
    ]);

    const stats = {
      total_tvs: allTvs.length,
      online_tvs: allTvs.filter(tv => tv.status === 'online').length,
      offline_tvs: allTvs.filter(tv => tv.status === 'offline').length,
      total_images: allImages.length,
      active_images: allImages.filter(img => img.status === 'active').length,
      last_updated: new Date().toISOString()
    };

    const tvStatus = allTvs.map(tv => ({
      id: tv._id,
      name: tv.name,
      location: tv.location,
      status: tv.status,
      current_image_id: tv.current_image,
      last_heartbeat: tv.last_heartbeat,
      assigned_images_count: allImages.filter(img => img.assigned_tvs.includes(tv._id)).length
    }));

    res.json({
      stats,
      tvs: tvStatus
    });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard overview' });
  }
});

module.exports = router;