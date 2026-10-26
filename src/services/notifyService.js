const multilayerDb = require('../config/multilayer.database');

// Push notifications through ntfy, with the same discipline as the homelab's
// cluster-health-alert and Overseer's notify.py:
//  * push on state change only: a fault that lasts a week pushes once
//  * push recoveries too: that's the message that says whether to act
//  * failures push, successes don't; a healthy first sighting is silent
// The topic URL is the credential: NTFY_URL in the environment wins, otherwise
// it's set from the System page and stored in the config_notifications doc.
// It is never logged or returned in full.
const CONFIG_ID = 'config_notifications';
const STATE_ID = 'state_notifications';
const TIMEOUT_MS = 10000;

// HTTP headers are ASCII; ntfy carries the title in one. The body is UTF-8.
function asciiHeader(value) {
  return String(value)
    .replace(/[·–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e]/g, '?');
}

// "https://ntfy.sh/abc123secret" -> "https://ntfy.sh/abc1…"
function redact(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const topic = parsed.pathname.replace(/^\//, '');
    return `${parsed.origin}/${topic.slice(0, 4)}…`;
  } catch {
    return '(invalid URL)';
  }
}

class NotifyService {
  constructor() {
    this.settings = null;
    this.state = null;
  }

  getDb() {
    return multilayerDb.getDatabase('layers');
  }

  async getDoc(id) {
    try {
      return await this.getDb().get(id);
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async loadSettings() {
    if (!this.settings) {
      const doc = await this.getDoc(CONFIG_ID);
      this.settings = { ntfy_url: doc?.ntfy_url || '', enabled: doc?.enabled !== false };
    }
    return this.settings;
  }

  async url() {
    return process.env.NTFY_URL || (await this.loadSettings()).ntfy_url;
  }

  async publicSettings() {
    const settings = await this.loadSettings();
    const url = await this.url();
    return {
      configured: !!url,
      from_environment: !!process.env.NTFY_URL,
      topic: redact(url),
      enabled: settings.enabled,
      states: await this.currentStates()
    };
  }

  async saveSettings({ ntfy_url: ntfyUrl, enabled }) {
    const doc = (await this.getDoc(CONFIG_ID)) || { _id: CONFIG_ID, type: 'config' };
    if (ntfyUrl !== undefined) doc.ntfy_url = ntfyUrl;
    if (enabled !== undefined) doc.enabled = enabled;
    doc.updated_at = new Date().toISOString();
    await this.getDb().insert(doc);
    this.settings = null;
    return this.publicSettings();
  }

  // Send one notification. Never throws: a failed push is not a failed check.
  async push(title, body, { priority = 'default', tags = '' } = {}) {
    const url = await this.url();
    if (!url || !(await this.loadSettings()).enabled) return false;
    const headers = { Title: asciiHeader(title), Priority: priority };
    if (tags) headers.Tags = asciiHeader(tags);
    try {
      const response = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) console.error(`ntfy push failed: ${response.status}`);
      return response.ok;
    } catch (error) {
      console.error('ntfy push failed:', error.message);
      return false;
    }
  }

  // --- alert state (kept in CouchDB so a restart doesn't re-push) ---

  async loadState() {
    if (!this.state) {
      const doc = await this.getDoc(STATE_ID);
      this.state = { doc: doc || { _id: STATE_ID, type: 'state', alerts: {} } };
    }
    return this.state.doc.alerts;
  }

  async currentStates() {
    const alerts = await this.loadState();
    return Object.entries(alerts)
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async saveState() {
    const doc = this.state.doc;
    doc.updated_at = new Date().toISOString();
    try {
      const result = await this.getDb().insert(doc);
      doc._rev = result.rev;
    } catch (error) {
      // Someone else wrote it (another process): reload next time
      if (error.statusCode === 409) this.state = null;
      else throw error;
    }
  }

  /**
   * Report the state of one thing being watched (e.g. "tv:pi21:online").
   * ok: true/false. Pushes when it changes; a first sighting pushes only if bad.
   * problem / recovery: { title, body } for each direction.
   */
  async report(key, ok, { problem, recovery, priority = 'high' }) {
    const alerts = await this.loadState();
    const previous = alerts[key];
    const now = ok ? 'ok' : 'bad';
    if (previous?.state === now) return false;
    alerts[key] = { state: now, since: new Date().toISOString(), title: ok ? recovery.title : problem.title };
    await this.saveState();
    if (ok && !previous) return false;  // healthy first sighting is not news
    const message = ok ? recovery : problem;
    return this.push(message.title, message.body, {
      priority: ok ? 'default' : priority,
      tags: ok ? 'white_check_mark' : 'rotating_light'
    });
  }

  // Stop watching something that no longer exists (e.g. a deleted TV)
  async forget(keyPrefix) {
    const alerts = await this.loadState();
    const stale = Object.keys(alerts).filter(key => key.startsWith(keyPrefix));
    if (!stale.length) return;
    stale.forEach(key => delete alerts[key]);
    await this.saveState();
  }
}

module.exports = new NotifyService();
module.exports.asciiHeader = asciiHeader;
module.exports.redact = redact;
