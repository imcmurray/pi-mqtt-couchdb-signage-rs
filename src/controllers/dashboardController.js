const TV = require('../models/tv');
const Image = require('../models/image');

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
   *                       assigned_images_count:
   *                         type: integer
   */
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