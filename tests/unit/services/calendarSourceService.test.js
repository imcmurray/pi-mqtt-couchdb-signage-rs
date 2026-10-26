jest.mock('../../../src/config/multilayer.database', () => ({ getDatabase: jest.fn() }));
jest.mock('../../../src/services/datasetService', () => ({ get: jest.fn(), save: jest.fn() }));
const { connection, addDays } = require('../../../src/services/calendarSourceService');

describe('calendarSourceService helpers', () => {
  it('moves URL credentials into a Basic auth header (fetch rejects them in URLs)', () => {
    const conn = connection('http://reader:s3cr%40t@couch.example:5984/', 'court_calendar');
    expect(conn.base).toBe('http://couch.example:5984/court_calendar');
    expect(conn.headers.Authorization).toBe(`Basic ${Buffer.from('reader:s3cr@t').toString('base64')}`);
  });

  it('works without credentials', () => {
    const conn = connection('https://couch.example', 'hearings');
    expect(conn.base).toBe('https://couch.example/hearings');
    expect(conn.headers.Authorization).toBeUndefined();
  });

  it('adds days across month ends without time zone drift', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('calendarSourceService.sync', () => {
  const service = require('../../../src/services/calendarSourceService');

  it('runs one sync at a time', async () => {
    let running = 0;
    let maxRunning = 0;
    const original = service.syncOnce;
    service.syncOnce = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running--;
    };
    await Promise.all([service.sync(), service.sync(), service.sync()]);
    service.syncOnce = original;
    expect(maxRunning).toBe(1);
  });
});

describe('calendarSourceService.syncOnce', () => {
  const service = require('../../../src/services/calendarSourceService');
  const datasetService = require('../../../src/services/datasetService');
  const view = { rows: [{ id: 'hearing:1', key: ['2026-10-25', 'North', '09:00', 'Judge Anderson', '26-1'], value: { case_title: 'In re A', matter: 'Motion', status: 'scheduled' } }] };

  beforeEach(() => {
    service.settings = { database: 'court_calendar', server_url: 'http://couch:5984' };
    jest.spyOn(service, 'request').mockResolvedValue(view);
    jest.spyOn(datasetService, 'save').mockResolvedValue({});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    service.settings = null;
  });

  const current = async checkedAgoMs => {
    // What the data set holds after a sync of `view`
    jest.spyOn(datasetService, 'get').mockResolvedValue(null);
    await service.syncOnce();
    const saved = datasetService.save.mock.calls[0][1];
    datasetService.save.mockClear();
    datasetService.get.mockResolvedValue({ ...saved, checked_at: new Date(Date.now() - checkedAgoMs).toISOString() });
    return saved;
  };

  it('stamps checked_at on every write', async () => {
    const saved = await current(0);
    expect(Date.parse(saved.checked_at)).toBeGreaterThan(Date.now() - 5000);
  });

  it('leaves an unchanged, recently checked calendar alone', async () => {
    await current(60 * 1000);
    await service.syncOnce();
    expect(datasetService.save).not.toHaveBeenCalled();
  });

  it('re-stamps an unchanged calendar when the stamp gets old, so TVs know it is still live', async () => {
    await current(11 * 60 * 1000);
    await service.syncOnce();
    expect(datasetService.save).toHaveBeenCalledTimes(1);
  });

  it('does not stamp when the source fails, so the TVs see it go stale', async () => {
    await current(60 * 1000);
    service.request.mockRejectedValue(new Error('503 down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(service.syncOnce()).rejects.toThrow('503 down');
    expect(datasetService.save).not.toHaveBeenCalled();
    expect(service.status.state).toBe('error');
  });
});
