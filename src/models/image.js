const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Image {
  constructor(data) {
    this._id = data._id || `image_${uuidv4()}`;
    this._rev = data._rev; // Include revision for CouchDB updates
    this.type = 'image';
    this.original_name = data.original_name;
    this.size = data.size;
    this.mimetype = data.mimetype;
    this.assigned_tvs = data.assigned_tvs || []; // Array of TV IDs this image is assigned to
    this.tv_orders = data.tv_orders || {}; // Object mapping TV ID to order position
    this.status = data.status || 'active';
    this.metadata = {
      width: data.metadata?.width,
      height: data.metadata?.height,
      description: data.metadata?.description || '',
      tags: data.metadata?.tags || []
    };
    this.schedule = {
      start_time: data.schedule?.start_time,
      end_time: data.schedule?.end_time,
      days_of_week: data.schedule?.days_of_week || []
    };
    this.created_at = data.created_at || new Date().toISOString();
    this.updated_at = new Date().toISOString();
  }

  static async findAll() {
    const db = getDatabase();
    try {
      const result = await db.view('images', 'all');
      return result.rows
        .map(row => new Image(row.value))
        .filter(img => img.status === 'active');
    } catch (error) {
      console.error('Error finding all images:', error);
      throw error;
    }
  }

  static async findById(id) {
    const db = getDatabase();
    try {
      const doc = await db.get(id);
      return doc.type === 'image' ? new Image(doc) : null;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  static async findByTvId(tvId) {
    const db = getDatabase();
    try {
      const result = await db.view('images', 'by_tv', { key: tvId });
      const images = result.rows
        .map(row => new Image(row.value))
        .filter(img => img.status === 'active')
        .sort((a, b) => (a.tv_orders[tvId] || 0) - (b.tv_orders[tvId] || 0));
      return images;
    } catch (error) {
      console.error('Error finding images by TV ID:', error);
      throw error;
    }
  }

  static async findByStatus(status) {
    const db = getDatabase();
    try {
      const result = await db.view('images', 'by_status', { key: status });
      return result.rows.map(row => new Image(row.value));
    } catch (error) {
      console.error('Error finding images by status:', error);
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
      console.error('Error saving image:', error);
      throw error;
    }
  }

  async saveWithAttachment(imageBuffer, contentType) {
    const db = getDatabase();
    try {
      this.updated_at = new Date().toISOString();
      
      // First create the document
      const result = await db.insert(this);
      this._rev = result.rev;
      
      // Then attach the image data
      const attachmentName = `image${this.getFileExtension()}`;
      await db.attachment.insert(this._id, attachmentName, imageBuffer, contentType, { rev: this._rev });
      
      // Get updated document with new revision
      const updated = await db.get(this._id);
      this._rev = updated._rev;
      
      return this;
    } catch (error) {
      console.error('Error saving image with attachment:', error);
      throw error;
    }
  }

  async getAttachment() {
    const db = getDatabase();
    try {
      const attachmentName = `image${this.getFileExtension()}`;
      return await db.attachment.get(this._id, attachmentName);
    } catch (error) {
      console.error('Error getting image attachment:', error);
      throw error;
    }
  }

  getFileExtension() {
    const ext = this.original_name ? require('path').extname(this.original_name) : '.png';
    return ext || '.png';
  }

  getAttachmentName() {
    return `image${this.getFileExtension()}`;
  }

  async update(updates) {
    const db = getDatabase();
    try {
      const existing = await db.get(this._id);
      const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
      const result = await db.insert(updated);
      return { ...updated, _rev: result.rev };
    } catch (error) {
      console.error('Error updating image:', error);
      throw error;
    }
  }

  async delete() {
    const db = getDatabase();
    try {
      const existing = await db.get(this._id);
      
      // Delete attachments first (if any exist)
      if (existing._attachments) {
        for (const attachmentName of Object.keys(existing._attachments)) {
          try {
            await db.attachment.destroy(existing._id, attachmentName, existing._rev);
            // Get updated revision after attachment deletion
            const updated = await db.get(existing._id);
            existing._rev = updated._rev;
          } catch (attachError) {
            console.error(`Error deleting attachment ${attachmentName}:`, attachError);
          }
        }
      }
      
      // Delete the document
      await db.destroy(existing._id, existing._rev);
      return true;
    } catch (error) {
      console.error('Error deleting image:', error);
      throw error;
    }
  }

  async updateOrderForTv(tvId, newOrder) {
    const tv_orders = { ...this.tv_orders, [tvId]: newOrder };
    return this.update({ tv_orders });
  }

  async assignToTv(tvId, order = 0) {
    const assigned_tvs = [...new Set([...this.assigned_tvs, tvId])];
    const tv_orders = { ...this.tv_orders, [tvId]: order };
    return this.update({ assigned_tvs, tv_orders });
  }

  async unassignFromTv(tvId) {
    const assigned_tvs = this.assigned_tvs.filter(id => id !== tvId);
    const tv_orders = { ...this.tv_orders };
    delete tv_orders[tvId];
    return this.update({ assigned_tvs, tv_orders });
  }

  async bulkAssignToTvs(tvIds, startOrder = 0) {
    const assigned_tvs = [...new Set([...this.assigned_tvs, ...tvIds])];
    const tv_orders = { ...this.tv_orders };
    tvIds.forEach((tvId, index) => {
      tv_orders[tvId] = startOrder + index;
    });
    return this.update({ assigned_tvs, tv_orders });
  }
}

module.exports = Image;