jest.mock('../../../src/config/multilayer.database', () => ({ getDatabase: jest.fn() }));
jest.mock('../../../src/models/image', () => ({ findByTvId: jest.fn() }));
jest.mock('../../../src/models/tv.multilayer', () => ({ findAll: jest.fn() }));
const multilayerDb = require('../../../src/config/multilayer.database');
const Image = require('../../../src/models/image');
const TV = require('../../../src/models/tv.multilayer');
const sequenceService = require('../../../src/services/sequenceService');
const { SequenceService } = sequenceService;

function fakeDb() {
  const docs = new Map();
  return {
    async get(id) {
      if (!docs.has(id)) throw Object.assign(new Error('missing'), { statusCode: 404 });
      return JSON.parse(JSON.stringify(docs.get(id)));
    },
    async insert(doc) {
      const current = docs.get(doc._id);
      if (current && current._rev !== doc._rev) throw Object.assign(new Error('conflict'), { statusCode: 409 });
      const rev = `${(parseInt(current?._rev, 10) || 0) + 1}-x`;
      docs.set(doc._id, JSON.parse(JSON.stringify({ ...doc, _rev: rev })));
      return { id: doc._id, rev };
    },
    async destroy(id) { docs.delete(id); },
    async find({ selector }) { return { docs: [...docs.values()].filter(d => d.type === selector.type) }; }
  };
}

const image = (id, { enabled = true, display_duration = null, schedule = {} } = {}) => ({
  _id: id, display_duration, schedule, isEnabledForTv: () => enabled
});
const clip = (ref, ms = 10000) => ({ kind: 'image', ref, duration_ms: ms, enabled: true, schedule: null });

describe('sequenceService', () => {
  beforeEach(() => {
    multilayerDb.getDatabase.mockReturnValue(fakeDb());
  });

  it('turns an image playlist into clips, keeping order, on/off, durations and schedules', () => {
    const tv = { _id: 'tv_1', config: { display_duration: 20000 } };
    const clips = SequenceService.playlistClips([
      image('a'),
      image('b', { enabled: false, display_duration: 15000 }),
      image('c', { schedule: { days_of_week: [1, 2], start_time: null } })
    ], tv);
    expect(clips).toEqual([
      { kind: 'image', ref: 'a', duration_ms: 20000, enabled: true, schedule: null },
      { kind: 'image', ref: 'b', duration_ms: 15000, enabled: false, schedule: null },
      { kind: 'image', ref: 'c', duration_ms: 20000, enabled: true, schedule: { days_of_week: [1, 2], start_time: null } }
    ]);
  });

  it('gives clips ids and totals only enabled clips', async () => {
    const seq = await sequenceService.create({ name: 'Lobby', clips: [clip('a', 5000), { ...clip('b', 7000), enabled: false }] });
    expect(seq.clips.every(c => c.clip_id)).toBe(true);
    expect((await sequenceService.list())[0]).toMatchObject({ name: 'Lobby', clip_count: 2, total_ms: 5000 });
  });

  it('plays one sequence per TV: assigning moves the TV', async () => {
    const lobby = await sequenceService.create({ name: 'Lobby', tv_ids: ['tv_1', 'tv_2'] });
    const hall = await sequenceService.create({ name: 'Hall' });
    await sequenceService.assignTvs(hall._id, ['tv_2']);
    expect((await sequenceService.get(lobby._id)).tv_ids).toEqual(['tv_1']);
    expect((await sequenceService.findForTv('tv_2')).name).toBe('Hall');
  });

  it('duplicates without TVs and with new clip ids', async () => {
    const lobby = await sequenceService.create({ name: 'Lobby', clips: [clip('a')], tv_ids: ['tv_1'] });
    const copy = await sequenceService.duplicate(lobby._id);
    expect(copy).toMatchObject({ name: 'Lobby (copy)', tv_ids: [] });
    expect(copy.clips[0].clip_id).not.toBe(lobby.clips[0].clip_id);
  });

  it('reports which sequences use a scene', async () => {
    await sequenceService.create({ name: 'Lobby', clips: [{ ...clip('scene_1'), kind: 'scene' }] });
    expect(await sequenceService.usedBy('scene_1')).toEqual([expect.objectContaining({ name: 'Lobby' })]);
    expect(await sequenceService.usedBy('scene_2')).toEqual([]);
  });

  it('migrates each TV playlist once, skipping TVs without images', async () => {
    TV.findAll.mockResolvedValue([
      { _id: 'tv_1', name: 'Dev1', config: { display_duration: 20000 } },
      { _id: 'tv_2', name: 'Empty', config: {} }
    ]);
    Image.findByTvId.mockImplementation(async tvId => (tvId === 'tv_1' ? [image('a'), image('b')] : []));
    await sequenceService.migratePlaylists();
    await sequenceService.migratePlaylists();
    const sequences = await sequenceService.list();
    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({ name: 'Dev1 Playlist', tv_ids: ['tv_1'], clip_count: 2, total_ms: 40000 });
  });
});
