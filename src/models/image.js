const multilayerDb = require('../config/multilayer.database');
const BaseModel = require('./BaseModel');

class Image extends BaseModel {
  constructor(data) {
    super(data, 'image');

    // Image-specific fields
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
  }

  static getDb() {
    return multilayerDb.getDatabase('images');
  }

  static async findAll() {
    const db = this.getDb();
    try {
      const result = await db.view('images', 'all');
      const images = result.rows.map(row => new Image(row.value));
      return images.filter(img => img.status === 'active');
    } catch (error) {
      console.error('Error finding all Images:', error);
      throw error;
    }
  }

  static async findById(id) {
    const db = this.getDb();
    try {
      const doc = await db.get(id);
      if (doc.type !== 'image') {
        throw new Error('Document is not an image');
      }
      return new Image(doc);
    } catch (error) {
      console.error('Error finding Image by ID:', error);
      throw error;
    }
  }

  /**
   * Find all images assigned to a specific TV
   * @param {string} tvId - The TV ID
   * @returns {Promise<Array>} Array of images sorted by order
   */
  static async findByTvId(tvId) {
    const db = this.getDb();
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
    const db = this.getDb();
    try {
      const result = await db.view('images', 'by_status', { key: status });
      return result.rows.map(row => new Image(row.value));
    } catch (error) {
      console.error('Error finding images by status:', error);
      throw error;
    }
  }

  async save() {
    // Validate required fields before saving
    this.validateRequired(['original_name', 'size', 'mimetype']);

    const db = Image.getDb();
    this.updated_at = new Date().toISOString();

    try {
      if (this._rev) {
        const result = await db.insert({ ...this.toJSON(), _id: this._id, _rev: this._rev });
        this._rev = result.rev;
      } else {
        const result = await db.insert(this.toJSON());
        this._id = result.id;
        this._rev = result.rev;
      }
      return this;
    } catch (error) {
      console.error('Error saving Image:', error);
      throw error;
    }
  }

  async saveWithAttachment(imageBuffer, contentType) {
    const db = Image.getDb();
    let documentCreated = false;

    try {
      this.updated_at = new Date().toISOString();

      // First create the document
      const result = await db.insert(this.toJSON());
      this._id = result.id;
      this._rev = result.rev;
      documentCreated = true;

      // Then attach the image data
      const attachmentName = `image${this.getFileExtension()}`;
      await db.attachment.insert(this._id, attachmentName, imageBuffer, contentType, { rev: this._rev });

      // Get updated document with new revision
      const updated = await db.get(this._id);
      this._rev = updated._rev;

      return this;
    } catch (error) {
      console.error('Error saving image with attachment:', error);

      // Clean up document if it was created but attachment failed
      if (documentCreated && this._id && this._rev) {
        try {
          await db.destroy(this._id, this._rev);
          console.log(`Cleaned up orphan document ${this._id} after attachment failure`);
        } catch (cleanupError) {
          console.error(`Failed to clean up orphan document ${this._id}:`, cleanupError);
        }
      }

      throw error;
    }
  }

  async getAttachment() {
    const db = Image.getDb();
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
    const db = Image.getDb();
    try {
      // Fetch current document to preserve _attachments stubs
      const current = await db.get(this._id);

      Object.assign(this, updates);
      this.updated_at = new Date().toISOString();

      // Include _attachments stubs to preserve attachments
      const documentToSave = {
        ...this.toJSON(),
        _id: this._id,
        _rev: current._rev,
      };

      if (current._attachments) {
        documentToSave._attachments = current._attachments;
      }

      const result = await db.insert(documentToSave);
      this._rev = result.rev;
      return this;
    } catch (error) {
      console.error('Error updating Image:', error);
      throw error;
    }
  }

  async delete() {
    const db = Image.getDb();
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
      console.error('Error deleting image with attachments:', error);
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

  /**
   * Get image statistics
   * @returns {Promise<Object>} Statistics object
   */
  static async getStats() {
    const db = this.getDb();
    try {
      const result = await db.view('images', 'all');
      const allImages = result.rows.map(row => new Image(row.value));

      const activeImages = allImages.filter(img => img.status === 'active');
      const totalSize = activeImages.reduce((sum, img) => sum + (img.size || 0), 0);

      return {
        total: allImages.length,
        active: activeImages.length,
        inactive: allImages.filter(img => img.status !== 'active').length,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        avgSizeMB: activeImages.length > 0 ?
          Math.round(totalSize / activeImages.length / 1024 / 1024 * 100) / 100 : 0,
        byMimeType: activeImages.reduce((acc, img) => {
          acc[img.mimetype] = (acc[img.mimetype] || 0) + 1;
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('Error getting Image stats:', error);
      throw error;
    }
  }

  /**
   * Check if image is scheduled to display now
   * @returns {boolean} True if image should be displayed
   */
  isScheduledNow() {
    if (!this.schedule.start_time && !this.schedule.end_time) {
      return true; // No schedule means always show
    }

    const now = new Date();
    const start = this.schedule.start_time ? new Date(this.schedule.start_time) : null;
    const end = this.schedule.end_time ? new Date(this.schedule.end_time) : null;

    if (start && now < start) return false;
    if (end && now > end) return false;

    // Check day of week if specified
    if (this.schedule.days_of_week && this.schedule.days_of_week.length > 0) {
      const currentDay = now.getDay();
      return this.schedule.days_of_week.includes(currentDay);
    }

    return true;
  }

  /**
   * Get a summary of TV assignments
   * @returns {Object} Assignment summary
   */
  getAssignmentSummary() {
    return {
      assignedCount: this.assigned_tvs.length,
      tvIds: this.assigned_tvs,
      ordersByTv: this.tv_orders,
      isAssigned: this.assigned_tvs.length > 0
    };
  }

  /**
   * Bulk update order for multiple TVs
   * @param {Object} orderUpdates - Object mapping TV IDs to new orders
   * @returns {Promise<Object>} Updated image
   */
  async bulkUpdateOrders(orderUpdates) {
    const tv_orders = { ...this.tv_orders, ...orderUpdates };
    return this.update({ tv_orders });
  }

  /**
   * Check if image has valid attachment
   * @returns {Promise<boolean>} True if attachment exists
   */
  async hasAttachment() {
    try {
      const attachmentName = this.getAttachmentName();
      const db = Image.getDb();
      await db.attachment.get(this._id, attachmentName);
      return true;
    } catch (error) {
      return false;
    }
  }

  toJSON() {
    return {
      _id: this._id,
      type: this.type,
      original_name: this.original_name,
      size: this.size,
      mimetype: this.mimetype,
      assigned_tvs: this.assigned_tvs,
      tv_orders: this.tv_orders,
      status: this.status,
      metadata: this.metadata,
      schedule: this.schedule,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = Image;
