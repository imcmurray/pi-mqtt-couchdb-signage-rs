const BaseModel = require('./BaseModel');
const multilayerDb = require('../config/multilayer.database');

/**
 * Preset Model - Zone preset templates for quick layer configuration
 * Supports both built-in system presets and user-created custom presets
 */
class Preset extends BaseModel {
  constructor(data) {
    super(data, 'preset');

    this.preset_id = data.preset_id || this.generatePresetId();
    this.name = data.name || 'Untitled Preset';
    this.description = data.description || '';
    this.is_builtin = data.is_builtin || false;
    this.category = data.category || 'custom'; // 'court', 'emergency', 'info', 'layout', 'custom'

    // Layer configurations
    this.layers = data.layers || [];

    // Preview/thumbnail info
    this.preview = data.preview || {
      thumbnail_url: null,
      screenshot_url: null,
      layout_diagram: this.generateLayoutDiagram()
    };

    // Usage metadata
    this.usage_count = data.usage_count || 0;
    this.last_used = data.last_used || null;
    this.created_by = data.created_by || 'system';
    this.tags = data.tags || [];
  }

  generatePresetId() {
    return `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate ASCII layout diagram for preview
   */
  generateLayoutDiagram() {
    if (!this.layers || this.layers.length === 0) {
      return '┌────────────┐\n│            │\n│   Empty    │\n│            │\n└────────────┘';
    }

    const grid = Array(10).fill(null).map(() => Array(20).fill(' '));

    this.layers.forEach((layer, index) => {
      const pos = layer.position || { x: 0, y: 0, width: 1920, height: 1080 };
      const startX = Math.floor((pos.x / 1920) * 20);
      const startY = Math.floor((pos.y / 1080) * 10);
      const endX = Math.min(Math.floor(((pos.x + pos.width) / 1920) * 20), 19);
      const endY = Math.min(Math.floor(((pos.y + pos.height) / 1080) * 10), 9);

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          if (y >= 0 && y < 10 && x >= 0 && x < 20) {
            grid[y][x] = String(index + 1);
          }
        }
      }
    });

    return '┌' + '─'.repeat(20) + '┐\n' +
           grid.map(row => '│' + row.join('') + '│').join('\n') +
           '\n└' + '─'.repeat(20) + '┘';
  }

  /**
   * Get database for presets
   */
  static getDb() {
    return multilayerDb.getDatabase('layers');
  }

  /**
   * Find all presets
   */
  static async findAll() {
    const db = this.getDb();
    const result = await db.view('presets', 'all');
    return result.rows.map(row => new Preset(row.value));
  }

  /**
   * Find preset by ID
   */
  static async findById(id) {
    const db = this.getDb();
    try {
      const doc = await db.get(id);
      return doc.type === 'preset' ? new Preset(doc) : null;
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  /**
   * Find preset by preset_id
   */
  static async findByPresetId(presetId) {
    const allPresets = await this.findAll();
    return allPresets.find(p => p.preset_id === presetId);
  }

  /**
   * Find presets by category
   */
  static async findByCategory(category) {
    const allPresets = await this.findAll();
    return allPresets.filter(p => p.category === category);
  }

  /**
   * Find all built-in presets
   */
  static async findBuiltIn() {
    const allPresets = await this.findAll();
    return allPresets.filter(p => p.is_builtin === true);
  }

  /**
   * Find custom (user-created) presets
   */
  static async findCustom() {
    const allPresets = await this.findAll();
    return allPresets.filter(p => p.is_builtin === false);
  }

  /**
   * Get most used presets
   */
  static async findMostUsed(limit = 5) {
    const allPresets = await this.findAll();
    return allPresets
      .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
      .slice(0, limit);
  }

  /**
   * Save preset to database
   */
  async save() {
    this.validateRequired(['preset_id', 'name', 'layers']);

    if (!Array.isArray(this.layers)) {
      throw new Error('Layers must be an array');
    }

    if (this.layers.length === 0) {
      throw new Error('Preset must contain at least one layer');
    }

    // Validate layer structure
    this.layers.forEach((layer, index) => {
      if (!layer.layer_type) {
        throw new Error(`Layer ${index} missing layer_type`);
      }
      if (!layer.position || typeof layer.position !== 'object') {
        throw new Error(`Layer ${index} missing valid position`);
      }
    });

    // Regenerate layout diagram
    this.preview.layout_diagram = this.generateLayoutDiagram();

    const db = Preset.getDb();
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

  /**
   * Update preset
   */
  async update(updates) {
    Object.assign(this, updates);
    this.updated_at = new Date().toISOString();
    return this.save();
  }

  /**
   * Delete preset
   */
  async delete() {
    if (this.is_builtin) {
      throw new Error('Cannot delete built-in presets');
    }

    if (!this._id || !this._rev) {
      throw new Error('Cannot delete preset without _id and _rev');
    }

    const db = Preset.getDb();
    return db.destroy(this._id, this._rev);
  }

  /**
   * Increment usage counter
   */
  async recordUsage() {
    this.usage_count = (this.usage_count || 0) + 1;
    this.last_used = new Date().toISOString();
    return this.save();
  }

  /**
   * Clone preset as custom preset
   */
  async clone(newName) {
    const cloned = new Preset({
      ...this.toJSON(),
      name: newName || `${this.name} (Copy)`,
      is_builtin: false,
      created_by: 'user',
      usage_count: 0,
      last_used: null
    });

    delete cloned._id;
    delete cloned._rev;
    cloned.preset_id = cloned.generatePresetId();

    await cloned.save();
    return cloned;
  }

  /**
   * Apply this preset to a TV
   * Returns the layer configurations that should be created
   */
  applyToTV(tvId) {
    return this.layers.map(layerConfig => ({
      ...layerConfig,
      tv_id: tvId,
      tags: [...(layerConfig.tags || []), 'from-preset', `preset:${this.preset_id}`],
      metadata: {
        ...(layerConfig.metadata || {}),
        applied_from_preset: this.preset_id,
        preset_name: this.name,
        applied_at: new Date().toISOString()
      }
    }));
  }

  /**
   * Validate preset structure
   */
  static validatePresetStructure(presetData) {
    if (!presetData.name || typeof presetData.name !== 'string') {
      return { valid: false, error: 'Preset must have a name' };
    }

    if (!Array.isArray(presetData.layers) || presetData.layers.length === 0) {
      return { valid: false, error: 'Preset must contain at least one layer' };
    }

    for (let i = 0; i < presetData.layers.length; i++) {
      const layer = presetData.layers[i];

      if (!layer.layer_type) {
        return { valid: false, error: `Layer ${i} missing layer_type` };
      }

      if (!layer.position) {
        return { valid: false, error: `Layer ${i} missing position` };
      }

      const { x, y, width, height } = layer.position;
      if (typeof x !== 'number' || typeof y !== 'number' ||
          typeof width !== 'number' || typeof height !== 'number') {
        return { valid: false, error: `Layer ${i} has invalid position values` };
      }

      if (x < 0 || y < 0 || width <= 0 || height <= 0) {
        return { valid: false, error: `Layer ${i} has negative or zero dimensions` };
      }
    }

    return { valid: true };
  }
}

module.exports = Preset;
