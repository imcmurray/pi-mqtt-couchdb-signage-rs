const Joi = require('joi');
const sequenceService = require('../services/sequenceService');
const sceneService = require('../services/sceneService');
const Image = require('../models/image');
const TV = require('../models/tv.multilayer');
const { broadcastToClients } = require('../services/websocketService');

const timeOfDay = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).allow(null);

// Same window fields as image schedules (pi-slideshow-rs image_schedule.rs)
const scheduleSchema = Joi.object({
  start_time: Joi.string().isoDate().allow(null),
  end_time: Joi.string().isoDate().allow(null),
  days_of_week: Joi.array().items(Joi.number().integer().min(0).max(6)).max(7).default([]),
  daily_start: timeOfDay,
  daily_end: timeOfDay
}).allow(null);

const clipSchema = Joi.object({
  clip_id: Joi.string().max(60),
  kind: Joi.string().valid('image', 'scene').required(),
  ref: Joi.string().max(100).required(),
  duration_ms: Joi.number().integer().min(1000).max(3600000).required(),
  enabled: Joi.boolean().default(true),
  schedule: scheduleSchema.default(null)
});

const sequenceSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().allow('').max(500).default('')
});

const sequenceUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  description: Joi.string().allow('').max(500),
  clips: Joi.array().items(clipSchema).max(200)
}).min(1);

const mqttService = require('../services/multilayer.mqttService');

const notFound = res => res.status(404).json({ error: 'Sequence not found' });

// Tell the browser and every TV that played or now plays the sequence; the
// Pi re-reads its sequence on sync_layers
function changed(sequenceId, ...tvIdLists) {
  broadcastToClients('sequences_updated', { sequence_id: sequenceId });
  for (const tvId of new Set(tvIdLists.flat())) {
    mqttService.syncLayers(tvId);
  }
}

class SequenceController {
  async listSequences(req, res) {
    res.json(await sequenceService.list());
  }

  async getSequence(req, res) {
    const sequence = await sequenceService.get(req.params.sequenceId);
    return sequence ? res.json(sequence) : notFound(res);
  }

  async createSequence(req, res) {
    const { error, value } = sequenceSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const sequence = await sequenceService.create(value);
    changed(sequence.sequence_id);
    res.status(201).json(sequence);
  }

  async updateSequence(req, res) {
    const { error, value } = sequenceUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    if (value.clips) {
      const missing = await missingRefs(value.clips);
      if (missing.length) {
        return res.status(400).json({ error: `Clip source no longer exists: ${missing.join(', ')}` });
      }
    }

    const sequence = await sequenceService.update(req.params.sequenceId, value);
    if (!sequence) return notFound(res);
    changed(sequence.sequence_id, sequence.tv_ids || []);
    res.json(sequence);
  }

  async duplicateSequence(req, res) {
    const sequence = await sequenceService.duplicate(req.params.sequenceId, req.body?.name);
    if (!sequence) return notFound(res);
    changed(sequence.sequence_id);
    res.status(201).json(sequence);
  }

  async deleteSequence(req, res) {
    const existing = await sequenceService.get(req.params.sequenceId);
    if (!existing || !await sequenceService.remove(req.params.sequenceId)) return notFound(res);
    changed(req.params.sequenceId, existing.tv_ids || []);
    res.json({ message: 'Sequence deleted' });
  }

  // PUT /api/sequences/:id/tvs { tv_ids } - which TVs play this sequence
  async assignTvs(req, res) {
    const { error, value } = Joi.object({ tv_ids: Joi.array().items(Joi.string().max(100)).max(100).required() }).validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    for (const tvId of value.tv_ids) {
      if (!await TV.findById(tvId)) return res.status(400).json({ error: `TV ${tvId} not found` });
    }
    const before = await sequenceService.get(req.params.sequenceId);
    const sequence = await sequenceService.assignTvs(req.params.sequenceId, value.tv_ids);
    if (!sequence) return notFound(res);
    changed(sequence.sequence_id, before?.tv_ids || [], sequence.tv_ids);
    res.json(sequence);
  }
}

// Clip refs that point at a deleted image or scene
async function missingRefs(clips) {
  const missing = [];
  for (const ref of new Set(clips.map(clip => `${clip.kind}:${clip.ref}`))) {
    const [kind, id] = ref.split(/:(.+)/);
    const exists = kind === 'scene'
      ? await sceneService.get(id)
      : await Image.findById(id).catch(() => null);
    if (!exists) missing.push(id);
  }
  return missing;
}

module.exports = new SequenceController();
