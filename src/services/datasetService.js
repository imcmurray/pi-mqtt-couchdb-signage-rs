const multilayerDb = require('../config/multilayer.database');
const TV = require('../models/tv.multilayer');
const mqttService = require('./multilayer.mqttService');

// Data sets feed live layers: the court calendar drawn by table layers and the
// weather/clock values used by {tokens} in layer text. They are stored next to the
// layers as `dataset_<id>` documents so TVs can read them straight from CouchDB
// (and keep showing them offline).
class DatasetService {
  getDb() {
    return multilayerDb.getDatabase('layers');
  }

  async get(datasetId) {
    try {
      return await this.getDb().get(`dataset_${datasetId}`);
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async list() {
    const result = await this.getDb().find({
      selector: { type: 'dataset' },
      fields: ['dataset_id', 'name', 'updated_at', 'row_count', 'source', 'values'],
      limit: 100
    });
    return result.docs;
  }

  // Replace a data set and tell every TV to refresh its layers (which re-reads data sets)
  async save(datasetId, fields) {
    const existing = await this.get(datasetId);
    const doc = {
      ...fields,
      _id: `dataset_${datasetId}`,
      type: 'dataset',
      dataset_id: datasetId,
      updated_at: new Date().toISOString()
    };
    if (existing) doc._rev = existing._rev;
    await this.getDb().insert(doc);
    await this.notifyTvs();
    return doc;
  }

  async notifyTvs() {
    const tvs = await TV.findAll();
    for (const tv of tvs) {
      mqttService.syncLayers(tv._id);
    }
  }
}

module.exports = new DatasetService();
