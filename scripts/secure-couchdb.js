#!/usr/bin/env node
// Give the signage its own CouchDB accounts instead of the server admin, which
// other apps on the same CouchDB also use. Safe to run again.
//
//   SIGNAGE_MANAGER_PASSWORD=… SIGNAGE_TV_PASSWORD=… \
//     node scripts/secure-couchdb.js --couchdb http://admin:…@host:5984 [--extra-db court_calendar]
//
// Creates (or re-passwords):
//   signage_manager  role signage_manager: admin of the signage databases
//                    (documents and design documents, no server-wide rights)
//   signage_tv       role signage_tv: reads the signage databases; every write
//                    is refused by _design/signage_access
// and sets each signage database's _security so nobody else (other than server
// admins) can read it. --extra-db adds read access for the manager to another
// database, e.g. a court hearings database on the same server.
// Passwords come from the environment so they never appear in argv.
const SIGNAGE_DATABASES = [
  'signage_multilayer', 'tvs_multilayer', 'images_multilayer', 'layers_multilayer',
  'alert_templates_multilayer', 'presets_multilayer', 'alerts_multilayer'
];

const ACCESS_DESIGN = {
  _id: '_design/signage_access',
  language: 'javascript',
  // TVs only read; a leaked TV password can't change what other TVs show
  validate_doc_update: `function (newDoc, oldDoc, userCtx) {
    var roles = userCtx.roles || [];
    if (roles.indexOf('_admin') === -1 && roles.indexOf('signage_manager') === -1) {
      throw({ forbidden: 'Only the signage manager can change signage data' });
    }
  }`
};

function parseArgs(argv) {
  const args = { extraDbs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--couchdb') args.couchdb = argv[++i];
    else if (argv[i] === '--extra-db') args.extraDbs.push(argv[++i]);
    else throw new Error(`Unexpected argument ${argv[i]}`);
  }
  if (!args.couchdb) throw new Error('--couchdb http://admin:password@host:5984 is required');
  return args;
}

function connect(urlText) {
  const url = new URL(urlText);
  const headers = { 'Content-Type': 'application/json' };
  if (url.username) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
  }
  return async (method, path, body) => {
    const response = await fetch(`${url.origin}${path}`, { method, headers, body: body && JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (response.status >= 400 && response.status !== 404) {
      throw new Error(`${method} ${path}: ${response.status} ${json.reason || json.error || ''}`);
    }
    return { status: response.status, json };
  };
}

async function upsert(request, path, doc) {
  const existing = await request('GET', path);
  const body = existing.status === 200 ? { ...existing.json, ...doc, _rev: existing.json._rev } : doc;
  await request('PUT', path, body);
}

async function secure({ couchdb, extraDbs }, passwords) {
  const request = connect(couchdb);
  const session = await request('GET', '/_session');
  if (!session.json.userCtx?.roles?.includes('_admin')) throw new Error('Run this with a server admin account');

  for (const [name, role] of [['signage_manager', 'signage_manager'], ['signage_tv', 'signage_tv']]) {
    const password = passwords[name];
    if (!password || password.length < 16) throw new Error(`Set a password of 16+ characters for ${name}`);
    await upsert(request, `/_users/org.couchdb.user:${name}`, { name, type: 'user', roles: [role], password });
    console.log(`account ${name} ready`);
  }

  for (const db of SIGNAGE_DATABASES) {
    if ((await request('GET', `/${db}`)).status === 404) {
      await request('PUT', `/${db}`);
      console.log(`created ${db}`);
    }
    await request('PUT', `/${db}/_security`, {
      admins: { names: [], roles: ['signage_manager'] },
      members: { names: [], roles: ['signage_manager', 'signage_tv'] }
    });
    await upsert(request, `/${db}/${ACCESS_DESIGN._id}`, ACCESS_DESIGN);
    console.log(`secured ${db}`);
  }

  for (const db of extraDbs) {
    const current = (await request('GET', `/${db}/_security`)).json || {};
    const members = current.members || { names: [], roles: [] };
    if (!(members.roles || []).includes('signage_manager')) {
      members.roles = [...(members.roles || []), 'signage_manager'];
      await request('PUT', `/${db}/_security`, { ...current, members });
    }
    console.log(`signage_manager can read ${db}`);
  }
}

if (require.main === module) {
  secure(parseArgs(process.argv.slice(2)), {
    signage_manager: process.env.SIGNAGE_MANAGER_PASSWORD,
    signage_tv: process.env.SIGNAGE_TV_PASSWORD
  }).catch(error => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { secure, SIGNAGE_DATABASES, ACCESS_DESIGN };
