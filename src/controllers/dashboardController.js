const TV = require('../models/tv.multilayer');
const Image = require('../models/image');
const mqttService = require('../services/multilayer.mqttService');

class DashboardController {
  /**
   * @openapi
   * /api/dashboard:
   *   get:
   *     summary: Get dashboard overview
   *     description: Returns system overview with TV status and image statistics
   *     tags:
   *       - Dashboard
   *     responses:
   *       200:
   *         description: Dashboard data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 stats:
   *                   type: object
   *                   properties:
   *                     total_tvs:
   *                       type: integer
   *                     online_tvs:
   *                       type: integer
   *                     offline_tvs:
   *                       type: integer
   *                     total_images:
   *                       type: integer
   *                     active_images:
   *                       type: integer
   *                     last_updated:
   *                       type: string
   *                       format: date-time
   *                 tvs:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       location:
   *                         type: string
   *                       status:
   *                         type: string
   *                       current_image_id:
   *                         type: string
   *                       last_heartbeat:
   *                         type: string
   */
  async getOverview(req, res) {
    const [storedTvs, allImages] = await Promise.all([
      TV.findAll(),
      Image.findAll()
    ]);
    const allTvs = storedTvs.map(tv => mqttService.applyLiveState(tv));

    const stats = {
      total_tvs: allTvs.length,
      online_tvs: allTvs.filter(tv => tv.status === 'online').length,
      offline_tvs: allTvs.filter(tv => tv.status === 'offline').length,
      total_images: allImages.length,
      active_images: allImages.filter(img => img.status === 'active').length,
      last_updated: new Date().toISOString()
    };

    // Full TV records so the dashboard cards get _id, metrics and slideshow state
    const tvStatus = allTvs.map(tv => ({
      ...tv.toJSON(),
      id: tv._id,
      current_image_id: tv.current_image
    }));

    res.json({
      stats,
      tvs: tvStatus
    });
  }
}

module.exports = new DashboardController();