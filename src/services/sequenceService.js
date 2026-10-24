const { v4: uuidv4 } = require('uuid');
const multilayerDb = require('../config/multilayer.database');
const Image = require('../models/image');
const TV = require('../models/tv.multilayer');

// A sequence is the looping timeline a TV plays: clips that are either an Image
// Library image or a scene, each with its own duration, on/off switch and
// optional schedule. Stored as `sequence_<uuid>` documents in the layers database
// (TVs read them directly). A TV plays at most one sequence (`tv_ids`).
const newClipId = () => `clip_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

const hasSchedule = schedule => schedule && (
  schedule.start_time || schedule.end_time || schedule.daily_start || schedule.daily_end
  || (schedule.days_of_week || []).length);

class SequenceService {
  constructor() {
    this.locks = new Map();
  }

  getDb() {
    return multilayerDb.getDatabase('layers');
  }

  async withLock(id, fn) {
    const previous = this.locks.get(id) || Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  async all() {
    const result = await this.getDb().find({ selector: { type: 'sequence' }, limit: 500 });
    return result.docs;
  }

  // Summaries; clips are included (they're small) so pages can show what plays where
  async list() {
    return (await this.all())
      .map(sequence => ({
        ...sequence,
        clip_count: sequence.clips.length,
        total_ms: sequence.clips.filter(c => c.enabled).reduce((sum, c) => sum + c.duration_ms, 0)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(sequenceId) {
    try {
      const doc = await this.getDb().get(sequenceId);
      return doc.type === 'sequence' ? doc : null;
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

  async create({ name, description = '', clips = [], tv_ids: tvIds = [] }) {
    const id = `sequence_${uuidv4()}`;
    const doc = await this.save({
      _id: id,
      type: 'sequence',
      sequence_id: id,
      name,
      description,
      clips: clips.map(clip => ({ ...clip, clip_id: clip.clip_id || newClipId() })),
      tv_ids: [],
      created_at: new Date().toISOString()
    });
    return tvIds.length ? this.assignTvs(id, tvIds) : doc;
  }

  async update(sequenceId, fields) {
    return this.withLock(sequenceId, async () => {
      const doc = await this.get(sequenceId);
      if (!doc) return null;
      if (fields.clips) {
        fields = { ...fields, clips: fields.clips.map(clip => ({ ...clip, clip_id: clip.clip_id || newClipId() })) };
      }
      Object.assign(doc, fields);
      return this.save(doc);
    });
  }

  async duplicate(sequenceId, name) {
    const doc = await this.get(sequenceId);
    if (!doc) return null;
    return this.create({
      name: name || `${doc.name} (copy)`,
      description: doc.description,
      clips: doc.clips.map(({ clip_id, ...clip }) => clip)
    });
  }

  async remove(sequenceId) {
    const doc = await this.get(sequenceId);
    if (!doc) return false;
    await this.getDb().destroy(doc._id, doc._rev);
    return true;
  }

  // A TV plays one sequence: assigning it here takes it off any other sequence
  async assignTvs(sequenceId, tvIds) {
    const target = await this.get(sequenceId);
    if (!target) return null;
    for (const other of await this.all()) {
      if (other._id === sequenceId) continue;
      const remaining = (other.tv_ids || []).filter(id => !tvIds.includes(id));
      if (remaining.length !== (other.tv_ids || []).length) {
        await this.update(other._id, { tv_ids: remaining });
      }
    }
    return this.update(sequenceId, { tv_ids: [...new Set(tvIds)] });
  }

  async findForTv(tvId) {
    return (await this.all()).find(sequence => (sequence.tv_ids || []).includes(tvId)) || null;
  }

  // TVs playing a sequence that shows this scene or image
  async tvsUsing(ref) {
    const tvIds = (await this.all())
      .filter(sequence => sequence.clips.some(clip => clip.ref === ref))
      .flatMap(sequence => sequence.tv_ids || []);
    return [...new Set(tvIds)];
  }

  // Drop every clip of a deleted image; returns the TVs whose sequence changed
  async removeRef(ref) {
    const tvIds = [];
    for (const sequence of await this.all()) {
      if (!sequence.clips.some(clip => clip.ref === ref)) continue;
      await this.update(sequence._id, { clips: sequence.clips.filter(clip => clip.ref !== ref) });
      tvIds.push(...(sequence.tv_ids || []));
    }
    return [...new Set(tvIds)];
  }

  // Sequences that show this scene or image (for "used in" hints and safe deletes)
  async usedBy(ref) {
    return (await this.all())
      .filter(sequence => sequence.clips.some(clip => clip.ref === ref))
      .map(({ sequence_id, name }) => ({ sequence_id, name }));
  }

  // The TV's current image playlist as clips: same order, on/off state, display
  // times and schedules
  static playlistClips(images, tv) {
    const tvDefault = tv.config?.display_duration || 10000;
    return images.map(image => ({
      kind: 'image',
      ref: image._id,
      duration_ms: image.display_duration || tvDefault,
      enabled: image.isEnabledForTv(tv._id),
      schedule: hasSchedule(image.schedule) ? image.schedule : null
    }));
  }

  // First run: every TV's image playlist becomes "<TV name> Playlist", assigned to it
  async migratePlaylists() {
    const existing = await this.getDb().find({ selector: { type: 'sequence' }, fields: ['_id'], limit: 1 });
    if (existing.docs.length) return;
    for (const tv of await TV.findAll()) {
      const clips = SequenceService.playlistClips(await Image.findByTvId(tv._id), tv);
      if (!clips.length) continue;
      await this.create({
        name: `${tv.name} Playlist`,
        description: `Created from ${tv.name}'s image playlist`,
        clips,
        tv_ids: [tv._id]
      });
      console.log(`🎞️ Created sequence "${tv.name} Playlist" (${clips.length} clips)`);
    }
  }
}

module.exports = new SequenceService();
module.exports.SequenceService = SequenceService;
