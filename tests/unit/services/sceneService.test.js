jest.mock('../../../src/config/multilayer.database', () => ({ getDatabase: jest.fn() }));
const multilayerDb = require('../../../src/config/multilayer.database');
const sceneService = require('../../../src/services/sceneService');

// In-memory stand-in for the CouchDB layers database, with revision checks
function fakeDb() {
  const docs = new Map();
  return {
    docs,
    async get(id) {
      if (!docs.has(id)) throw Object.assign(new Error('missing'), { statusCode: 404 });
      return JSON.parse(JSON.stringify(docs.get(id)));
    },
    async insert(doc) {
      const current = docs.get(doc._id);
      if (current && current._rev !== doc._rev) throw Object.assign(new Error('conflict'), { statusCode: 409 });
      await new Promise(resolve => setTimeout(resolve, 1)); // let parallel writers interleave
      const rev = `${(parseInt(current?._rev, 10) || 0) + 1}-x`;
      docs.set(doc._id, JSON.parse(JSON.stringify({ ...doc, _rev: rev })));
      return { id: doc._id, rev };
    },
    async destroy(id) {
      docs.delete(id);
    },
    async find({ selector }) {
      return { docs: [...docs.values()].filter(d => d.type === selector.type) };
    }
  };
}

describe('sceneService', () => {
  let db;
  beforeEach(() => {
    db = fakeDb();
    multilayerDb.getDatabase.mockReturnValue(db);
  });

  it('creates a scene from a courthouse starter with fresh element ids', async () => {
    const scene = await sceneService.create({ name: 'Lobby Welcome', from_preset: 'courthouse-welcome' });
    expect(scene.type).toBe('scene');
    expect(scene.source).toBe('starter:courthouse-welcome');
    expect(scene.elements).toHaveLength(8);
    expect(new Set(scene.elements.map(e => e.layer_id)).size).toBe(8);
    expect(scene.elements.find(e => e.name === 'Clock').content.text).toBe('{time}');
  });

  it('rejects an unknown starter', async () => {
    await expect(sceneService.create({ name: 'x', from_preset: 'nope' })).rejects.toThrow(/Unknown starter/);
  });

  it('adds, updates and removes elements', async () => {
    const scene = await sceneService.create({ name: 'Blank' });
    const element = await sceneService.addElement(scene._id, { name: 'Title', content: { text: 'Hi' }, position: { x: 0, y: 0, width: 100, height: 50 } });
    const updated = await sceneService.updateElement(scene._id, element.layer_id, current => ({ ...current, content: { text: 'Hello' } }));
    expect(updated).toMatchObject({ layer_id: element.layer_id, content: { text: 'Hello' } });
    expect(await sceneService.removeElement(scene._id, element.layer_id)).toBe(true);
    expect((await sceneService.get(scene._id)).elements).toEqual([]);
    expect(await sceneService.updateElement(scene._id, 'missing', e => e)).toBeNull();
  });

  it('serialises parallel element edits on one scene (no lost updates)', async () => {
    const scene = await sceneService.create({ name: 'Busy', from_preset: 'courthouse-information' });
    await Promise.all(scene.elements.map((element, i) =>
      sceneService.updateElement(scene._id, element.layer_id, current => ({ ...current, priority: 100 + i }))));
    const saved = await sceneService.get(scene._id);
    expect(saved.elements.map(e => e.priority)).toEqual(scene.elements.map((_, i) => 100 + i));
  });

  it('caps the number of elements', async () => {
    const scene = await sceneService.create({ name: 'Full' });
    const element = { name: 'e', content: { text: '' }, position: { x: 0, y: 0, width: 1, height: 1 } };
    for (let i = 0; i < 40; i++) await sceneService.addElement(scene._id, element);
    await expect(sceneService.addElement(scene._id, element)).rejects.toThrow(/up to 40/);
  });

  it('duplicates a scene with new element ids', async () => {
    const scene = await sceneService.create({ name: 'Original', from_preset: 'court-calendar' });
    const copy = await sceneService.duplicate(scene._id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.elements).toHaveLength(scene.elements.length);
    expect(copy.elements[0].layer_id).not.toBe(scene.elements[0].layer_id);
  });

  it('seeds the three starter scenes only once', async () => {
    await sceneService.seedStarters();
    await sceneService.seedStarters();
    expect((await sceneService.list()).map(s => s.name)).toEqual(['Court Calendar', 'Courthouse Information', 'Courthouse Welcome']);
  });
});
