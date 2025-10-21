const BaseModel = require('./BaseModel');
const multilayerDb = require('../config/multilayer.database');

class Alert extends BaseModel {
  constructor(data) {
    super(data, 'alert');

    // Alert identification
    this.alert_id = data.alert_id || this.generateAlertId();
    this.title = data.title || '';
    this.message = data.message || '';

    // Alert type determines priority and visual treatment
    this.type = data.type || 'INFO'; // CRITICAL, URGENT, INFO

    // Priority and auto-dismiss based on type
    const typeDefaults = this.getTypeDefaults(this.type);
    this.priority = data.priority !== undefined ? data.priority : typeDefaults.priority;
    this.auto_dismiss_ms = data.auto_dismiss_ms !== undefined ? data.auto_dismiss_ms : typeDefaults.auto_dismiss_ms;
    this.background_color = data.background_color || typeDefaults.background_color;
    this.text_color = data.text_color || 'rgba(255, 255, 255, 1)';
    this.icon = data.icon || typeDefaults.icon;

    // Broadcast targeting
    this.target_type = data.target_type || 'all'; // all, specific, location
    this.target_ids = data.target_ids || []; // For specific TVs
    this.target_location = data.target_location || null; // For location-based

    // Status tracking
    this.status = data.status || 'active'; // active, dismissed, expired, queued
    this.created_by = data.created_by || 'system';
    this.dismissed_at = data.dismissed_at || null;
    this.delivered_to = data.delivered_to || []; // List of TV IDs that received this alert

    // Queue tracking
    this.queued_at = data.queued_at || null;
    this.queue_position = data.queue_position !== undefined ? data.queue_position : null;
    this.interrupted_by = data.interrupted_by || null; // Alert ID that interrupted this one

    // Scheduling
    this.scheduled_for = data.scheduled_for || null; // ISO timestamp for future broadcast
    this.is_scheduled = data.is_scheduled || false;
    this.recurrence_pattern = data.recurrence_pattern || null; // daily, weekly, monthly, hourly
    this.recurrence_end = data.recurrence_end || null; // When to stop recurring
  }

  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getTypeDefaults(type) {
    const defaults = {
      CRITICAL: {
        priority: 250,
        auto_dismiss_ms: 600000, // 10 minutes
        background_color: 'rgba(220, 38, 38, 0.95)', // Red
        icon: '🚨'
      },
      URGENT: {
        priority: 200,
        auto_dismiss_ms: 300000, // 5 minutes
        background_color: 'rgba(217, 119, 6, 0.9)', // Orange
        icon: '⚠️'
      },
      INFO: {
        priority: 150,
        auto_dismiss_ms: 120000, // 2 minutes
        background_color: 'rgba(37, 99, 235, 0.85)', // Blue
        icon: 'ℹ️'
      }
    };

    return defaults[type] || defaults.INFO;
  }

  validate() {
    if (!this.title || this.title.trim() === '') {
      throw new Error('Title is required');
    }

    if (!this.message || this.message.trim() === '') {
      throw new Error('Message is required');
    }

    if (this.title.length > 100) {
      throw new Error('Title must be 100 characters or less');
    }

    if (this.message.length > 500) {
      throw new Error('Message must be 500 characters or less');
    }

    const validTypes = ['CRITICAL', 'URGENT', 'INFO'];
    if (!validTypes.includes(this.type)) {
      throw new Error('Invalid alert type. Must be CRITICAL, URGENT, or INFO');
    }

    return true;
  }

  toLayer(tvId) {
    const layerDefaults = this.getLayerDefaults(this.type);

    const layerText = this.formatAlertText();

    return {
      tv_id: tvId,
      layer_type: 'Emergency',
      layer_id: `${this.alert_id}_${tvId}`,
      name: `Emergency Alert: ${this.title}`,
      priority: this.priority,
      visible: true,
      opacity: 1.0,
      position: layerDefaults.position,
      content: {
        text: layerText,
        backgroundColor: this.background_color,
        textColor: this.text_color,
        fontSize: layerDefaults.fontSize,
        fontFamily: 'Arial',
        padding: layerDefaults.padding,
        alignment: 'center'
      },
      schedule: {
        enabled: true,
        show_at: null,
        hide_at: null,
        auto_hide_after_ms: this.auto_dismiss_ms
      },
      tags: ['alert', this.type.toLowerCase(), this.alert_id],
      group: `alert_${this.alert_id}`
    };
  }

  getLayerDefaults(type) {
    const defaults = {
      CRITICAL: {
        // Full-screen takeover
        position: { x: 0, y: 0, width: 1920, height: 1080 },
        fontSize: 48,
        padding: 40
      },
      URGENT: {
        // Top banner
        position: { x: 0, y: 0, width: 1920, height: 120 },
        fontSize: 32,
        padding: 20
      },
      INFO: {
        // Bottom ticker
        position: { x: 0, y: 980, width: 1920, height: 100 },
        fontSize: 24,
        padding: 16
      }
    };

    return defaults[type] || defaults.INFO;
  }

  formatAlertText() {
    const typeName = this.type === 'CRITICAL' ? 'CRITICAL ALERT' : this.type;
    return `${this.icon} ${typeName}\n\n${this.title}\n\n${this.message}`;
  }

  isActive() {
    return this.status === 'active';
  }

  async markDelivered(tvId) {
    if (!this.delivered_to.includes(tvId)) {
      this.delivered_to.push(tvId);
      this.updated_at = new Date().toISOString();
      await this.save();
    }
  }

  async dismiss(reason = 'manual') {
    this.status = 'dismissed';
    this.dismissed_at = new Date().toISOString();
    this.dismiss_reason = reason;
    this.updated_at = new Date().toISOString();
    await this.save();
  }

  async expire() {
    this.status = 'expired';
    this.updated_at = new Date().toISOString();
    await this.save();
  }

  static getDb() {
    return multilayerDb.getDatabase('alerts');
  }

  static async findAll() {
    const db = this.getDb();
    const result = await db.view('alerts', 'all', { include_docs: true });
    return result.rows.map(row => new Alert(row.doc));
  }

  static async findActive() {
    const db = this.getDb();
    const result = await db.view('alerts', 'by_status', {
      key: 'active',
      include_docs: true
    });
    return result.rows.map(row => new Alert(row.doc));
  }

  static async findByType(type) {
    const db = this.getDb();
    const result = await db.view('alerts', 'by_type', {
      key: type,
      include_docs: true
    });
    return result.rows.map(row => new Alert(row.doc));
  }

  static async findRecent(limit = 50) {
    const db = this.getDb();
    const result = await db.view('alerts', 'by_created_at', {
      descending: true,
      limit,
      include_docs: true
    });
    return result.rows.map(row => new Alert(row.doc));
  }

  async save() {
    this.validate();

    const db = Alert.getDb();
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
}

module.exports = Alert;
