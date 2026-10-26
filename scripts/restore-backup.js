#!/usr/bin/env node
// Restore a signage backup (backups/signage-YYYYMMDD-HHMMSS.json.gz) into CouchDB.
//
//   node scripts/restore-backup.js <backup.json.gz> [options]
//
//   --couchdb <url>     CouchDB to restore into (default: COUCHDB_URL with
//                       COUCHDB_USERNAME/COUCHDB_PASSWORD, as the manager uses)
//   --prefix <text>     restore each database under a new name, e.g.
//                       --prefix restoretest_ gives restoretest_tvs_multilayer
//   --db <name>         only this database (repeatable)
//   --force             write into databases that already hold documents
//   --list              show what the backup holds and stop
//
// Documents keep their revisions and attachments (bulk_docs with new_edits=false),
// so TVs that cached them see the same documents. Without --force, a database that
// already has documents is skipped: restore a live system by stopping the manager,
// deleting the damaged databases, then restoring.
const fs = require('fs');
const zlib = require('zlib');

function parseArgs(argv) {
  const args = { dbs: [], prefix: '', force: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--couchdb') args.couchdb = argv[++i];
    else if (arg === '--prefix') args.prefix = argv[++i];
    else if (arg === '--db') args.dbs.push(argv[++i]);
    else if (arg === '--force') args.force = true;
    else if (arg === '--list') args.list = true;
    else if (!args.file) args.file = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!args.file) throw new Error('Usage: restore-backup.js <backup.json.gz> [--couchdb url] [--prefix p] [--db name] [--force] [--list]');
  return args;
}

function couchUrl(explicit) {
  const url = new URL(explicit || process.env.COUCHDB_URL || 'http://localhost:5984');
  if (!url.username && process.env.COUCHDB_USERNAME) {
    url.username = process.env.COUCHDB_USERNAME;
    url.password = process.env.COUCHDB_PASSWORD || '';
  }
  const headers = { 'Content-Type': 'application/json' };
  if (url.username) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  return { base: url.origin, headers };
}

async function request(couch, method, path, body) {
  const response = await fetch(`${couch.base}${path}`, { method, headers: couch.headers, body: body && JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function restore(args) {
  const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(args.file)).toString('utf8'));
  const names = Object.keys(backup.databases).filter(db => !args.dbs.length || args.dbs.includes(db));
  console.log(`Backup ${args.file}: made ${backup.created_at} by manager ${backup.manager_version}`);
  for (const db of names) console.log(`  ${db}: ${backup.databases[db].rows.length} documents`);
  if (args.list) return { restored: [] };

  const couch = couchUrl(args.couchdb);
  const restored = [];
  for (const db of names) {
    const target = `${args.prefix}${db}`;
    const docs = backup.databases[db].rows.map(row => row.doc).filter(Boolean);
    const info = await request(couch, 'GET', `/${encodeURIComponent(target)}`);
    if (info.status === 404) {
      const created = await request(couch, 'PUT', `/${encodeURIComponent(target)}`);
      if (created.status >= 300) throw new Error(`Can't create ${target}: ${created.json.reason || created.status}`);
    } else if (info.json.doc_count > 0 && !args.force) {
      console.log(`  skip ${target}: already has ${info.json.doc_count} documents (use --force)`);
      continue;
    }
    // Small batches: image documents carry their files
    let written = 0;
    for (let i = 0; i < docs.length; i += 20) {
      const batch = docs.slice(i, i + 20);
      const result = await request(couch, 'POST', `/${encodeURIComponent(target)}/_bulk_docs`, { docs: batch, new_edits: false });
      if (result.status >= 300) throw new Error(`${target}: ${result.json.reason || result.status}`);
      const failed = (result.json || []).filter(r => r.error);
      if (failed.length) throw new Error(`${target}: ${failed.length} document(s) failed, e.g. ${failed[0].id}: ${failed[0].reason}`);
      written += batch.length;
    }
    console.log(`  restored ${target}: ${written} documents`);
    restored.push({ db, target, documents: written });
  }
  return { restored };
}

if (require.main === module) {
  restore(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(`Restore failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { restore, parseArgs };
