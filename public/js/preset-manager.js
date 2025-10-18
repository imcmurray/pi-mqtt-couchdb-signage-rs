/**
 * Preset Manager
 * Manages zone preset templates for digital signage displays
 */

class PresetManager {
  constructor() {
    this.presets = [];
    this.tvs = [];
    this.selectedPreset = null;
    this.currentCategory = 'all';
    this.apiBase = '/api/presets';
  }

  /**
   * Initialize preset manager
   */
  async init() {
    console.log('Initializing Preset Manager...');

    await this.loadTVs();
    await this.loadPresets();
    this.renderPresets();
  }

  /**
   * Load all TVs for selection
   */
  async loadTVs() {
    try {
      const response = await fetch('/api/tvs');
      const result = await response.json();

      if (result.success) {
        this.tvs = result.data.filter(tv => tv.features && tv.features.multi_layer);

        // Populate TV selectors
        const selectors = [document.getElementById('tvSelector'), document.getElementById('saveTvSelector')];
        selectors.forEach(selector => {
          if (selector) {
            this.tvs.forEach(tv => {
              const option = document.createElement('option');
              option.value = tv._id;
              option.textContent = `${tv.tv_id} - ${tv.location || 'Unknown Location'}`;
              selector.appendChild(option);
            });
          }
        });
      }
    } catch (error) {
      console.error('Error loading TVs:', error);
      this.showError('Failed to load TVs: ' + error.message);
    }
  }

  /**
   * Load all presets
   */
  async loadPresets() {
    try {
      const response = await fetch(this.apiBase);
      const result = await response.json();

      if (result.success) {
        this.presets = result.data;
        console.log(`Loaded ${this.presets.length} presets (${result.builtin_count} built-in, ${result.custom_count} custom)`);
      } else {
        this.showError('Failed to load presets: ' + result.error);
      }
    } catch (error) {
      console.error('Error loading presets:', error);
      this.showError('Network error loading presets: ' + error.message);
    }
  }

  /**
   * Filter presets by category
   */
  filterByCategory(category) {
    this.currentCategory = category;

    // Update tab active state
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    event.target.classList.add('active');

    this.renderPresets();
  }

  /**
   * Render preset cards
   */
  renderPresets() {
    const grid = document.getElementById('presetGrid');

    let filteredPresets = this.presets;

    if (this.currentCategory !== 'all') {
      filteredPresets = this.presets.filter(p => p.category === this.currentCategory);
    }

    if (filteredPresets.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <h3>No presets found</h3>
          <p>Try selecting a different category</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filteredPresets.map(preset => this.renderPresetCard(preset)).join('');
  }

  /**
   * Render individual preset card
   */
  renderPresetCard(preset) {
    const isSelected = this.selectedPreset && this.selectedPreset.preset_id === preset.preset_id;

    return `
      <div class="preset-card ${isSelected ? 'selected' : ''}" onclick="presetManager.selectPreset('${preset.preset_id}')">
        <div class="preset-preview">${this.escapeHtml(preset.preview.layout_diagram)}</div>
        <div class="preset-info">
          <h3>
            ${this.escapeHtml(preset.name)}
            <span class="preset-badge ${preset.is_builtin ? 'badge-builtin' : 'badge-custom'}">
              ${preset.is_builtin ? 'Built-in' : 'Custom'}
            </span>
          </h3>
          <p>${this.escapeHtml(preset.description)}</p>
          <div class="preset-stats">
            <span>📐 ${preset.layers.length} layer${preset.layers.length !== 1 ? 's' : ''}</span>
            <span>📊 ${preset.usage_count || 0} uses</span>
            <span class="preset-badge badge-category">${preset.category}</span>
          </div>
        </div>
        <div class="preset-actions">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); presetManager.quickApply('${preset.preset_id}')">
            Apply
          </button>
          <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); presetManager.clonePreset('${preset.preset_id}')">
            Clone
          </button>
          ${!preset.is_builtin ? `
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); presetManager.deletePreset('${preset.preset_id}')">
              Delete
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Select a preset
   */
  selectPreset(presetId) {
    this.selectedPreset = this.presets.find(p => p.preset_id === presetId);

    if (this.selectedPreset) {
      // Update apply panel
      document.getElementById('selectedPresetName').textContent = this.selectedPreset.name;
      document.getElementById('selectedPresetDescription').textContent = this.selectedPreset.description;
      document.getElementById('applyPanel').classList.add('active');

      // Update card selection
      this.renderPresets();
    }
  }

  /**
   * Deselect preset
   */
  deselectPreset() {
    this.selectedPreset = null;
    document.getElementById('applyPanel').classList.remove('active');
    this.renderPresets();
  }

  /**
   * Apply selected preset to TV
   */
  async applyPreset() {
    if (!this.selectedPreset) {
      this.showError('No preset selected');
      return;
    }

    const tvId = document.getElementById('tvSelector').value;
    if (!tvId) {
      this.showError('Please select a TV');
      return;
    }

    const overrideExisting = document.getElementById('overrideExisting').checked;

    try {
      const response = await fetch(`${this.apiBase}/apply/${tvId}/${this.selectedPreset.preset_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override_existing: overrideExisting })
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess(`Preset "${this.selectedPreset.name}" applied successfully! ${result.data.layers_created} layers created.`);
        this.deselectPreset();
        await this.loadPresets(); // Refresh to update usage counts
        this.renderPresets();
      } else {
        this.showError('Failed to apply preset: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Quick apply preset (prompts for TV)
   */
  async quickApply(presetId) {
    this.selectPreset(presetId);

    // Auto-select first TV if only one available
    if (this.tvs.length === 1) {
      document.getElementById('tvSelector').value = this.tvs[0]._id;
    }
  }

  /**
   * Clone a preset
   */
  async clonePreset(presetId) {
    const newName = prompt('Enter name for cloned preset:');
    if (!newName) return;

    try {
      const response = await fetch(`${this.apiBase}/${presetId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess(`Preset cloned as "${newName}"`);
        await this.loadPresets();
        this.renderPresets();
      } else {
        this.showError('Failed to clone preset: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Delete a custom preset
   */
  async deletePreset(presetId) {
    const preset = this.presets.find(p => p.preset_id === presetId);
    if (!preset) return;

    if (!confirm(`Are you sure you want to delete "${preset.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/${presetId}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess('Preset deleted successfully');
        await this.loadPresets();
        this.renderPresets();
      } else {
        this.showError('Failed to delete preset: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Show save layout modal
   */
  showSaveLayoutModal() {
    document.getElementById('saveLayoutModal').classList.add('active');
  }

  /**
   * Close save layout modal
   */
  closeSaveLayoutModal() {
    document.getElementById('saveLayoutModal').classList.remove('active');
    document.getElementById('saveLayoutForm').reset();
  }

  /**
   * Save current TV layout as preset
   */
  async saveCurrentLayout() {
    const tvId = document.getElementById('saveTvSelector').value;
    const name = document.getElementById('presetName').value;
    const description = document.getElementById('presetDescription').value;
    const category = document.getElementById('presetCategory').value;

    if (!tvId || !name) {
      this.showError('Please fill in all required fields');
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/save-layout/${tvId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, category })
      });

      const result = await response.json();

      if (result.success) {
        this.showSuccess(`Layout saved as preset "${name}"`);
        this.closeSaveLayoutModal();
        await this.loadPresets();
        this.renderPresets();
      } else {
        this.showError('Failed to save layout: ' + result.error);
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    const container = document.getElementById('messageContainer');
    container.innerHTML = `<div class="message message-success">${message}</div>`;

    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  }

  /**
   * Show error message
   */
  showError(message) {
    const container = document.getElementById('messageContainer');
    container.innerHTML = `<div class="message message-error">${message}</div>`;

    setTimeout(() => {
      container.innerHTML = '';
    }, 8000);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Create global instance
const presetManager = new PresetManager();
