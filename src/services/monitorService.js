const TV = require('../models/tv.multilayer');
const mqttService = require('./multilayer.mqttService');
const notifyService = require('./notifyService');
const calendarSourceService = require('./calendarSourceService');
const sequenceService = require('./sequenceService');
const { version: MANAGER_VERSION } = require('../../package.json');

// Watches the fleet once a minute and reports to notifyService, which pushes
// only when something changes. Checks:
//  * a TV that has reported before goes quiet for OFFLINE_MS
//  * an online, playing TV stays on one clip far longer than its sequence allows
//  * the live calendar source stays in error for SOURCE_GRACE_MS
//  * a TV runs a different version from the manager
const CHECK_MS = 60 * 1000;
const OFFLINE_MS = 5 * 60 * 1000;
const SOURCE_GRACE_MS = 5 * 60 * 1000;
const FROZEN_MIN_MS = 5 * 60 * 1000;
const VERSION_TIMEOUT_MS = 5000;

const label = tv => tv.name || tv._id;

class MonitorService {
  constructor() {
    this.timer = null;
    this.sourceErrorSince = null;
    this.versions = new Map(); // tv id -> { version, commit_short, checked_at } | { error }
    this.running = false;
  }

  start() {
    if (this.timer) return;
    // Give TVs a minute to check in after a manager restart before judging them
    this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    if (this.running) return;
    this.running = true;
    try {
      const tvs = (await TV.findAll()).map(tv => mqttService.applyLiveState(tv));
      const sequences = await sequenceService.list();
      await this.refreshVersions(tvs);
      for (const tv of tvs) await this.checkTv(tv, sequences);
      await this.checkCalendarSource();
    } catch (error) {
      console.error('Monitor check failed:', error.message);
    } finally {
      this.running = false;
    }
  }

  async checkTv(tv, sequences) {
    // A TV that has never reported is not deployed yet; nothing to say about it
    if (!tv.last_heartbeat) return;
    const silentFor = Date.now() - Date.parse(tv.last_heartbeat);
    const online = silentFor < OFFLINE_MS;
    await notifyService.report(`tv:${tv._id}:online`, online, {
      label: `${label(tv)} online`,
      problem: { title: `Signage: ${label(tv)} is offline`, body: `No word from ${label(tv)} (${tv.ip_address || 'no IP'}) since ${new Date(tv.last_heartbeat).toLocaleString('en-US', { timeZone: 'America/Denver' })}.` },
      recovery: { title: `Signage: ${label(tv)} is back online`, body: `${label(tv)} is reporting again.` }
    });
    if (!online) return;

    const frozenMs = this.frozenFor(tv, sequences);
    await notifyService.report(`tv:${tv._id}:playing`, frozenMs === 0, {
      label: `${label(tv)} changing clips`,
      problem: { title: `Signage: ${label(tv)} looks stuck`, body: `${label(tv)} is online and playing but has shown the same clip for ${Math.round(frozenMs / 60000)} minutes. The screen may be frozen.` },
      recovery: { title: `Signage: ${label(tv)} is changing clips again`, body: `${label(tv)} moved on to the next clip.` }
    });

    const version = this.versions.get(tv._id);
    if (version?.version) {
      const matches = version.version === MANAGER_VERSION;
      await notifyService.report(`tv:${tv._id}:version`, matches, {
        label: `${label(tv)} on the manager's version`,
        problem: { title: `Signage: ${label(tv)} runs a different version`, body: `${label(tv)} runs ${version.version}; the manager is ${MANAGER_VERSION}. Run scripts/deploy-fleet.sh.` },
        recovery: { title: `Signage: ${label(tv)} is up to date`, body: `${label(tv)} now runs ${version.version}.` },
        priority: 'default'
      });
    }
  }

  // How long a playing TV has overstayed on one clip (0 = fine). Only for
  // sequences with two or more clips; a hold pauses the TV, which is fine.
  // Only a TV whose heartbeat is current (status 'online') counts: one that has
  // just gone quiet isn't stuck, it's on its way to being reported offline.
  frozenFor(tv, sequences) {
    const live = mqttService.liveState.get(tv._id);
    if (tv.status !== 'online' || !live?.clip_changed_at || !live.current_clip || tv.slideshow_state !== 'playing') return 0;
    const sequence = sequences.find(s => (s.tv_ids || []).includes(tv._id));
    const clips = (sequence?.clips || []).filter(clip => clip.enabled !== false);
    if (clips.length < 2) return 0;
    const longest = Math.max(...clips.map(clip => clip.duration_ms || 0));
    const allowed = Math.max(3 * longest, FROZEN_MIN_MS);
    const stuck = Date.now() - Date.parse(live.clip_changed_at);
    return stuck > allowed ? stuck : 0;
  }

  async checkCalendarSource() {
    const source = calendarSourceService.publicStatus();
    if (!source.connected) {
      this.sourceErrorSince = null;
      return;
    }
    if (source.state === 'error') this.sourceErrorSince = this.sourceErrorSince || Date.now();
    else this.sourceErrorSince = null;
    const failing = this.sourceErrorSince && Date.now() - this.sourceErrorSince >= SOURCE_GRACE_MS;
    await notifyService.report('calendar:source', !failing, {
      label: 'Court calendar updating',
      problem: { title: 'Signage: court calendar is not updating', body: `The live calendar (${source.database}) has failed for over 5 minutes: ${source.error}\nTVs show "Last updated" after 35 minutes and hide the calendar after 2 hours.` },
      recovery: { title: 'Signage: court calendar is updating again', body: `The live calendar (${source.database}) is back: ${source.hearings} hearing(s).` }
    });
  }

  // Each online TV's pi-slideshow-rs version (its local HTTP API)
  async refreshVersions(tvs) {
    await Promise.all(tvs.filter(tv => tv.status === 'online' && tv.ip_address).map(async tv => {
      try {
        const response = await fetch(`http://${tv.ip_address}:8080/api/version`, { signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
        const { data } = await response.json();
        this.versions.set(tv._id, { version: data.version, commit_short: data.commit_short, checked_at: new Date().toISOString() });
      } catch (error) {
        this.versions.set(tv._id, { error: error.message, checked_at: new Date().toISOString() });
      }
    }));
  }

  // For the System page and TV cards
  async fleet() {
    const tvs = (await TV.findAll()).map(tv => mqttService.applyLiveState(tv));
    if (![...this.versions.values()].length) await this.refreshVersions(tvs);
    return {
      manager_version: MANAGER_VERSION,
      tvs: tvs.map(tv => {
        const version = this.versions.get(tv._id) || {};
        return {
          tv_id: tv._id,
          name: tv.name,
          ip_address: tv.ip_address,
          status: tv.status,
          last_heartbeat: tv.last_heartbeat,
          version: version.version || null,
          commit_short: version.commit_short || null,
          version_error: version.error || null,
          up_to_date: version.version ? version.version === MANAGER_VERSION : null
        };
      })
    };
  }
}

module.exports = new MonitorService();
module.exports.MANAGER_VERSION = MANAGER_VERSION;
