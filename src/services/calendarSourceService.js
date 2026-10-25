const config = require('../config/multilayer.config');
const multilayerDb = require('../config/multilayer.database');
const datasetService = require('./datasetService');
const { normalizeCalendar, courthouseToday } = require('../utils/calendarImport');

// Live court calendar: follows a CouchDB database of hearing documents (type
// "hearing") that has the court's _design/calendar, and keeps the court_calendar
// data set (what the TVs' calendar tables read) in step with it. Reads today
// through DAYS_AHEAD from by_date_courtroom_time, and re-reads when the database
// changes, or every RESYNC_MS (which also rolls the window over at midnight).
// The change feed is unfiltered on purpose: a deleted hearing is a tombstone with
// no `type`, so the design doc's calendar/hearings filter never reports deletions.
const CONFIG_ID = 'config_calendar_source';
const DESIGN = '_design/calendar';
const DAYS_AHEAD = 14;
const RESYNC_MS = 15 * 60 * 1000;
const CHANGE_DEBOUNCE_MS = 2000;
const RETRY_MS = 30 * 1000;
const LONGPOLL_MS = 55 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// fetch() won't take credentials in the URL; move them to a header
function connection(serverUrl, database) {
  const url = new URL(serverUrl || config.getDatabaseUrl());
  const headers = { Accept: 'application/json' };
  if (url.username) {
    const user = decodeURIComponent(url.username);
    const pass = decodeURIComponent(url.password);
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(database)}`;
  return { base, headers };
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Server URL without the password, for showing in the UI
const redact = serverUrl => {
  if (!serverUrl) return '';
  const url = new URL(serverUrl);
  if (url.password) url.password = '••••';
  return url.toString().replace(/\/$/, '');
};

class CalendarSourceService {
  constructor() {
    this.settings = null;    // { database, server_url }
    this.status = { state: 'off' };
    this.generation = 0;     // bumps on connect/disconnect so old loops stop
    this.resyncTimer = null;
    this.changeTimer = null;
    this.syncQueue = Promise.resolve();
  }

  getDb() {
    return multilayerDb.getDatabase('layers');
  }

  async loadSettings() {
    try {
      const doc = await this.getDb().get(CONFIG_ID);
      return doc.database ? { database: doc.database, server_url: doc.server_url || '' } : null;
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async saveSettings(settings) {
    let rev;
    try {
      rev = (await this.getDb().get(CONFIG_ID))._rev;
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    await this.getDb().insert({ _id: CONFIG_ID, ...(rev ? { _rev: rev } : {}), type: 'config', ...settings, updated_at: new Date().toISOString() });
  }

  async start() {
    const settings = await this.loadSettings();
    if (settings) this.run(settings);
  }

  publicStatus() {
    return {
      connected: !!this.settings,
      database: this.settings?.database || null,
      server: this.settings ? (redact(this.settings.server_url) || 'this server') : null,
      ...this.status
    };
  }

  async request(conn, path, timeoutMs = 15000) {
    const response = await fetch(`${conn.base}${path}`, { headers: conn.headers, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = body.reason || body.error || response.statusText;
      throw Object.assign(new Error(`${response.status} ${reason}`), { status: response.status });
    }
    return body;
  }

  // Check a database before following it: reachable, and has _design/calendar
  async check(settings) {
    const conn = connection(settings.server_url, settings.database);
    try {
      await this.request(conn, '');
    } catch (error) {
      throw Object.assign(new Error(error.status === 404
        ? `Database "${settings.database}" not found`
        : `Can't reach the database: ${error.message}`), { status: 400 });
    }
    try {
      const design = await this.request(conn, `/${DESIGN}`);
      if (!design.views?.by_date_courtroom_time) throw new Error('missing view');
    } catch (error) {
      throw Object.assign(new Error(`"${settings.database}" has no ${DESIGN} with a by_date_courtroom_time view`), { status: 400 });
    }
  }

  async connect(settings) {
    await this.check(settings);
    await this.saveSettings(settings);
    this.run(settings);
    await this.sync();
    return this.publicStatus();
  }

  async disconnect() {
    await this.saveSettings({ database: null, server_url: null });
    this.stop();
    this.status = { state: 'off' };
  }

  stop() {
    this.generation++;
    this.settings = null;
    clearInterval(this.resyncTimer);
    clearTimeout(this.changeTimer);
  }

  run(settings) {
    this.stop();
    this.settings = settings;
    this.status = { state: 'connecting' };
    const generation = this.generation;
    this.sync().catch(() => {});
    this.resyncTimer = setInterval(() => this.sync().catch(() => {}), RESYNC_MS);
    this.follow(generation);
  }

  // One sync at a time (start, connect, the change feed and the timer can overlap;
  // parallel writes to the data set would conflict)
  sync() {
    const run = this.syncQueue.catch(() => {}).then(() => this.syncOnce());
    this.syncQueue = run;
    return run;
  }

  // Read the calendar window and update the data set if anything changed
  async syncOnce() {
    const settings = this.settings;
    if (!settings) return;
    const conn = connection(settings.server_url, settings.database);
    const from = courthouseToday();
    const to = addDays(from, DAYS_AHEAD);
    const query = `?startkey=${encodeURIComponent(JSON.stringify([from]))}&endkey=${encodeURIComponent(JSON.stringify([to, {}]))}`;
    try {
      const view = await this.request(conn, `/${DESIGN}/_view/by_date_courtroom_time${query}`);
      const { rows } = normalizeCalendar(view);
      const current = await datasetService.get('court_calendar');
      const changed = JSON.stringify(current?.rows) !== JSON.stringify(rows) || current?.source !== this.sourceLabel();
      if (changed) {
        await datasetService.save('court_calendar', {
          name: 'Court Calendar',
          source: this.sourceLabel(),
          row_count: rows.length,
          rows
        });
        console.log(`📅 Court calendar synced from ${settings.database}: ${rows.length} hearing(s) ${from}..${to}`);
      }
      this.status = { state: 'live', last_sync: new Date().toISOString(), hearings: rows.length, window: [from, to] };
    } catch (error) {
      this.status = { ...this.status, state: 'error', error: error.message, last_attempt: new Date().toISOString() };
      console.error(`Calendar sync from ${settings.database} failed:`, error.message);
      throw error;
    }
  }

  sourceLabel() {
    return `CouchDB ${this.settings.database} (live)`;
  }

  // Follow the change feed; any change (including deletions) triggers a debounced
  // re-read, which only rewrites the data set if the hearings actually differ
  async follow(generation) {
    let since = 'now';
    while (generation === this.generation) {
      const settings = this.settings;
      try {
        const conn = connection(settings.server_url, settings.database);
        const changes = await this.request(conn,
          `/_changes?feed=longpoll&since=${encodeURIComponent(since)}&timeout=${LONGPOLL_MS}`,
          LONGPOLL_MS + 10000);
        if (generation !== this.generation) return;
        since = changes.last_seq;
        if (changes.results?.length) {
          clearTimeout(this.changeTimer);
          this.changeTimer = setTimeout(() => this.sync().catch(() => {}), CHANGE_DEBOUNCE_MS);
        }
      } catch (error) {
        if (generation !== this.generation) return;
        this.status = { ...this.status, state: 'error', error: `Change feed: ${error.message}` };
        await sleep(RETRY_MS);
      }
    }
  }
}

module.exports = new CalendarSourceService();
module.exports.connection = connection;
module.exports.addDays = addDays;
