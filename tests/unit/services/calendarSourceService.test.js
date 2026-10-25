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
