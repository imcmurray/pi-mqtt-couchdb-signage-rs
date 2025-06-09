const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class TV {
  constructor(data) {
    this._id = data._id || `tv_${uuidv4()}`;
    this._rev = data._rev; // Include _rev for CouchDB updates
    this.type = 'tv';
    this.name = data.name;
    this.location = data.location;
    this.ip_address = data.ip_address;
    this.status = data.status || 'offline';
    this.current_image = data.current_image || null;
    this.last_heartbeat = data.last_heartbeat || null;
    this.config = {
      transition_effect: data.config?.transition_effect || 'fade',
      display_duration: data.config?.display_duration || 5000,
      resolution: data.config?.resolution || '1920x1080'
    };
    this.created_at = data.created_at || new Date().toISOString();
    this.updated_at = new Date().toISOString();
  }

  static async findAll() {
    const db = getDatabase();
    try {
      const result = await db.view('tvs', 'all');
      return result.rows.map(row => row.value);
    } catch (error) {
      console.error('Error finding all TVs:', error);
      throw error;
    }
  }

  static async findById(id) {
    const db = getDatabase();
    try {
      const doc = await db.get(id);
      return doc.type === 'tv' ? new TV(doc) : null;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  static async findByStatus(status) {
    const db = getDatabase();
    try {
      const result = await db.view('tvs', 'by_status', { key: status });
      return result.rows.map(row => row.value);
    } catch (error) {
      console.error('Error finding TVs by status:', error);
      throw error;
    }
  }

  async save() {
    const db = getDatabase();
    try {
      this.updated_at = new Date().toISOString();
      const result = await db.insert(this);
      this._rev = result.rev;
      return this;
    } catch (error) {
      console.error('Error saving TV:', error);
      throw error;
    }
  }

  async update(updates) {
    const db = getDatabase();
    try {
      const existing = await db.get(this._id);
      const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
      const result = await db.insert(updated);
      return { ...updated, _rev: result.rev };
    } catch (error) {
      console.error('Error updating TV:', error);
      throw error;
    }
  }

  async delete() {
    const db = getDatabase();
    try {
      const existing = await db.get(this._id);
      await db.destroy(existing._id, existing._rev);
      return true;
    } catch (error) {
      console.error('Error deleting TV:', error);
      throw error;
    }
  }

  async updateHeartbeat() {
    return this.update({ 
      last_heartbeat: new Date().toISOString(),
      status: 'online'
    });
  }
}

module.exports = TV;