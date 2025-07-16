const BaseModel = require('./BaseModel');

class TV extends BaseModel {
  constructor(data) {
    super(data, 'tv');
    
    // TV-specific fields
    this.name = data.name;
    this.location = data.location;
    this.ip_address = data.ip_address;
    this.status = data.status || 'offline';
    this.current_image = data.current_image || null;
    this.last_heartbeat = data.last_heartbeat || null;
    this.config = {
      transition_effect: data.config?.transition_effect || 'fade',
      display_duration: data.config?.display_duration || 5000,
      resolution: data.config?.resolution || '1920x1080',
      orientation: data.config?.orientation || 'landscape',
      // Layer configuration for Phase 2
      layers: data.config?.layers || {
        slideshow: {
          enabled: true,
          position: { x: 0, y: 0, width: 1920, height: 1080 },
          priority: 1,
          opacity: 1.0
        }
      },
      layer_settings: data.config?.layer_settings || {
        max_layers: 10,
        compositing_timeout_ms: 5000,
        cache_composites: true
      }
    };
  }

  static async findAll() {
    return BaseModel.findAll('tvs', TV);
  }

  static async findById(id) {
    return BaseModel.findById(id, 'tv', TV);
  }

  static async findByStatus(status) {
    return BaseModel.findByView('tvs', 'by_status', status, TV);
  }

  async save() {
    // Validate required fields before saving
    this.validateRequired(['name', 'location', 'ip_address']);
    return super.save();
  }

  // update() method is inherited from BaseModel

  // delete() method is inherited from BaseModel

  /**
   * Update TV heartbeat and set status to online
   * @returns {Promise<Object>} Updated TV document
   */
  async updateHeartbeat() {
    return this.update({ 
      last_heartbeat: new Date().toISOString(),
      status: 'online'
    });
  }

  /**
   * Get TVs that haven't sent heartbeat within timeout period
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Array>} Array of offline TVs
   */
  static async findOffline(timeoutMs = 60000) {
    const allTvs = await this.findAll();
    const now = new Date();
    
    return allTvs.filter(tv => {
      if (tv.status !== 'online' || !tv.last_heartbeat) {
        return false;
      }
      const lastHeartbeat = new Date(tv.last_heartbeat);
      return (now - lastHeartbeat) > timeoutMs;
    });
  }

  /**
   * Get summary statistics for all TVs
   * @returns {Promise<Object>} Statistics object
   */
  static async getStats() {
    const allTvs = await this.findAll();
    
    return {
      total: allTvs.length,
      online: allTvs.filter(tv => tv.status === 'online').length,
      offline: allTvs.filter(tv => tv.status === 'offline').length,
      byLocation: allTvs.reduce((acc, tv) => {
        acc[tv.location] = (acc[tv.location] || 0) + 1;
        return acc;
      }, {})
    };
  }

  /**
   * Check if TV supports layer system
   * @returns {boolean} True if TV has layer configuration
   */
  hasLayerSupport() {
    return !!(this.config?.layers && this.config?.layer_settings);
  }

  /**
   * Get active layers for this TV
   * @returns {Array} Array of enabled layers
   */
  getActiveLayers() {
    if (!this.config?.layers) return [];
    
    return Object.entries(this.config.layers)
      .filter(([_, layer]) => layer.enabled)
      .map(([id, layer]) => ({ id, ...layer }))
      .sort((a, b) => a.priority - b.priority);
  }
}

module.exports = TV;