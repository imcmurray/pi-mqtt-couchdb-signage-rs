const CourtHearing = require('../models/CourtHearing');
const Layer = require('../models/Layer');
const TV = require('../models/tv.multilayer');
const mqtt = require('./multilayer.mqttService');

class CourtDisplayService {
  /**
   * Refresh court schedule display on all TVs
   * @param {string} tvId - Optional: refresh specific TV only
   * @returns {Promise<Object>} Refresh results
   */
  async refreshScheduleDisplay(tvId = null) {
    console.log(`Refreshing court schedule display${tvId ? ` for TV ${tvId}` : ' for all TVs'}...`);

    // Get target TVs
    const tvs = tvId ? [await TV.findById(tvId)] : await TV.findAll();
    const targetTVs = tvs.filter(tv => tv && tv.hasLayerSupport());

    if (targetTVs.length === 0) {
      console.log('No TVs with layer support found');
      return { tvs_updated: 0, layers_created: 0, layers_removed: 0 };
    }

    // Get today's hearings
    const hearings = await CourtHearing.findTodaysSchedule();
    const activeHearings = hearings.filter(h =>
      h.status !== 'completed' && h.status !== 'cancelled'
    );

    console.log(`Found ${activeHearings.length} active hearings for today`);

    let totalLayersCreated = 0;
    let totalLayersRemoved = 0;

    for (const tv of targetTVs) {
      try {
        const result = await this.updateTVSchedule(tv, activeHearings);
        totalLayersCreated += result.layers_created;
        totalLayersRemoved += result.layers_removed;
      } catch (error) {
        console.error(`Failed to update TV ${tv.tv_id}:`, error.message);
      }
    }

    return {
      tvs_updated: targetTVs.length,
      hearings_displayed: activeHearings.length,
      layers_created: totalLayersCreated,
      layers_removed: totalLayersRemoved
    };
  }

  /**
   * Update court schedule display for a specific TV
   * @param {Object} tv - TV object
   * @param {Array} hearings - Array of CourtHearing objects
   * @returns {Promise<Object>} Update results
   */
  async updateTVSchedule(tv, hearings) {
    const tvId = tv.tv_id || tv._id;

    // Filter hearings for this TV's location
    const tvLocation = tv.location;
    const relevantHearings = hearings.filter(hearing => {
      const locations = hearing.display_config.tv_locations;
      return locations.includes('all') || locations.includes(tvLocation);
    });

    // Remove existing court schedule layers for this TV
    const existingLayers = await Layer.findByTvAndGroup(tvId, `court_schedule_${new Date().toISOString().split('T')[0]}`);
    let layersRemoved = 0;

    for (const layer of existingLayers) {
      try {
        await layer.delete();
        layersRemoved++;
      } catch (error) {
        console.error(`Failed to delete layer ${layer.layer_id}:`, error.message);
      }
    }

    // Create new layers for current hearings
    const layersCreated = await this.generateScheduleLayers(tvId, relevantHearings);

    console.log(`TV ${tvId}: Removed ${layersRemoved} old layers, created ${layersCreated.length} new layers`);

    return {
      tv_id: tvId,
      layers_created: layersCreated.length,
      layers_removed: layersRemoved,
      hearings_displayed: relevantHearings.length
    };
  }

  /**
   * Generate schedule layers for hearings
   * @param {string} tvId - Target TV ID
   * @param {Array} hearings - Array of CourtHearing objects
   * @returns {Promise<Array>} Created Layer objects
   */
  async generateScheduleLayers(tvId, hearings) {
    const layers = [];

    // Configuration
    const startY = 100; // Start position below any header
    const rowHeight = 50; // Height of each hearing row
    const maxRows = 20; // Maximum hearings to display

    // Limit to max displayable hearings
    const displayHearings = hearings.slice(0, maxRows);

    // Sort hearings by time (earliest first)
    displayHearings.sort((a, b) =>
      new Date(a.scheduled_time) - new Date(b.scheduled_time)
    );

    // Generate layer for each hearing
    for (let i = 0; i < displayHearings.length; i++) {
      const hearing = displayHearings[i];
      const yPosition = startY + (i * rowHeight);

      try {
        // Convert hearing to layer data
        const layerData = hearing.toLayer(tvId, yPosition, rowHeight);

        // Create and save layer
        const layer = new Layer(layerData);
        await layer.save();

        // Publish layer via MQTT for real-time update
        await this.publishLayerUpdate(tvId, layer);

        layers.push(layer);
      } catch (error) {
        console.error(`Failed to create layer for hearing ${hearing.case_number}:`, error.message);
      }
    }

    return layers;
  }

  /**
   * Publish layer update via MQTT
   * @param {string} tvId - Target TV ID
   * @param {Object} layer - Layer object
   */
  async publishLayerUpdate(tvId, layer) {
    const topic = `signage_dev/tv/${tvId}/layer/add`;
    const message = {
      type: 'layer_add',
      layer: {
        layer_id: layer.layer_id,
        layer_type: layer.layer_type,
        priority: layer.priority,
        position: layer.position,
        content: layer.content,
        visible: layer.visible,
        opacity: layer.opacity
      },
      timestamp: new Date().toISOString()
    };

    mqtt.publish(topic, message);
  }

  /**
   * Generate header layer for court schedule
   * @param {string} tvId - Target TV ID
   * @param {string} title - Header title
   * @returns {Promise<Object>} Created header layer
   */
  async generateHeaderLayer(tvId, title = "TODAY'S COURT SCHEDULE") {
    const headerData = {
      tv_id: tvId,
      layer_type: 'DataRow',
      name: 'Court Schedule Header',
      group: `court_schedule_${new Date().toISOString().split('T')[0]}`,
      content: {
        text: title,
        backgroundColor: 'rgba(30, 58, 138, 230)', // Dark blue
        textColor: 'rgba(255, 255, 255, 255)',
        fontSize: 32,
        alignment: 'center'
      },
      position: {
        x: 0,
        y: 30,
        width: 1920,
        height: 60
      },
      priority: 16, // Higher than hearings (15)
      visible: true,
      opacity: 1.0
    };

    const layer = new Layer(headerData);
    await layer.save();
    await this.publishLayerUpdate(tvId, layer);

    return layer;
  }

  /**
   * Clean up old court schedule layers
   * @param {number} hoursOld - Remove layers older than this many hours
   * @returns {Promise<number>} Number of layers removed
   */
  async cleanupOldSchedules(hoursOld = 24) {
    const cutoff = new Date(Date.now() - (hoursOld * 60 * 60 * 1000));
    const cutoffDateStr = cutoff.toISOString().split('T')[0];

    // Find all court schedule groups older than cutoff
    const allLayers = await Layer.findAll();
    const oldScheduleLayers = allLayers.filter(layer => {
      if (!layer.group || !layer.group.startsWith('court_schedule_')) {
        return false;
      }

      // Extract date from group name: court_schedule_YYYY-MM-DD
      const dateStr = layer.group.replace('court_schedule_', '');
      return dateStr < cutoffDateStr;
    });

    // Delete old layers
    let removed = 0;
    for (const layer of oldScheduleLayers) {
      try {
        await layer.delete();
        removed++;
      } catch (error) {
        console.error(`Failed to delete old layer ${layer.layer_id}:`, error.message);
      }
    }

    console.log(`Cleaned up ${removed} old court schedule layers`);
    return removed;
  }

  /**
   * Get current display status
   * @returns {Promise<Object>} Status information
   */
  async getDisplayStatus() {
    const tvs = await TV.findAll();
    const tvsWithLayers = tvs.filter(tv => tv.hasLayerSupport());

    const todaySchedule = await CourtHearing.findTodaysSchedule();
    const activeHearings = todaySchedule.filter(h =>
      h.status !== 'completed' && h.status !== 'cancelled'
    );

    // Count current court schedule layers
    const allLayers = await Layer.findAll();
    const todayGroup = `court_schedule_${new Date().toISOString().split('T')[0]}`;
    const currentLayers = allLayers.filter(layer => layer.group === todayGroup);

    return {
      tvs_with_layer_support: tvsWithLayers.length,
      todays_hearings: todaySchedule.length,
      active_hearings: activeHearings.length,
      current_layers: currentLayers.length,
      last_refresh: new Date().toISOString()
    };
  }

  /**
   * Update individual hearing display
   * @param {string} hearingId - Hearing ID to update
   * @returns {Promise<Object>} Update results
   */
  async updateHearingDisplay(hearingId) {
    const hearing = await CourtHearing.findById(hearingId);

    if (!hearing) {
      throw new Error('Hearing not found');
    }

    // Find all layers for this hearing
    const allLayers = await Layer.findAll();
    const hearingLayers = allLayers.filter(layer =>
      layer.metadata && layer.metadata.hearing_id === hearingId
    );

    // If hearing is completed or cancelled, remove layers
    if (hearing.status === 'completed' || hearing.status === 'cancelled') {
      for (const layer of hearingLayers) {
        await layer.delete();
      }
      return { layers_removed: hearingLayers.length, layers_updated: 0 };
    }

    // Otherwise, update existing layers with new data
    let updated = 0;
    for (const layer of hearingLayers) {
      const colors = hearing.getColorScheme();
      const text = hearing.getDisplayText();

      await layer.update({
        content: {
          ...layer.content,
          text,
          backgroundColor: `rgba(${colors.bg.join(',')})`,
          textColor: `rgba(${colors.text.join(',')})`
        },
        metadata: {
          ...layer.metadata,
          status: hearing.status,
          delay_minutes: hearing.delay_minutes
        }
      });

      // Publish update via MQTT
      await this.publishLayerUpdate(layer.tv_id, layer);
      updated++;
    }

    return { layers_removed: 0, layers_updated: updated };
  }
}

module.exports = new CourtDisplayService();
