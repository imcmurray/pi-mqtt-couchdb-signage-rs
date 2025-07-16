const TV = require('../models/tv');
const Image = require('../models/image');

class DashboardController {
  async getOverview(req, res) {
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
  }
}

module.exports = new DashboardController();