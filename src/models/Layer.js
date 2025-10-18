const BaseModel = require('./BaseModel');
const multilayerDb = require('../config/multilayer.database');

class Layer extends BaseModel {
  constructor(data) {
    super(data, 'layer');
    
    // Layer identification
    this.tv_id = data.tv_id;
    this.layer_id = data.layer_id || this.generateLayerId();
    this.name = data.name || `Layer ${this.layer_id}`;
    
    // Layer type and content
    this.layer_type = data.layer_type || 'DataRow'; // DataRow, StaticOverlay, DynamicText, Emergency
    this.content = data.content || {
      text: '',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textColor: 'rgba(255, 255, 255, 1)',
      fontSize: 24,
      fontFamily: 'Arial',
      padding: 10,
      alignment: 'left' // left, center, right
    };
    
    // Position and dimensions
    this.position = data.position || {
      x: 0,
      y: 0,
      width: 1920,
      height: 40
    };
    
    // Target position for animations
    this.target_position = data.target_position || null;
    
    // Visibility and rendering
    this.visible = data.visible !== undefined ? data.visible : true;
    this.opacity = data.opacity !== undefined ? data.opacity : 1.0;
    this.priority = data.priority || 10; // Higher number = on top
    
    // Animation state
    this.animation_state = data.animation_state || {
      active: false,
      type: null, // 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_in', 'fade_out'
      start_time: null,
      duration: 500,
      easing: 'ease-in-out',
      progress: 0
    };
    
    // Scheduling
    this.schedule = data.schedule || {
      enabled: false,
      show_at: null,
      hide_at: null,
      auto_hide_after_ms: null
    };
    
    // Metadata
    this.tags = data.tags || [];
    this.group = data.group || null;
  }

  generateLayerId() {
    return `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get the appropriate database for layers
  static getDb() {
    return multilayerDb.getDatabase('layers');
  }

  static async findAll() {
    const db = this.getDb();
    const result = await db.view('layers', 'all');
    return result.rows.map(row => new Layer(row.value));
  }

  static async findById(id) {
    const db = this.getDb();
    try {
      const doc = await db.get(id);
      return doc.type === 'layer' ? new Layer(doc) : null;
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  static async findByTv(tvId) {
    const db = this.getDb();
    const result = await db.view('layers', 'by_tv', { key: tvId });
    return result.rows.map(row => new Layer(row.value));
  }

  static async findActiveByTv(tvId) {
    const db = this.getDb();
    const result = await db.view('layers', 'active_by_tv', { key: tvId });
    return result.rows.map(row => new Layer(row.value));
  }

  static async findByPriority(tvId) {
    const db = this.getDb();
    const result = await db.view('layers', 'by_priority', {
      startkey: [tvId, 0],
      endkey: [tvId, 999]
    });
    return result.rows.map(row => new Layer(row.value));
  }

  async save() {
    this.validateRequired(['tv_id', 'layer_id', 'layer_type']);
    
    // Validate position
    if (!this.position || typeof this.position.x !== 'number' || 
        typeof this.position.y !== 'number' || typeof this.position.width !== 'number' || 
        typeof this.position.height !== 'number') {
      throw new Error('Invalid position configuration');
    }
    
    // Validate opacity
    if (this.opacity < 0 || this.opacity > 1) {
      throw new Error('Opacity must be between 0 and 1');
    }
    
    const db = Layer.getDb();
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
      throw new Error('Cannot delete layer without _id and _rev');
    }
    const db = Layer.getDb();
    return db.destroy(this._id, this._rev);
  }

  // Animation methods
  async startAnimation(animationType, duration = 500, easing = 'ease-in-out') {
    const validAnimations = ['slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_in', 'fade_out'];
    if (!validAnimations.includes(animationType)) {
      throw new Error(`Invalid animation type: ${animationType}`);
    }
    
    this.animation_state = {
      active: true,
      type: animationType,
      start_time: new Date().toISOString(),
      duration,
      easing,
      progress: 0
    };
    
    // Set target position based on animation type
    switch (animationType) {
      case 'slide_up':
        this.target_position = { ...this.position, y: this.position.y - 100 };
        break;
      case 'slide_down':
        this.target_position = { ...this.position, y: this.position.y + 100 };
        break;
      case 'slide_left':
        this.target_position = { ...this.position, x: this.position.x - 100 };
        break;
      case 'slide_right':
        this.target_position = { ...this.position, x: this.position.x + 100 };
        break;
    }
    
    return this.save();
  }

  async completeAnimation() {
    if (this.target_position) {
      this.position = this.target_position;
      this.target_position = null;
    }
    
    this.animation_state = {
      active: false,
      type: null,
      start_time: null,
      duration: 500,
      easing: 'ease-in-out',
      progress: 0
    };
    
    return this.save();
  }

  async setVisibility(visible, transition = null) {
    this.visible = visible;
    
    if (transition) {
      if (visible) {
        await this.startAnimation('fade_in', transition.duration || 500, transition.easing || 'ease-in-out');
      } else {
        await this.startAnimation('fade_out', transition.duration || 500, transition.easing || 'ease-in-out');
      }
    } else {
      await this.save();
    }
  }

  async move(x, y, animate = false, duration = 500) {
    if (animate) {
      this.target_position = { ...this.position, x, y };
      await this.startAnimation('move', duration);
    } else {
      this.position.x = x;
      this.position.y = y;
      await this.save();
    }
  }

  async updateContent(content, transition = null) {
    this.content = { ...this.content, ...content };
    
    if (transition) {
      // Fade out, update, fade in
      await this.startAnimation('fade_out', transition.duration / 2 || 250);
      setTimeout(async () => {
        await this.save();
        await this.startAnimation('fade_in', transition.duration / 2 || 250);
      }, transition.duration / 2 || 250);
    } else {
      await this.save();
    }
  }

  // Helper methods
  isDataRow() {
    return this.layer_type === 'DataRow';
  }

  isAnimating() {
    return this.animation_state.active;
  }

  getAnimationProgress() {
    if (!this.animation_state.active || !this.animation_state.start_time) {
      return 0;
    }
    
    const elapsed = Date.now() - new Date(this.animation_state.start_time).getTime();
    const progress = Math.min(elapsed / this.animation_state.duration, 1);
    return progress;
  }

  // Batch operations
  static async createBatch(layers) {
    const db = this.getDb();
    const docs = layers.map(layer => new Layer(layer).toJSON());
    const results = await db.bulk({ docs });
    return results;
  }

  static async updateBatch(layers) {
    const db = this.getDb();
    const docs = layers.map(layer => ({
      ...layer,
      updated_at: new Date().toISOString()
    }));
    const results = await db.bulk({ docs });
    return results;
  }

  static async deleteBatch(layerIds) {
    const db = this.getDb();
    const layers = await Promise.all(layerIds.map(id => this.findById(id)));
    const docs = layers.filter(layer => layer).map(layer => ({
      _id: layer._id,
      _rev: layer._rev,
      _deleted: true
    }));
    const results = await db.bulk({ docs });
    return results;
  }
}

module.exports = Layer;