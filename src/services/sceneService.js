const { v4: uuidv4 } = require('uuid');
const multilayerDb = require('../config/multilayer.database');
const BUILTIN_PRESETS = require('../config/builtinPresets');

// Scenes are designed 1920x1080 screens (text with live values, images, tables,
// colour blocks) that sequences play as clips. Each is one `scene_<uuid>` document
// in the layers database holding its elements, so TVs can read it directly.
// Elements have the same shape as Layer Control layers (`layer_id` is their id).
const MAX_ELEMENTS = 40;
const STARTER_PRESETS = ['courthouse-welcome', 'courthouse-information', 'court-calendar'];

const newId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

class SceneService {
  constructor() {
    // Serialises read-modify-write per scene so parallel element edits don't conflict
    this.locks = new Map();
  }

  getDb() {
    return multilayerDb.getDatabase('layers');
  }

  async withLock(sceneId, fn) {
    const previous = this.locks.get(sceneId) || Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    this.locks.set(sceneId, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(sceneId) === run) this.locks.delete(sceneId);
    }
  }

  async list() {
    const result = await this.getDb().find({
      selector: { type: 'scene' },
      fields: ['scene_id', 'name', 'description', 'elements', 'updated_at', 'source'],
      limit: 500
    });
    return result.docs
      .map(({ elements, ...scene }) => ({ ...scene, element_count: (elements || []).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(sceneId) {
    try {
      const doc = await this.getDb().get(sceneId);
      return doc.type === 'scene' ? doc : null;
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async save(doc) {
    doc.updated_at = new Date().toISOString();
    const result = await this.getDb().insert(doc);
    doc._rev = result.rev;
    return doc;
  }

  // Starter presets a new scene can begin from
  starters() {
    return BUILTIN_PRESETS
      .filter(p => STARTER_PRESETS.includes(p.preset_id))
      .map(({ preset_id, name, description, layers }) => ({ preset_id, name, description, element_count: layers.length }));
  }

  async create({ name, description = '', from_preset: fromPreset }) {
    let elements = [];
    let source = 'blank';
    if (fromPreset) {
      const preset = BUILTIN_PRESETS.find(p => p.preset_id === fromPreset);
      if (!preset) throw Object.assign(new Error(`Unknown starter "${fromPreset}"`), { status: 400 });
      elements = preset.layers.map(layer => ({ ...JSON.parse(JSON.stringify(layer)), layer_id: newId('element') }));
      source = `starter:${fromPreset}`;
      description = description || preset.description;
    }
    const sceneId = `scene_${uuidv4()}`;
    return this.save({
      _id: sceneId,
      type: 'scene',
      scene_id: sceneId,
      name,
      description,
      source,
      elements,
      created_at: new Date().toISOString()
    });
  }

  async update(sceneId, fields) {
    return this.withLock(sceneId, async () => {
      const doc = await this.get(sceneId);
      if (!doc) return null;
      Object.assign(doc, fields);
      return this.save(doc);
    });
  }

  async duplicate(sceneId, name) {
    const doc = await this.get(sceneId);
    if (!doc) return null;
    const copy = await this.create({ name: name || `${doc.name} (copy)`, description: doc.description });
    copy.elements = doc.elements.map(element => ({ ...element, layer_id: newId('element') }));
    copy.source = `copy:${sceneId}`;
    return this.save(copy);
  }

  async remove(sceneId) {
    const doc = await this.get(sceneId);
    if (!doc) return false;
    await this.getDb().destroy(doc._id, doc._rev);
    return true;
  }

  // --- Elements ---

  async addElement(sceneId, element) {
    return this.withLock(sceneId, async () => {
      const doc = await this.get(sceneId);
      if (!doc) return null;
      if (doc.elements.length >= MAX_ELEMENTS) {
        throw Object.assign(new Error(`A scene can hold up to ${MAX_ELEMENTS} elements`), { status: 400 });
      }
      const created = { ...element, layer_id: newId('element') };
      doc.elements.push(created);
      await this.save(doc);
      return created;
    });
  }

  // update(element) returns the new element, or throws; null when not found
  async updateElement(sceneId, elementId, update) {
    return this.withLock(sceneId, async () => {
      const doc = await this.get(sceneId);
      const index = doc ? doc.elements.findIndex(e => e.layer_id === elementId) : -1;
      if (index < 0) return null;
      doc.elements[index] = { ...update(doc.elements[index]), layer_id: elementId };
      await this.save(doc);
      return doc.elements[index];
    });
  }

  async removeElement(sceneId, elementId) {
    return this.withLock(sceneId, async () => {
      const doc = await this.get(sceneId);
      if (!doc || !doc.elements.some(e => e.layer_id === elementId)) return false;
      doc.elements = doc.elements.filter(e => e.layer_id !== elementId);
      await this.save(doc);
      return true;
    });
  }

  // First run: give people the three courthouse scenes to start from
  async seedStarters() {
    const existing = await this.getDb().find({ selector: { type: 'scene' }, fields: ['_id'], limit: 1 });
    if (existing.docs.length) return;
    for (const starter of this.starters()) {
      await this.create({ name: starter.name, from_preset: starter.preset_id });
    }
    console.log(`🎬 Created ${STARTER_PRESETS.length} starter scenes`);
  }
}

module.exports = new SceneService();
