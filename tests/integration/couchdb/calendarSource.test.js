// The live court calendar against a real CouchDB, with the court's
// _design/calendar (tests/fixtures/calendar/design.json). Skipped unless
// COUCHDB_TEST_URL is set, e.g.
//   COUCHDB_TEST_URL=http://admin:password@192.168.1.215:5984 npx jest tests/integration/couchdb
// Creates and deletes its own scratch database; touches nothing else.
const calendarSourceService = require('../../../src/services/calendarSourceService');
const datasetService = require('../../../src/services/datasetService');
const { courthouseToday } = require('../../../src/utils/calendarImport');
const design = require('../../fixtures/calendar/design.json');

const URL_ = process.env.COUCHDB_TEST_URL;
const describeLive = URL_ ? describe : describe.skip;

describeLive('live court calendar against CouchDB', () => {
  const database = `signage_it_${Date.now()}`;
  const conn = URL_ && calendarSourceService.connection(URL_, database);
  const today = courthouseToday();
  let stored = null;

  const couch = async (method, path, body) => {
    const response = await fetch(`${conn.base}${path}`, {
      method,
      headers: { ...conn.headers, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body)
    });
    return response.json();
  };
  const hearing = (id, start_time, extra = {}) => ({
    _id: `hearing:${id}`, type: 'hearing', date: today, courtroom: 'North', start_time,
    judge: 'Judge Anderson', case_number: `26-${id}`, case_title: `In re ${id}`, matter: 'Motion', movant: 'Debtor', status: 'scheduled', ...extra
  });
  const rows = () => stored?.rows || [];
  const until = async (check, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (check()) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  };

  beforeAll(async () => {
    await couch('PUT', '');
    await couch('PUT', `/${design._id}`, design);
    await couch('POST', '/_bulk_docs', { docs: [hearing('a', '10:00'), hearing('b', '09:00', { courtroom: 'South' }), { _id: 'note', type: 'note' }] });
  });

  beforeEach(() => {
    // The data set and settings live in memory here instead of the signage database
    jest.spyOn(datasetService, 'get').mockImplementation(async () => stored);
    jest.spyOn(datasetService, 'save').mockImplementation(async (id, fields) => { stored = fields; return fields; });
    jest.spyOn(calendarSourceService, 'saveSettings').mockResolvedValue();
  });

  afterAll(async () => {
    calendarSourceService.stop();
    await couch('DELETE', '');
  });

  it('refuses a database without the court design document', async () => {
    await expect(calendarSourceService.check({ database: '_users', server_url: URL_ })).rejects.toThrow(/no _design\/calendar|not found|reach/);
  });

  it('reads today from by_date_courtroom_time, sorted by time, hearings only', async () => {
    await calendarSourceService.connect({ database, server_url: URL_ });
    expect(rows().map(r => [r.time, r.courtroom])).toEqual([['09:00', 'South'], ['10:00', 'North']]);
    expect(stored.checked_at).toBeDefined();
  });

  it('follows edits, additions and deletions within seconds', async () => {
    const doc = await couch('GET', '/hearing:a');
    await couch('PUT', '/hearing:a', { ...doc, status: 'continued' });
    expect(await until(() => rows().find(r => r.hearing_id === 'hearing:a')?.status === 'continued')).toBe(true);

    await couch('PUT', '/hearing:c', hearing('c', '11:00'));
    expect(await until(() => rows().some(r => r.hearing_id === 'hearing:c'))).toBe(true);

    const added = await couch('GET', '/hearing:c');
    await couch('DELETE', `/hearing:c?rev=${added._rev}`);
    expect(await until(() => !rows().some(r => r.hearing_id === 'hearing:c'))).toBe(true);
  }, 60000);
});
