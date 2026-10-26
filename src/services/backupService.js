const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const cron = require('node-cron');
const config = require('../config/multilayer.config');
const notifyService = require('./notifyService');
const { connection } = require('./calendarSourceService');

// Nightly backup of every signage database (TVs, images with their files,
// layers/scenes/sequences/data sets, alerts, presets) to one gzipped JSON file:
//   { created_at, manager_version, databases: { <name>: <_all_docs response> } }
// with documents and attachments inline, so scripts/restore-backup.js can put
// them back with their revisions. Kept in BACKUP_DIR (default ./backups, which is
// the stack directory on the Docker host); the newest BACKUP_KEEP are kept.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 7;
const SCHEDULE = process.env.BACKUP_SCHEDULE || '15 2 * * *';   // 2:15 AM courthouse time
const TIME_ZONE = process.env.COURT_TIME_ZONE || 'America/Denver';
const FILE_PATTERN = /^signage-\d{8}-\d{6}\.json\.gz$/;

// "15 2 * * *" -> "every night at 2:15 AM"; anything fancier is shown as written
function describeSchedule(schedule) {
  const match = schedule.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match) return `${schedule} (${TIME_ZONE})`;
  const [minute, hour] = [Number(match[1]), Number(match[2])];
  return `every night at ${((hour + 11) % 12) + 1}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

const stamp = date => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

class BackupService {
  constructor() {
    this.task = null;
    this.running = null;
    this.last = null;   // { ok, file?, error?, at }
  }

  databases() {
    return [...new Set(Object.values(config.database.databases))];
  }

  start() {
    if (this.task) return;
    this.task = cron.schedule(SCHEDULE, () => this.run().catch(() => {}), { timezone: TIME_ZONE });
  }

  stop() {
    this.task?.stop();
    this.task = null;
  }

  // One backup at a time; a second request waits for the running one
  run() {
    if (!this.running) {
      this.running = this.runOnce().finally(() => { this.running = null; });
    }
    return this.running;
  }

  async runOnce() {
    const started = new Date();
    const name = `signage-${stamp(started)}.json.gz`;
    const partial = path.join(BACKUP_DIR, `${name}.partial`);
    try {
      await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
      const counts = {};
      await pipeline(Readable.from(this.chunks(started, counts)), zlib.createGzip(), fs.createWriteStream(partial));
      await fs.promises.rename(partial, path.join(BACKUP_DIR, name));
      await this.prune();
      const { size } = await fs.promises.stat(path.join(BACKUP_DIR, name));
      this.last = { ok: true, file: name, size, counts, at: new Date().toISOString() };
      console.log(`💾 Backup ${name}: ${Object.entries(counts).map(([db, n]) => `${db} ${n}`).join(', ')} (${(size / 1e6).toFixed(1)} MB)`);
      await notifyService.report('backup:nightly', true, {
        label: 'Nightly backup',
        problem: { title: '', body: '' },
        recovery: { title: 'Signage: backups are working again', body: `Backed up ${name} (${(size / 1e6).toFixed(1)} MB).` }
      });
      return this.last;
    } catch (error) {
      await fs.promises.rm(partial, { force: true });
      this.last = { ok: false, error: error.message, at: new Date().toISOString() };
      console.error('Backup failed:', error.message);
      await notifyService.report('backup:nightly', false, {
        label: 'Nightly backup',
        problem: { title: 'Signage: backup failed', body: `The signage database backup failed: ${error.message}` },
        recovery: { title: '', body: '' }
      });
      throw error;
    }
  }

  // The backup file's JSON, streamed one database at a time
  async *chunks(started, counts) {
    const { version } = require('../../package.json');
    yield `{"created_at":${JSON.stringify(started.toISOString())},"manager_version":${JSON.stringify(version)},"databases":{`;
    let first = true;
    for (const db of this.databases()) {
      const conn = connection(config.getDatabaseUrl(), db);
      const response = await fetch(`${conn.base}/_all_docs?include_docs=true&attachments=true`, { headers: conn.headers });
      if (response.status === 404) continue;   // not created yet
      if (!response.ok) throw new Error(`${db}: ${response.status} ${response.statusText}`);
      yield `${first ? '' : ','}${JSON.stringify(db)}:`;
      first = false;
      let tail = '';
      for await (const chunk of response.body) {
        const text = Buffer.from(chunk).toString('utf8');
        tail = (tail + text).slice(-64);
        yield text;
      }
      counts[db] = await this.docCount(conn);
      if (!tail.trimEnd().endsWith('}')) throw new Error(`${db}: incomplete response`);
    }
    yield '}}';
  }

  async docCount(conn) {
    const response = await fetch(conn.base, { headers: conn.headers });
    return (await response.json()).doc_count;
  }

  async list() {
    let files = [];
    try {
      files = (await fs.promises.readdir(BACKUP_DIR)).filter(f => FILE_PATTERN.test(f));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const backups = await Promise.all(files.map(async file => {
      const { size, mtime } = await fs.promises.stat(path.join(BACKUP_DIR, file));
      return { file, size, created_at: mtime.toISOString() };
    }));
    return backups.sort((a, b) => b.file.localeCompare(a.file));
  }

  async prune() {
    const backups = await this.list();
    for (const old of backups.slice(KEEP)) {
      await fs.promises.rm(path.join(BACKUP_DIR, old.file), { force: true });
    }
  }

  // Absolute path of a backup, or null (only names from list(), no traversal)
  filePath(file) {
    return FILE_PATTERN.test(file) ? path.join(BACKUP_DIR, file) : null;
  }

  async status() {
    return { directory: BACKUP_DIR, keep: KEEP, schedule: describeSchedule(SCHEDULE), last: this.last, running: !!this.running, backups: await this.list() };
  }
}

module.exports = new BackupService();
module.exports.BACKUP_DIR = BACKUP_DIR;
