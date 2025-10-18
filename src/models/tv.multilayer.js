const BaseModel = require('./BaseModel');
const multilayerDb = require('../config/multilayer.database');

class TVMultilayer extends BaseModel {
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
      // Enhanced layer configuration for multi-layer system
      layers: data.config?.layers || {
        slideshow: {
          enabled: true,
          position: { x: 0, y: 0, width: 1920, height: 1080 },
          priority: 1,
          opacity: 1.0
        }
      },
      layer_settings: data.config?.layer_settings || {
        max_layers: 50, // Increased for individual data rows
        compositing_timeout_ms: 5000,
        cache_composites: true,
        enable_animations: true,
        animation_fps: 60
      }
    };
  }

  // Get the appropriate database for TVs
  static getDb() {
    return multilayerDb.getDatabase('tvs');
  }

  static async findAll() {
    const db = this.getDb();
    const result = await db.view('tvs', 'all');
    return result.rows.map(row => new TVMultilayer(row.value));
  }

  static async findById(id) {
    const db = this.getDb();
    try {
      const doc = await db.get(id);
      return doc.type === 'tv' ? new TVMultilayer(doc) : null;
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  static async findByStatus(status) {
    const db = this.getDb();
    const result = await db.view('tvs', 'by_status', { key: status });
    return result.rows.map(row => new TVMultilayer(row.value));
  }

  static async findWithLayerSupport() {
    const db = this.getDb();
    const result = await db.view('tvs', 'by_layer_support', { key: true });
    return result.rows.map(row => new TVMultilayer(row.value));
  }

  static async findByLocation(location) {
    const allTVs = await this.findAll();
    return allTVs.filter(tv => tv.location === location);
  }

  async save() {
    // Validate required fields before saving
    this.validateRequired(['name', 'location', 'ip_address']);
    
    const db = TVMultilayer.getDb();
    const doc = this.toJSON();
    
    if (this._id && this._rev) {
      const result = await db.insert({ ...doc, _id: this._id, _rev: this._rev });
      this._rev = result.rev;
    } else {
      const result = await db.insert(doc);
      this._id = result.id;
      this._rev = result.rev;
    }
    
    return this;
  }

  async update(updates) {
    Object.assign(this, updates);
    this.updated_at = new Date().toISOString();
    return this.save();
  }

  async delete() {
    if (!this._id || !this._rev) {
      throw new Error('Cannot delete TV without _id and _rev');
    }
    const db = TVMultilayer.getDb();
    return db.destroy(this._id, this._rev);
  }

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
      withLayers: allTvs.filter(tv => tv.hasLayerSupport()).length,
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

  /**
   * Update layer configuration
   * @param {Object} layerConfig - New layer configuration
   * @returns {Promise<Object>} Updated TV document
   */
  async updateLayerConfig(layerConfig) {
    this.config.layers = { ...this.config.layers, ...layerConfig };
    return this.save();
  }

  /**
   * Update layer settings
   * @param {Object} layerSettings - New layer settings
   * @returns {Promise<Object>} Updated TV document
   */
  async updateLayerSettings(layerSettings) {
    this.config.layer_settings = { ...this.config.layer_settings, ...layerSettings };
    return this.save();
  }
}

module.exports = TVMultilayer;