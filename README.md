# Courthouse Digital Signage

Lobby and courtroom signage for the U.S. Bankruptcy Court, District of Utah
(Frank E. Moss US Courthouse). A Node.js **manager** stores everything in
CouchDB and talks to the **TVs**, which are Raspberry Pis running
[`pi-slideshow-rs`](pi-slideshow-rs/), over MQTT. The TVs render to HDMI
themselves, so clocks tick, calendars page and alerts appear even when the
manager is down.

- **Sequences:** what each TV plays, as a looping timeline of images and
  scenes, each with a length and an optional schedule.
- **Scenes:** designed 1920×1080 screens with text, images, colour blocks and
  live tables. Starters include Welcome, Information, Directions, Contacts and
  six calendar scenes (today's calendar, a courtroom docket, a judge's or
  trustee's calendar, a status board and upcoming hearings).
- **Live data:**
  - `{time}`, `{date}` and `{weather}` tokens.
  - The **court calendar**, followed live from a CouchDB hearings database:
    - changes reach the TVs in about 2 seconds;
    - it is marked stale after 35 minutes and hidden after 2 hours if updates stop;
    - cancelled, continued and heard hearings are styled, and the hearing on
      now is highlighted.
- **Overlays and alerts:** a seal or banners above everything a TV plays, and
  three levels of emergency alert above that, with templates, a queue and
  schedules.
- **Operations:**
  - ntfy notifications: a TV offline or stuck, the calendar not updating, a
    backup failed, a TV running a different version.
  - Nightly backups.
  - Canary fleet deploys.
  - A demo tour.

```
 Court hearings DB ──_changes──►  Manager (Node 18, Express)  ──MQTT──►  TVs (Pi 4, pi-slideshow-rs)
 (CouchDB, _design/calendar)        │  web UI :3000                         │  HDMI 1080p, local API :8080
                                    └──────── CouchDB (signage data) ◄──────┘  (TVs read it directly, cache offline)
```

## Requirements

| Part | Needs |
|---|---|
| Manager | Node.js 18+ (or Docker; the image is `node:18-alpine`), about 200 MB RAM |
| Database | CouchDB 3.x, single node (tested on 3.3 and 3.5) |
| Messaging | MQTT broker, e.g. Eclipse Mosquitto 2.x |
| TVs | Raspberry Pi 4 (2 GB+), Raspberry Pi OS Lite 64-bit (bookworm), a 1080p HDMI display, wired network recommended |
| Building the TV app | Rust (stable) with target `aarch64-unknown-linux-musl` and the `gcc-aarch64-linux-gnu` cross linker, on Linux |
| Network | Manager :3000, CouchDB :5984, MQTT :1883, each TV :8080 (manager → TV). Outbound HTTPS to `api.weather.gov` (weather) and your ntfy server (optional) |
| Court calendar (optional) | A CouchDB database of hearing documents, described [below](#court-calendar-hearing-documents). It can be on another CouchDB server. |

## Quick start

### 1. CouchDB, MQTT and the manager

The bundled Compose file starts CouchDB, Mosquitto and the manager. It's
meant for trying the system out: CouchDB's admin is `admin`/`admin`, and
Mosquitto allows anonymous clients. Change both in `docker-compose.yml`
before real use, or run step 4.

```bash
git clone <this repo> && cd pi-signage-fleet
docker compose up -d
```

Or run the manager directly against an existing CouchDB and broker:

```bash
npm ci
cp .env.example .env            # COUCHDB_URL, COUCHDB_USERNAME/PASSWORD, MQTT_BROKER_URL
npm run db:setup                # signage databases and views (the manager also does this on start)
npm start                       # or: npm run dev (restarts on changes)
```

Open `http://<manager>:3000`. On first start the manager creates the starter
scenes and a sequence for each TV.

### 2. The CouchDB schema

The signage databases are created and kept up to date automatically by
`npm run db:setup` and on every manager start:

| Database | Holds |
|---|---|
| `tvs_multilayer` | TVs (name, location, IP, settings) |
| `images_multilayer` | Image Library documents with the files as attachments |
| `layers_multilayer` | sequences, scenes, overlays, data sets (`dataset_court_calendar`, `dataset_weather`), settings |
| `alerts_multilayer`, `alert_templates_multilayer` | emergency alerts, their queue/schedules, and templates |
| `presets_multilayer` | layout templates |
| `signage_multilayer` | reserved |

For a **court hearings database**, one command creates it with the court's
design document (`couchdb/calendar-design.json`):

```bash
npm run db:setup -- --calendar court_calendar            # empty, ready for hearings
npm run db:setup -- --calendar court_calendar --sample   # plus five sample hearings for today
npm run db:setup -- --skip-signage --calendar court_calendar --couchdb https://user:pass@court-couch:6984
```

Then, in the manager: **Scenes → Live Data → Live source**. Enter the database
name, plus a server URL if it's not the manager's CouchDB, and press
**Connect**. Without a live source you can upload a JSON export instead.

### 3. TVs

Flash Raspberry Pi OS Lite (64-bit) with Raspberry Pi Imager: user `pi`, your
SSH key, a hostname, with passwordless sudo (the default for `pi`). Then, from
this repo:

```bash
SIGNAGE_TV_PASSWORD=… scripts/provision-pi.sh 192.168.1.120 --name "Courtroom North Door" --location "3rd floor" --reboot
```

The script does the following:
- installs fonts;
- keeps the console from blanking;
- forces 1080p HDMI;
- registers the TV with the manager;
- installs the current build as the `slideshow` service, with credentials in
  `/etc/signage/slideshow.env`;
- checks the TV reports in.

Assign the new TV a sequence in **TV Management**.

### 4. Lock it down (recommended)

```bash
COUCHDB_ADMIN_URL=http://admin:…@couch:5984 scripts/secure-signage.sh
```

Each step is checked before the next and backed up for rollback:
- **CouchDB:** the manager gets its own account, `signage_manager`, which can
  only manage the signage databases. The TVs get `signage_tv`, which is
  read-only (enforced by `_design/signage_access`).
- **MQTT:** passwords are required, and each TV can only use its own topics.
- **TV control:** play/pause and settings changes are accepted only from the
  manager. Previews stay open.
- **Passwords** are kept in `/etc/signage-secrets.conf` (root, 0600) on the
  Docker host.
- **Other apps:** their databases and the server admin account aren't touched.

## Court calendar: hearing documents

One document per hearing (matter) in the hearings database:

```json
{
  "_id": "hearing:h-20261025-n-0900-3451",
  "type": "hearing",
  "date": "2026-10-25",
  "timezone": "America/Denver",
  "courtroom": "North",
  "start_time": "09:00",
  "judge": "Judge Anderson",
  "case_number": "26-21345",
  "case_title": "In re Savanna G. Smith",
  "matter": "Motion for Relief from Stay",
  "movant": "First Utah Credit Union",
  "trustee": "Chapter 13 Trustee",
  "status": "scheduled",
  "created_at": "2026-10-20T15:02:11Z",
  "updated_at": "2026-10-24T09:30:00Z"
}
```

| Field | Notes |
|---|---|
| `type` | must be `"hearing"`; other documents are ignored |
| `date`, `start_time` | courthouse local time, `YYYY-MM-DD` and 24-hour `HH:MM` |
| `courtroom` | `North` or `South`; tables can be limited to one ("only where courtroom is North") |
| `judge`, `case_number`, `case_title`, `matter`, `movant` | shown as columns; `matter` is labelled "Matter" |
| `trustee` | optional |
| `status` | `scheduled`, `heard`, `continued` or `cancelled`; drives row styling |

`_design/calendar` (`couchdb/calendar-design.json`) provides:

| | Key | Used for |
|---|---|---|
| `by_date_courtroom_time` | `[date, courtroom, start_time, judge, case_number]` | **the signage** reads today through the next 14 days |
| `by_judge_date` | `[judge, date, start_time, courtroom]` | a judge's calendar |
| `by_courtroom_date` | `[courtroom, date, start_time, judge]` | a courtroom's docket |
| `by_case`, `by_movant`, `by_trustee` | `[value, date, start_time]` | lookups |
| `by_status` | `[date, status, courtroom, start_time]` | status board |
| list `nested_calendar` | sessions → slots → judges → cases → matters | one day's calendar as a tree |
| filters `hearings`, `hearings_by_date` | `?date=` | change feeds of hearings, including deletions |

Notes:
- **Deletions:** a deleted document loses its `type`, so the filters start
  with `if (doc._deleted) return true;`. Without it a cancelled-by-deletion
  hearing never shows up in a filtered change feed. The signage follows the
  unfiltered feed either way.
- **List functions** still work in CouchDB 3.x, but are deprecated.
- **Manual uploads** accept hearing documents in any CouchDB shape: an array,
  `_find`, `_all_docs?include_docs=true`, view rows or `nested_calendar`
  output. Similar exports from other systems work too: common field names are
  recognised.

## Using it

| Page | For |
|---|---|
| Dashboard / TV Management | each TV's live screen, what's playing now and next, play/pause, its sequence, the demo tour |
| Sequences | build a TV's loop; drag clips, set lengths and schedules, "show now" and hold |
| Scenes | design screens; Live Data (calendar source, uploads, weather); the calendar table editor (columns, "only where" filter) |
| Layer Control | overlays on a TV, above every clip |
| Alert Templates | emergency alerts and templates |
| System | ntfy notifications, fleet versions, backups |

## Operations

- **Notifications:**
  - Set an ntfy topic URL on the System page, or `NTFY_URL` in `.env`.
  - Pushes happen only when something changes, and recoveries are pushed too.
  - Checks every minute: a TV offline for 5 minutes or more, a playing TV
    stuck on one clip, the live calendar failing for 5 minutes or more, a
    failed backup, a TV on a different version.
- **Backups:**
  - Nightly at 2:15 AM (`BACKUP_SCHEDULE`, `COURT_TIME_ZONE`) to `./backups`,
    keeping the last 7 (`BACKUP_DIR`, `BACKUP_KEEP`). They can be downloaded
    from the System page.
  - Restore with `node scripts/restore-backup.js <file>`. Add `--prefix
    restoretest_` to restore beside the live data and compare first.
- **Updating TVs:** `scripts/deploy-fleet.sh` builds once and updates one TV
  first. If it comes back healthy on the new version, the rest follow;
  otherwise it rolls that TV back.
- **Releases:**
  1. Run `scripts/update-version.sh X.Y.Z`, which updates `package.json`,
     `Cargo.toml` and `app.js`.
  2. Commit, then make an annotated tag `vX.Y.Z`.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `COUCHDB_URL`, `COUCHDB_USERNAME`, `COUCHDB_PASSWORD` | `http://localhost:5984` | signage CouchDB |
| `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | `mqtt://localhost:1883` | broker |
| `PORT` | `3000` | web UI and API |
| `COURT_TIME_ZONE` | `America/Denver` | "today" for calendars and backups |
| `WEATHER_LATITUDE`, `WEATHER_LONGITUDE`, `WEATHER_LOCATION` | the courthouse | NWS forecast for `{weather}` |
| `NTFY_URL` | unset | ntfy topic; otherwise set it on the System page |
| `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_SCHEDULE` | `./backups`, `7`, `15 2 * * *` | nightly backups |
| `TV_HEARTBEAT_TIMEOUT` | `120000` | ms without a heartbeat before a TV shows offline |

A TV reads `SIGNAGE_COUCHDB_USERNAME`, `SIGNAGE_COUCHDB_PASSWORD`,
`SIGNAGE_MQTT_USERNAME`, `SIGNAGE_MQTT_PASSWORD` and `SIGNAGE_HTTP_ALLOW` from
`/etc/signage/slideshow.env`. See `pi-slideshow-rs --help` for the rest.

## Development

```bash
npm test                                   # Jest unit tests
COUCHDB_TEST_URL=http://admin:…@host:5984 npx jest tests/integration/couchdb   # against a real CouchDB
cd pi-slideshow-rs && cargo test           # TV app tests
cd pi-slideshow-rs && ./build.sh           # ARM64 build for the Pi
```

`CLAUDE.md` has the code map, conventions and deployment notes for the homelab
installation. API docs are served at `/api-docs`.

## Troubleshooting

- **A TV shows "Last updated …" or "temporarily unavailable":** the calendar
  source isn't being checked. See **System** (the court calendar check) and
  **Scenes → Live Data**.
- **A TV is offline:** run `ssh pi@<tv> journalctl -u slideshow -n 50`. It
  keeps playing its cached sequence while the manager or network is away.
- **Play/pause from the browser does nothing:** commands go through the
  manager over MQTT. Check the manager's MQTT credentials after running
  `secure-signage.sh`.
- **Emoji:** TV text supports colour emoji, but avoid multi-part emoji such as
  👨‍⚖️, which the TV draws as separate symbols.
