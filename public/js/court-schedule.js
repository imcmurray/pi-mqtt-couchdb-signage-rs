/**
 * Court Schedule Management System
 * Handles CRUD operations, CSV import, display preview, and real-time updates
 */

class CourtScheduleManager {
  constructor() {
    this.hearings = [];
    this.currentFilter = 'today';
    this.roomFilter = '';
    this.ws = null;
    this.apiBase = '/api/hearings';
  }

  /**
   * Initialize the court schedule manager
   */
  async init() {
    console.log('Initializing Court Schedule Manager...');

    this.connectWebSocket();
    await this.loadHearings();
    await this.loadStats();
    this.startAutoRefresh();
  }

  /**
   * Connect to WebSocket for real-time updates
   */
  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'mqtt_message') {
          if (data.topic.includes('/layer/')) {
            console.log('Layer update received:', data.topic);
            this.updatePreview();
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 5s...');
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  /**
   * Load all hearings from API
   */
  async loadHearings() {
    try {
      const endpoint = this.getFilterEndpoint();
      const response = await fetch(endpoint);
      const result = await response.json();

      if (result.success) {
        this.hearings = result.data;
        this.renderHearingsTable();
        this.updatePreview();
      } else {
        this.showError('Failed to load hearings: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error loading hearings: ' + error.message);
    }
  }

  /**
   * Load statistics from API
   */
  async loadStats() {
    try {
      const response = await fetch(`${this.apiBase}/stats`);
      const result = await response.json();

      if (result.success) {
        const stats = result.data;
        document.getElementById('statToday').textContent = stats.todays_count || 0;
        document.getElementById('statUpcoming').textContent = stats.upcoming_count || 0;
        document.getElementById('statInProgress').textContent = stats.in_progress_count || 0;
        document.getElementById('statCompleted').textContent = stats.completed_count || 0;
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  /**
   * Get the appropriate API endpoint based on current filter
   */
  getFilterEndpoint() {
    switch (this.currentFilter) {
      case 'today':
        return `${this.apiBase}/today`;
      case 'upcoming':
        return `${this.apiBase}/upcoming`;
      default:
        return this.apiBase;
    }
  }

  /**
   * Add a new hearing
   */
  async addHearing() {
    const form = document.getElementById('hearingForm');
    const formData = {
      case_number: document.getElementById('caseNumber').value,
      court_room: document.getElementById('courtRoom').value,
      scheduled_time: new Date(document.getElementById('scheduledTime').value).toISOString(),
      hearing_type: document.getElementById('hearingType').value,
      parties: {
        plaintiff: document.getElementById('plaintiff').value,
        defendant: document.getElementById('defendant').value
      },
      judge: document.getElementById('judge').value || null,
      notes: document.getElementById('notes').value || null
    };

    try {
      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Hearing added successfully!');
        form.reset();

        // Reset time to now
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('scheduledTime').value = now.toISOString().slice(0, 16);

        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to add hearing: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Update an existing hearing
   */
  async updateHearing(hearingId, updates) {
    try {
      const response = await fetch(`${this.apiBase}/${hearingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Hearing updated successfully!');
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to update hearing: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Delete a hearing
   */
  async deleteHearing(hearingId) {
    if (!confirm('Are you sure you want to delete this hearing?')) {
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/${hearingId}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Hearing deleted successfully!');
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to delete hearing: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Mark hearing as delayed
   */
  async markDelayed(hearingId) {
    const minutes = prompt('Delay by how many minutes?', '15');
    if (!minutes) return;

    const reason = prompt('Reason for delay (optional):', '');

    try {
      const response = await fetch(`${this.apiBase}/${hearingId}/delay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes: parseInt(minutes),
          reason: reason || null
        })
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess(result.message || 'Hearing marked as delayed');
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to mark as delayed: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Mark hearing as in progress
   */
  async markInProgress(hearingId) {
    try {
      const response = await fetch(`${this.apiBase}/${hearingId}/in-progress`, {
        method: 'POST'
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Hearing marked as in progress');
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to mark as in progress: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Mark hearing as completed
   */
  async markCompleted(hearingId) {
    try {
      const response = await fetch(`${this.apiBase}/${hearingId}/complete`, {
        method: 'POST'
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Hearing marked as completed');
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to mark as completed: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Cancel a hearing
   */
  async cancelHearing(hearingId) {
    const reason = prompt('Reason for cancellation (optional):', '');

    try {
      const response = await fetch(`${this.apiBase}/${hearingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason || null
        })
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Hearing cancelled');
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Failed to cancel hearing: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Refresh display on all TVs
   */
  async refreshDisplay() {
    try {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '🔄 Refreshing...';

      const response = await fetch(`${this.apiBase}/refresh-display`, {
        method: 'POST'
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess(
          `Display refreshed! ${result.data.tvs_updated} TVs updated, ` +
          `${result.data.layers_created} layers created, ` +
          `${result.data.layers_removed} layers removed`
        );
      } else {
        this.showError('Failed to refresh display: ' + result.error);
      }

      btn.disabled = false;
      btn.textContent = '🔄 Refresh All Displays';
    } catch (error) {
      this.showError('Network error: ' + error.message);
      event.target.disabled = false;
      event.target.textContent = '🔄 Refresh All Displays';
    }
  }

  /**
   * Handle CSV file upload
   */
  async handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const csvData = this.parseCSV(text);

      if (csvData.length === 0) {
        this.showError('CSV file is empty or invalid');
        return;
      }

      const response = await fetch(`${this.apiBase}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData })
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess(
          `Imported ${result.data.imported} hearings successfully! ` +
          `${result.data.failed} failed.`
        );
        await this.loadHearings();
        await this.loadStats();
      } else {
        this.showError('Import failed: ' + result.error);
      }

      event.target.value = '';
    } catch (error) {
      this.showError('Failed to process CSV: ' + error.message);
      event.target.value = '';
    }
  }

  /**
   * Parse CSV file content
   */
  parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      if (row.case_number && row.court_room && row.scheduled_time) {
        data.push(row);
      }
    }

    return data;
  }

  /**
   * Apply filters to hearings table
   */
  filterHearings(filter) {
    this.currentFilter = filter;

    document.querySelectorAll('.filter-bar .btn').forEach(btn => {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    });

    event.target.classList.remove('btn-secondary');
    event.target.classList.add('btn-primary');

    this.loadHearings();
  }

  /**
   * Apply room filter
   */
  applyFilters() {
    this.roomFilter = document.getElementById('roomFilter').value.toLowerCase();
    this.renderHearingsTable();
  }

  /**
   * Render hearings table
   */
  renderHearingsTable() {
    const tbody = document.getElementById('hearingsTableBody');

    let filteredHearings = this.hearings;

    if (this.roomFilter) {
      filteredHearings = filteredHearings.filter(h =>
        h.court_room.toLowerCase().includes(this.roomFilter)
      );
    }

    if (filteredHearings.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-state-icon">⚖️</div>
              <h3>No hearings found</h3>
              <p>Try adjusting your filters or add a new hearing</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filteredHearings.map(hearing => {
      const time = new Date(hearing.scheduled_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const date = new Date(hearing.scheduled_time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });

      const parties = hearing.parties ?
        `${hearing.parties.plaintiff || 'Unknown'} v. ${hearing.parties.defendant || 'Unknown'}` :
        'Unknown parties';

      return `
        <tr>
          <td><strong>${time}</strong><br><small style="color: #6b7280;">${date}</small></td>
          <td><strong>${hearing.case_number}</strong></td>
          <td><strong>${hearing.court_room}</strong></td>
          <td>${parties}</td>
          <td>${hearing.judge || '-'}</td>
          <td>${hearing.hearing_type || 'hearing'}</td>
          <td><span class="status-badge status-${hearing.status}">${hearing.status.replace('_', ' ')}</span></td>
          <td>
            <div class="action-buttons">
              ${hearing.status === 'scheduled' ? `
                <button class="btn btn-warning btn-sm" onclick="courtSchedule.markDelayed('${hearing._id}')">⏰ Delay</button>
                <button class="btn btn-success btn-sm" onclick="courtSchedule.markInProgress('${hearing._id}')">▶️ Start</button>
              ` : ''}
              ${hearing.status === 'in_progress' ? `
                <button class="btn btn-success btn-sm" onclick="courtSchedule.markCompleted('${hearing._id}')">✓ Complete</button>
              ` : ''}
              ${hearing.status !== 'completed' && hearing.status !== 'cancelled' ? `
                <button class="btn btn-danger btn-sm" onclick="courtSchedule.cancelHearing('${hearing._id}')">✕ Cancel</button>
              ` : ''}
              <button class="btn btn-danger btn-sm" onclick="courtSchedule.deleteHearing('${hearing._id}')">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Update display preview
   */
  updatePreview() {
    const previewContent = document.getElementById('previewContent');

    const activeHearings = this.hearings.filter(h =>
      h.status !== 'completed' && h.status !== 'cancelled'
    ).slice(0, 20);

    if (activeHearings.length === 0) {
      previewContent.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px;">
          <div class="empty-state-icon">📅</div>
          <h3>No active hearings</h3>
          <p>Add hearings to see preview</p>
        </div>
      `;
      return;
    }

    previewContent.innerHTML = activeHearings.map(hearing => {
      const time = new Date(hearing.scheduled_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const parties = hearing.parties ?
        `${hearing.parties.plaintiff || 'Unknown'} v. ${hearing.parties.defendant || 'Unknown'}` :
        'Unknown parties';

      const text = `${time} - Room ${hearing.court_room} - ${parties}`;

      const delayText = hearing.status === 'delayed' && hearing.delay_minutes > 0 ?
        ` (Delayed ${hearing.delay_minutes} min)` : '';

      let className = 'normal';
      if (hearing.status === 'cancelled') className = 'cancelled';
      else if (hearing.status === 'in_progress') className = 'in-progress';
      else if (hearing.status === 'delayed') className = 'warning';
      else {
        const minutesUntil = (new Date(hearing.scheduled_time) - new Date()) / 60000;
        if (minutesUntil < 15) className = 'urgent';
        else if (minutesUntil < 30) className = 'warning';
      }

      return `<div class="layer-preview-row ${className}">${text}${delayText}</div>`;
    }).join('');
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    setInterval(() => {
      this.loadStats();
      if (this.currentFilter === 'today' || this.currentFilter === 'upcoming') {
        this.loadHearings();
      }
    }, 60000); // Refresh every minute
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    const container = document.getElementById('messageContainer');
    container.innerHTML = `<div class="success-message">${message}</div>`;

    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  }

  /**
   * Show error message
   */
  showError(message) {
    const container = document.getElementById('messageContainer');
    container.innerHTML = `<div class="error-message">${message}</div>`;

    setTimeout(() => {
      container.innerHTML = '';
    }, 8000);
  }
}

// Create global instance
const courtSchedule = new CourtScheduleManager();
