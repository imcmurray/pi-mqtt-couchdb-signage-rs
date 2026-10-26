#!/usr/bin/env node
// Set up CouchDB for the signage. Safe to run again.
//
//   npm run db:setup                                   signage databases + views
//   npm run db:setup -- --calendar court_calendar      a court hearings database
//   npm run db:setup -- --calendar court_calendar --sample   … with today's sample hearings
//
// Options:
//   --calendar <db>   create <db> (if needed) with the court's _design/calendar
//                     (couchdb/calendar-design.json): views, nested_calendar list
//                     and change filters. Hearing documents are described in README.md.
//   --sample          add five sample hearings dated today (North and South courtrooms)
//   --couchdb <url>   CouchDB for --calendar (default: the manager's, from .env:
//                     COUCHDB_URL + COUCHDB_USERNAME/COUCHDB_PASSWORD)
//   --skip-signage    only do --calendar
// The manager also creates its own databases on start; this lets you prepare a
// server before the first start, or check one. For per-service accounts see
// scripts/secure-signage.sh.
const fs = require('fs');
const path = require('path');
const config = require('../src/config/multilayer.config');
const { sampleCalendar } = require('../src/utils/calendarImport');
const { connection } = require('../src/services/calendarSourceService');

function parseArgs(argv) {
  const args = { sample: false, skipSignage: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--calendar') args.calendar = argv[++i];
    else if (argv[i] === '--sample') args.sample = true;
    else if (argv[i] === '--couchdb') args.couchdb = argv[++i];
    else if (argv[i] === '--skip-signage') args.skipSignage = true;
    else throw new Error(`Unknown option ${argv[i]} (see the top of scripts/setup-couchdb.js)`);
  }
  if (args.sample && !args.calendar) throw new Error('--sample needs --calendar <db>');
  return args;
}

async function setupSignage() {
  const { initializeMultilayerDatabases } = require('../src/config/multilayer.database');
  const databases = await initializeMultilayerDatabases();
  console.log(`✓ signage databases ready: ${Object.values(config.database.databases).join(', ')} (${Object.keys(databases).length})`);
}

async function setupCalendar({ calendar, sample, couchdb }) {
  const conn = connection(couchdb || config.getDatabaseUrl(), calendar);
  const request = async (method, suffix = '', body) => {
    const response = await fetch(`${conn.base}${suffix}`, {
      method,
      headers: { ...conn.headers, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    if (response.status >= 400 && response.status !== 404) {
      throw new Error(`${method} ${calendar}${suffix}: ${response.status} ${json.reason || json.error || ''}`);
    }
    return { status: response.status, json };
  };

  if ((await request('GET')).status === 404) {
    await request('PUT');
    console.log(`✓ created ${calendar}`);
  }
  const design = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'couchdb', 'calendar-design.json'), 'utf8'));
  const existing = await request('GET', `/${design._id}`);
  if (existing.status === 200) design._rev = existing.json._rev;
  await request('PUT', `/${design._id}`, design);
  console.log(`✓ ${calendar}/${design._id}: views ${Object.keys(design.views).join(', ')}`);

  if (sample) {
    const docs = sampleCalendar();
    const result = await request('POST', '/_bulk_docs', { docs });
    const added = result.json.filter(r => r.ok).length;
    console.log(`✓ ${added} sample hearing(s) for ${docs[0].date}${added < docs.length ? ` (${docs.length - added} already there)` : ''}`);
  }
  console.log(`  Follow it from the manager: Scenes → Live Data → Live source → "${calendar}"`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipSignage) await setupSignage();
  if (args.calendar) await setupCalendar(args);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Setup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
