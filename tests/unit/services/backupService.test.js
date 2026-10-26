const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

describe('backupService', () => {
  let dir;
  let backupService;
  let notifyService;

  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signage-backup-'));
    process.env.BACKUP_DIR = dir;
    process.env.BACKUP_KEEP = '2';
    backupService = require('../../../src/services/backupService');
    notifyService = require('../../../src/services/notifyService');
    jest.spyOn(notifyService, 'report').mockResolvedValue(false);
    jest.spyOn(backupService, 'databases').mockReturnValue(['tvs_multilayer', 'layers_multilayer', 'missing_db']);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async url => {
      if (url.includes('missing_db')) return { ok: false, status: 404 };
      const db = url.match(/\/(\w+_multilayer)/)[1];
      if (url.includes('_all_docs')) {
        // Arrive in pieces, like a real stream
        const body = JSON.stringify({ total_rows: 1, offset: 0, rows: [{ id: `${db}-doc`, doc: { _id: `${db}-doc`, _rev: '1-a' } }] });
        return { ok: true, status: 200, body: [body.slice(0, 10), body.slice(10)].map(s => Buffer.from(s)) };
      }
      return { ok: true, status: 200, json: async () => ({ doc_count: 1 }) };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_KEEP;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes every existing database into one gzipped JSON file', async () => {
    const result = await backupService.run();
    const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, result.file))));
    expect(Object.keys(backup.databases)).toEqual(['tvs_multilayer', 'layers_multilayer']);
    expect(backup.databases.layers_multilayer.rows[0].doc._id).toBe('layers_multilayer-doc');
    expect(result.counts).toEqual({ tvs_multilayer: 1, layers_multilayer: 1 });
    expect(notifyService.report).toHaveBeenCalledWith('backup:nightly', true, expect.anything());
  });

  it('keeps only the newest BACKUP_KEEP backups', async () => {
    for (const name of ['signage-20260101-000000.json.gz', 'signage-20260102-000000.json.gz', 'signage-20260103-000000.json.gz']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    const result = await backupService.run();
    expect((await backupService.list()).map(b => b.file)).toEqual([result.file, 'signage-20260103-000000.json.gz']);
  });

  it('reports a failure and leaves no partial file', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, statusText: 'boom' }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(backupService.run()).rejects.toThrow('500');
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(notifyService.report).toHaveBeenCalledWith('backup:nightly', false, expect.anything());
  });

  it('only serves backup file names, never other paths', () => {
    expect(backupService.filePath('../../etc/passwd')).toBeNull();
    expect(backupService.filePath('signage-20260101-000000.json.gz')).toBe(path.join(dir, 'signage-20260101-000000.json.gz'));
  });
});
