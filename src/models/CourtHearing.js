const BaseModel = require('./BaseModel');
const multilayerDb = require('../config/multilayer.database');

class CourtHearing extends BaseModel {
  constructor(data) {
    super(data, 'court_hearing');

    // Core hearing information
    this.hearing_id = data.hearing_id || `hearing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.case_number = data.case_number;
    this.court_room = data.court_room;
    this.scheduled_time = data.scheduled_time; // ISO 8601 format
    this.parties = data.parties || {};
    this.judge = data.judge || null;
    this.hearing_type = data.hearing_type || 'general'; // general, trial, motion, arraignment

    // Status tracking
    this.status = data.status || 'scheduled'; // scheduled, in_progress, delayed, completed, cancelled
    this.delay_minutes = data.delay_minutes || 0;
    this.delay_reason = data.delay_reason || null;

    // Display configuration
    this.display_config = {
      tv_locations: data.display_config?.tv_locations || ['all'], // 'all' or specific locations
      priority: data.display_config?.priority || 15,
      show_until: data.display_config?.show_until || null, // Auto-hide after this time
      color_scheme: data.display_config?.color_scheme || 'auto', // auto, urgent, normal
      ...data.display_config
    };

    // Metadata
    this.created_by = data.created_by || 'system';
    this.source = data.source || 'manual'; // manual, api, import
  }

  // Get the appropriate database for court hearings
  static getDb() {
    return multilayerDb.getDatabase('layers'); // Store in layers database
  }

  static async findAll() {
    const db = this.getDb();
    try {
      const result = await db.view('court_hearings', 'all');
      return result.rows.map(row => new CourtHearing(row.value));
    } catch (error) {
      if (error.statusCode === 404) {
        // View doesn't exist yet, return empty array
        return [];
      }
      throw error;
    }
  }

  static async findById(hearingId) {
    const allHearings = await this.findAll();
    return allHearings.find(h => h.hearing_id === hearingId) || null;
  }

  static async findByDate(date) {
    const allHearings = await this.findAll();
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    return allHearings.filter(hearing => {
      const hearingDate = new Date(hearing.scheduled_time);
      return hearingDate >= startOfDay && hearingDate <= endOfDay;
    }).sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
  }

  static async findByCourtRoom(courtRoom) {
    const allHearings = await this.findAll();
    return allHearings.filter(h => h.court_room === courtRoom)
      .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
  }

  static async findByStatus(status) {
    const allHearings = await this.findAll();
    return allHearings.filter(h => h.status === status);
  }

  static async findUpcoming(hours = 24) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + (hours * 60 * 60 * 1000));

    const allHearings = await this.findAll();
    return allHearings
      .filter(hearing => {
        const hearingTime = new Date(hearing.scheduled_time);
        return hearingTime >= now && hearingTime <= cutoff && hearing.status !== 'cancelled';
      })
      .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
  }

  static async findTodaysSchedule() {
    const today = new Date();
    return this.findByDate(today);
  }

  async save() {
    // Validate required fields
    this.validateRequired(['case_number', 'court_room', 'scheduled_time']);

    // Validate scheduled_time is a valid date
    const scheduledDate = new Date(this.scheduled_time);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error('Invalid scheduled_time format. Use ISO 8601 format.');
    }

    // Validate status
    const validStatuses = ['scheduled', 'in_progress', 'delayed', 'completed', 'cancelled'];
    if (!validStatuses.includes(this.status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const db = CourtHearing.getDb();
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
      throw new Error('Cannot delete hearing without _id and _rev');
    }
    const db = CourtHearing.getDb();
    return db.destroy(this._id, this._rev);
  }

  /**
   * Mark hearing as delayed
   * @param {number} minutes - Delay in minutes
   * @param {string} reason - Reason for delay
   * @returns {Promise<Object>} Updated hearing
   */
  async markDelayed(minutes, reason) {
    return this.update({
      status: 'delayed',
      delay_minutes: minutes,
      delay_reason: reason
    });
  }

  /**
   * Mark hearing as in progress
   * @returns {Promise<Object>} Updated hearing
   */
  async markInProgress() {
    return this.update({ status: 'in_progress' });
  }

  /**
   * Mark hearing as completed
   * @returns {Promise<Object>} Updated hearing
   */
  async markCompleted() {
    return this.update({ status: 'completed' });
  }

  /**
   * Cancel hearing
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Updated hearing
   */
  async cancel(reason) {
    return this.update({
      status: 'cancelled',
      delay_reason: reason
    });
  }

  /**
   * Check if hearing is starting soon (within minutes)
   * @param {number} minutes - Time threshold in minutes
   * @returns {boolean} True if hearing starts within threshold
   */
  isStartingSoon(minutes = 15) {
    const now = new Date();
    const hearingTime = new Date(this.scheduled_time);
    const diffMinutes = (hearingTime - now) / (1000 * 60);
    return diffMinutes > 0 && diffMinutes <= minutes && this.status === 'scheduled';
  }

  /**
   * Check if hearing is overdue (past scheduled time)
   * @returns {boolean} True if hearing is past scheduled time
   */
  isOverdue() {
    const now = new Date();
    const hearingTime = new Date(this.scheduled_time);
    return now > hearingTime && this.status === 'scheduled';
  }

  /**
   * Get display text for hearing
   * @returns {string} Formatted hearing text
   */
  getDisplayText() {
    const time = new Date(this.scheduled_time).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const parties = this.formatParties();
    const room = this.court_room;

    let text = `${time} - Room ${room} - ${parties}`;

    if (this.status === 'delayed' && this.delay_minutes > 0) {
      text += ` (Delayed ${this.delay_minutes} min)`;
    }

    return text;
  }

  /**
   * Format parties for display
   * @returns {string} Formatted party names
   */
  formatParties() {
    if (typeof this.parties === 'string') {
      return this.parties;
    }

    if (this.parties.plaintiff && this.parties.defendant) {
      return `${this.parties.plaintiff} vs. ${this.parties.defendant}`;
    }

    if (this.parties.petitioner && this.parties.respondent) {
      return `${this.parties.petitioner} vs. ${this.parties.respondent}`;
    }

    if (this.parties.state && this.parties.defendant) {
      return `State vs. ${this.parties.defendant}`;
    }

    return this.case_number || 'Unknown';
  }

  /**
   * Get color scheme based on status and timing
   * @returns {Object} RGB color values
   */
  getColorScheme() {
    // Manual override
    if (this.display_config.color_scheme !== 'auto') {
      return this.getColorByScheme(this.display_config.color_scheme);
    }

    // Auto-determine based on status and timing
    if (this.status === 'cancelled') {
      return { bg: [128, 128, 128, 200], text: [255, 255, 255, 255] }; // Gray
    }

    if (this.status === 'in_progress') {
      return { bg: [34, 197, 94, 200], text: [255, 255, 255, 255] }; // Green
    }

    if (this.status === 'delayed') {
      return { bg: [217, 119, 6, 200], text: [255, 255, 255, 255] }; // Orange
    }

    if (this.isStartingSoon(15)) {
      return { bg: [239, 68, 68, 200], text: [255, 255, 255, 255] }; // Red - starting soon
    }

    if (this.isStartingSoon(30)) {
      return { bg: [217, 119, 6, 200], text: [255, 255, 255, 255] }; // Orange - starting within 30 min
    }

    // Default: normal scheduled
    return { bg: [30, 58, 138, 200], text: [255, 255, 255, 255] }; // Dark blue
  }

  getColorByScheme(scheme) {
    const schemes = {
      urgent: { bg: [239, 68, 68, 200], text: [255, 255, 255, 255] },
      warning: { bg: [217, 119, 6, 200], text: [255, 255, 255, 255] },
      normal: { bg: [30, 58, 138, 200], text: [255, 255, 255, 255] },
      success: { bg: [34, 197, 94, 200], text: [255, 255, 255, 255] },
      gray: { bg: [128, 128, 128, 200], text: [255, 255, 255, 255] }
    };

    return schemes[scheme] || schemes.normal;
  }

  /**
   * Convert hearing to Layer data for display
   * @param {string} tvId - Target TV ID
   * @param {number} yPosition - Vertical position
   * @param {number} height - Layer height
   * @returns {Object} Layer data object
   */
  toLayer(tvId, yPosition, height = 50) {
    const colors = this.getColorScheme();
    const text = this.getDisplayText();

    return {
      tv_id: tvId,
      layer_type: 'DataRow',
      name: `Court Hearing: ${this.case_number}`,
      group: `court_schedule_${new Date(this.scheduled_time).toISOString().split('T')[0]}`,
      content: {
        text,
        backgroundColor: `rgba(${colors.bg.join(',')})`,
        textColor: `rgba(${colors.text.join(',')})`,
        fontSize: 24,
        alignment: 'left'
      },
      position: {
        x: 0,
        y: yPosition,
        width: 1920,
        height
      },
      priority: this.display_config.priority,
      visible: true,
      opacity: 1.0,
      metadata: {
        hearing_id: this.hearing_id,
        case_number: this.case_number,
        court_room: this.court_room,
        scheduled_time: this.scheduled_time,
        status: this.status
      }
    };
  }

  /**
   * Get statistics for hearings
   * @returns {Promise<Object>} Statistics object
   */
  static async getStats() {
    const allHearings = await this.findAll();
    const today = await this.findTodaysSchedule();
    const upcoming = await this.findUpcoming(24);

    return {
      total: allHearings.length,
      today: today.length,
      upcoming_24h: upcoming.length,
      by_status: {
        scheduled: allHearings.filter(h => h.status === 'scheduled').length,
        in_progress: allHearings.filter(h => h.status === 'in_progress').length,
        delayed: allHearings.filter(h => h.status === 'delayed').length,
        completed: allHearings.filter(h => h.status === 'completed').length,
        cancelled: allHearings.filter(h => h.status === 'cancelled').length
      },
      by_room: allHearings.reduce((acc, hearing) => {
        acc[hearing.court_room] = (acc[hearing.court_room] || 0) + 1;
        return acc;
      }, {})
    };
  }

  /**
   * Import hearings from CSV data
   * @param {Array} csvData - Array of hearing objects from CSV
   * @param {string} source - Source identifier
   * @returns {Promise<Array>} Created hearings
   */
  static async importFromCSV(csvData, source = 'csv_import') {
    const hearings = [];

    for (const row of csvData) {
      try {
        const hearing = new CourtHearing({
          case_number: row.case_number || row.caseNumber,
          court_room: row.court_room || row.courtRoom || row.room,
          scheduled_time: row.scheduled_time || row.scheduledTime || row.time,
          parties: {
            plaintiff: row.plaintiff,
            defendant: row.defendant,
            petitioner: row.petitioner,
            respondent: row.respondent,
            state: row.state
          },
          judge: row.judge,
          hearing_type: row.hearing_type || row.hearingType || row.type || 'general',
          source
        });

        await hearing.save();
        hearings.push(hearing);
      } catch (error) {
        console.error(`Failed to import hearing ${row.case_number}:`, error.message);
      }
    }

    return hearings;
  }
}

module.exports = CourtHearing;
