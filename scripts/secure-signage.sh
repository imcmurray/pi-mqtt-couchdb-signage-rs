#!/bin/bash
# Move the signage off shared admin credentials and lock down MQTT and the TVs'
# HTTP control, in an order that keeps everything running at each step.
#
#   COUCHDB_ADMIN_URL=http://admin:…@192.168.1.215:5984 scripts/secure-signage.sh [--host dockge215] [--step N]
#
# Run from a machine with SSH to the Docker host (docker group) and to each TV as
# pi (passwordless sudo). Steps (each is safe to re-run; --step N starts at N):
#   1  passwords for the signage accounts in /etc/signage-secrets.conf on the
#      host (root, 0600); existing ones are kept
#   2  CouchDB accounts signage_manager / signage_tv and per-database security
#      (scripts/secure-couchdb.js); other apps' databases and the admin account
#      are untouched
#   3  the manager uses signage_manager for CouchDB and MQTT (stack .env, backed
#      up first), restarted and checked
#   4  each TV gets /etc/signage/slideshow.env (CouchDB signage_tv, MQTT
#      signage_tv, HTTP control only from the manager) and the new service, and
#      must come back healthy
#   5  mosquitto requires a password (signage_manager, signage_tv limited to its
#      own topics, signage_viewer read-only for MQTT Explorer); conf backed up
# Roll back step 5 by restoring /opt/MQTT/mosquitto/config/mosquitto.conf.bak-* and
# restarting mosquitto; step 3 by restoring the stack's .env.bak-*.
set -euo pipefail

HOST="dockge215"
STACK="/opt/stacks/digsig-manager"
MQTT_CONF_DIR="/opt/MQTT/mosquitto/config"
SERVER_IP="192.168.1.215"
MANAGER="http://$SERVER_IP:3000"
START=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --host) HOST="$2"; shift 2 ;;
        --step) START="$2"; shift 2 ;;
        -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done
[[ -z "${COUCHDB_ADMIN_URL:-}" && "$START" -le 2 ]] && { echo "Set COUCHDB_ADMIN_URL (server admin, for step 2)" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
on_host() { ssh -o BatchMode=yes "$HOST" "$@"; }
step() { [[ "$1" -ge "$START" ]]; }

wait_healthy() {
    for _ in $(seq 1 30); do
        sleep 2
        curl -fsS --max-time 3 "$MANAGER/health" >/dev/null 2>&1 && return 0
    done
    return 1
}

if step 1; then
    echo "== 1. Signage passwords on $HOST"
    on_host 'docker run --rm -v /etc:/e alpine sh -c '\''
        umask 077; f=/e/signage-secrets.conf; touch $f
        gen() { head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32; }
        for name in SIGNAGE_MANAGER_PASSWORD SIGNAGE_TV_PASSWORD SIGNAGE_MQTT_MANAGER_PASSWORD SIGNAGE_MQTT_TV_PASSWORD SIGNAGE_MQTT_VIEWER_PASSWORD; do
            grep -q "^$name=" $f || echo "$name=$(gen)" >> $f
        done
        chmod 600 $f; echo "   /etc/signage-secrets.conf: $(grep -c = $f) passwords"'\'''
fi

if step 2; then
    echo "== 2. CouchDB accounts and database security"
    tar cf - -C "$ROOT" scripts/secure-couchdb.js | on_host "docker run --rm -i -v $STACK:/w node:18-alpine tar xf - -C /w --no-same-owner"
    printf '%s' "$COUCHDB_ADMIN_URL" | on_host "docker run --rm -i -v $STACK:/app:ro -v /etc/signage-secrets.conf:/s.conf:ro -w /app node:18-alpine sh -c '
        read -r ADMIN_URL; set -a; . /s.conf; set +a
        node scripts/secure-couchdb.js --couchdb \"\$ADMIN_URL\" --extra-db court_calendar'"
fi

if step 3; then
    echo "== 3. Manager uses its own accounts"
    on_host "docker run --rm -v $STACK:/w -v /etc/signage-secrets.conf:/s.conf:ro alpine sh -c '
        . /s.conf; cd /w; cp -p .env .env.bak-$STAMP; chmod 600 .env.bak-$STAMP
        set_var() { grep -q \"^\$1=\" .env && sed -i \"s|^\$1=.*|\$1=\$2|\" .env || echo \"\$1=\$2\" >> .env; }
        set_var COUCHDB_USERNAME signage_manager
        set_var COUCHDB_PASSWORD \"\$SIGNAGE_MANAGER_PASSWORD\"
        set_var MQTT_USERNAME signage_manager
        set_var MQTT_PASSWORD \"\$SIGNAGE_MQTT_MANAGER_PASSWORD\"
        chmod 600 .env; chown 1001 .env'"
    on_host 'docker restart digital-signage-management >/dev/null'
    wait_healthy || { echo "Manager did not come back: restore $STACK/.env.bak-$STAMP and restart it" >&2; exit 1; }
    curl -fsS "$MANAGER/api/tvs" >/dev/null || { echo "Manager can't read CouchDB as signage_manager" >&2; exit 1; }
    echo "   manager healthy on signage_manager"
fi

if step 4; then
    echo "== 4. TVs use signage_tv and accept control only from the manager"
    mapfile -t TVS < <(curl -fsS "$MANAGER/api/system/fleet" | node -e '
        let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
            for (const tv of JSON.parse(s).tvs) console.log(tv.ip_address, tv.tv_id.replace(/^tv_/, ""), tv.status);
        });')
    for line in "${TVS[@]}"; do
        read -r ip id status <<<"$line"
        if [[ "$status" != "online" ]]; then echo "   $ip: offline, skipped (run --step 4 again later)"; continue; fi
        on_host 'docker run --rm -v /etc/signage-secrets.conf:/s.conf:ro alpine sh -c ". /s.conf; printf \"SIGNAGE_COUCHDB_USERNAME=signage_tv\nSIGNAGE_COUCHDB_PASSWORD=%s\nSIGNAGE_MQTT_USERNAME=signage_tv\nSIGNAGE_MQTT_PASSWORD=%s\nSIGNAGE_HTTP_ALLOW='"$SERVER_IP"'\n\" \"\$SIGNAGE_TV_PASSWORD\" \"\$SIGNAGE_MQTT_TV_PASSWORD\""' \
            | ssh -o BatchMode=yes "pi@$ip" 'sudo install -d -m 755 /etc/signage && sudo tee /etc/signage/slideshow.env >/dev/null && sudo chmod 600 /etc/signage/slideshow.env'
        sed "s|@TV_ID@|$id|; s|@SERVER@|$SERVER_IP|g" "$ROOT/pi-slideshow-rs/slideshow.service" \
            | ssh -o BatchMode=yes "pi@$ip" 'sudo cp /etc/systemd/system/slideshow.service /etc/systemd/system/slideshow.service.bak-'"$STAMP"' 2>/dev/null || true
                sudo tee /etc/systemd/system/slideshow.service >/dev/null && sudo systemctl daemon-reload && sudo systemctl restart slideshow'
        ok=false
        for _ in $(seq 1 20); do
            sleep 3
            if ssh -o BatchMode=yes "pi@$ip" 'journalctl -u slideshow --since "-2min" --no-pager | grep -q "Loaded data set\|Synced"'; then ok=true; break; fi
        done
        $ok || { echo "   $ip did not load its data as signage_tv; old service kept as slideshow.service.bak-$STAMP" >&2; exit 1; }
        code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://$ip:8080/api/control" -H 'Content-Type: application/json' -d '{"action":"status"}')"
        echo "   $ip: reading as signage_tv; control from here answers $code (403 expected)"
    done
fi

if step 5; then
    echo "== 5. MQTT requires a password"
    on_host "docker exec mosquitto sh -c '
        cd /mosquitto/config && cp -p mosquitto.conf mosquitto.conf.bak-$STAMP
        printf \"user signage_manager\ntopic readwrite signage/#\n\nuser signage_tv\npattern readwrite signage/tv/%%c/#\n\nuser signage_viewer\ntopic read signage/#\n\" > signage.acl'"
    on_host 'docker run --rm -v /etc/signage-secrets.conf:/s.conf:ro alpine sh -c ". /s.conf; printf \"signage_manager %s\nsignage_tv %s\nsignage_viewer %s\n\" \"\$SIGNAGE_MQTT_MANAGER_PASSWORD\" \"\$SIGNAGE_MQTT_TV_PASSWORD\" \"\$SIGNAGE_MQTT_VIEWER_PASSWORD\"" \
        | docker exec -i mosquitto sh -c '\''cd /mosquitto/config && : > signage.passwd && chmod 600 signage.passwd
            while read -r user pass; do mosquitto_passwd -b signage.passwd "$user" "$pass"; done
            chown mosquitto signage.passwd signage.acl 2>/dev/null || true
            sed -i "s/^allow_anonymous .*/allow_anonymous false/" mosquitto.conf
            grep -q "^password_file" mosquitto.conf || echo "password_file /mosquitto/config/signage.passwd" >> mosquitto.conf
            grep -q "^acl_file" mosquitto.conf || echo "acl_file /mosquitto/config/signage.acl" >> mosquitto.conf'\'''
    on_host 'docker restart mosquitto >/dev/null'
    sleep 20
    online="$(curl -fsS "$MANAGER/api/system/fleet" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).tvs;console.log(`${t.filter(x=>x.status==="online").length}/${t.length}`)})')"
    echo "   TVs online after the broker restart: $online"
    echo "   MQTT Explorer: user signage_viewer, password SIGNAGE_MQTT_VIEWER_PASSWORD in /etc/signage-secrets.conf on $HOST"
fi
echo "Done."
