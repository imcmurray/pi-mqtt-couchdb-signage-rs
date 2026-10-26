# Courthouse Digital Signage (pi-signage-fleet)

Signage for the Frank E. Moss US Courthouse (U.S. Bankruptcy Court, District of
Utah): a Node manager and Raspberry Pi TVs running `pi-slideshow-rs`. Courtrooms
are **North** and **South** only.

## How it works

- **Sequences** (`sequence_<uuid>` in `layers_multilayer`) are what a TV plays: a
  loop of clips, each an Image Library image or a **scene**, with durations and
  optional schedules. A TV plays exactly one sequence.
- **Scenes** (`scene_<uuid>`) are designed 1920×1080 screens: text with
  `{tokens}`, images, colour blocks and **table** elements. The Pi renders them
  live, so clocks tick and tables page.
- **Overlays** (Layer Control) sit above every clip on a TV (seal, banners).
  **Alerts** sit above everything.
- **Data sets** (`dataset_<id>`) feed live content:
  - `weather` (NWS, every 15 minutes) fills `{weather} {temp} {conditions}
    {weather_icon} {location}`.
  - `court_calendar` feeds calendar tables.
  - The Pi reads data sets on each `sync_layers` and keeps them offline.
- **Court calendar**: `calendarSourceService` follows a CouchDB database of court
  hearing documents (`type: "hearing"`, `_design/calendar`). It works like this:
  - It reads `by_date_courtroom_time` for today through the next 14 days, and
    follows the *unfiltered* `_changes` feed (deletions have no `type`).
  - It stamps `checked_at`; TVs show "Last updated…" after 35 minutes and hide
    the calendar after 2 hours.
  - Uploads accept docs, `_find`, `_all_docs`, view rows and `nested_calendar`
    (`src/utils/calendarImport.js`).
  - Table rows are styled by status: cancelled is struck through, continued is
    amber, heard drops off after an hour, and the hearing on now is highlighted.
- **CouchDB** stores everything. **MQTT** carries commands and status
  (`signage/tv/<id>/{command,alerts,status,heartbeat,image/current}`).

## Code map

- `src/services/`:
  - `sequenceService`, `sceneService`, `datasetService`
  - `calendarSourceService`, `weatherService`
  - `alert*Service`, `demoService` (guided tour)
  - `notifyService` (ntfy), `monitorService` (fleet checks), `backupService`
  - `multilayer.mqttService` (live TV state; it also notes when each TV's
    clip last changed)
- `src/utils/`:
  - `calendarImport.js`: normalises hearings.
  - `layerSchema.js`: the shared layer/element Joi schema.
  - `clipSchedule.js`
- `src/config/courthousePresets.js`: the starter scenes, including one
  calendar scene per CouchDB view (`calendarScene()`).
- `public/js/`:
  - `app.js`: dashboard, TV cards and their sequence strips.
  - `sequences.js`: timeline editor.
  - `multilayer.js`: the scene/overlay editor, table editor and Live Data.
  - `system.js`: the System page.
- `pi-slideshow-rs/src/`:
  - `slideshow_controller.rs`: sequences, sync and cache.
  - `layer_manager.rs`: compositing and tables.
  - `layer_data.rs`: tokens, table rows, staleness and status styles.
  - `http_server.rs`: the local API; control only from `SIGNAGE_HTTP_ALLOW`.
  - `mqtt_client.rs`
- `scripts/`:
  - `deploy-fleet.sh`: canary rollout with rollback.
  - `provision-pi.sh`: new TV from a fresh Pi OS Lite image.
  - `secure-signage.sh` and `secure-couchdb.js`: per-service accounts.
  - `restore-backup.js`
  - `update-version.sh`

## Commands

- `npm test`: Jest, with `resetMocks: true`.
  - CouchDB integration tests only run with
    `COUCHDB_TEST_URL=http://admin:…@host:5984 npx jest tests/integration/couchdb`.
- `cd pi-slideshow-rs && cargo test`
- `cd pi-slideshow-rs && ./build.sh`: aarch64 musl build. Only build the Pi app
  inside `pi-slideshow-rs/`.

## Deploying (homelab)

- **Manager** on dockge1 (`192.168.1.215:3000`, the `/opt/stacks/digsig-manager`
  stack mounted as `/app`, nodemon restarts on `.js` changes):

  ```
  tar cf - <files> | ssh dockge215 'docker run --rm -i -v /opt/stacks/digsig-manager:/w node:18-alpine tar xf - -C /w --no-same-owner'
  ```

  Then wait for `/health`. Never use Dockge's Update button on this stack.
- **TVs**: run `scripts/deploy-fleet.sh`. It builds once, updates a canary
  first, checks health and version, and rolls a TV back if it fails. pi21
  (`192.168.1.114`) is the dev TV.
- **New TV**: run `scripts/provision-pi.sh <ip> --name … --location …`.
- **Fleet versions**: the System page shows each TV's version, and the
  manager's ntfy pushes when one differs.

## Releases

1. Run `scripts/update-version.sh X.Y.Z`. It updates `package.json`,
   `Cargo.toml` and `app.js`.
2. Write `src/version.json` for `vX.Y.Z`.
3. Commit with `--no-verify`, because the pre-commit hook resets `package.json`
   to the latest tag until the new tag exists.
4. Make an annotated tag `vX.Y.Z` and push it.

## Operations

- **Notifications** use ntfy, with the same rules as the homelab's
  cluster-health-alert and Overseer:
  - push on state change only, recoveries too, and never for successes;
  - set the topic with `NTFY_URL` or on the System page;
  - checks: TV offline 5+ minutes, TV stuck on one clip, calendar source
    failing 5+ minutes, backup failed, TV version mismatch.
- **Backups**: nightly at 2:15 AM Denver time to `/opt/stacks/digsig-manager/backups`
  (owned by uid 1001, mode 700). The newest 7 are kept, all signage databases
  are included, with attachments. Restore with
  `node scripts/restore-backup.js <file> [--prefix restoretest_]`.
- **Security**:
  - The CouchDB on dockge1 is **shared with other apps**. Never change its
    admin account.
  - `scripts/secure-signage.sh` moves the signage to `signage_manager` and
    `signage_tv` (read-only, enforced by `_design/signage_access`), with
    passwords in `/etc/signage-secrets.conf` on the host. It also enables
    MQTT passwords with per-TV topic ACLs.
  - TVs read credentials from `/etc/signage/slideshow.env`.

## Conventions

- Don't duplicate functions under new names; extend the existing one.
- Courthouse time is `America/Denver` (`COURT_TIME_ZONE`); the server runs in
  UTC, so use `courthouseToday()`.
- Emoji on the TV:
  - TV text uses bundled Noto Color Emoji, but avoid ZWJ sequences (👨‍⚖️
    splits apart).
  - Table cells have no emoji fallback.
