#!/bin/bash
# Turn a freshly imaged Raspberry Pi into a signage TV, the same way pi21 is set up.
#
#   scripts/provision-pi.sh <pi-ip> --name "Courtroom North Door" --location "3rd floor" \
#       [--manager http://192.168.1.215:3000] [--server 192.168.1.215] [--reboot]
#
# Before: flash Raspberry Pi OS Lite (64-bit, bookworm) with Raspberry Pi Imager,
# user "pi", your SSH key, and the hostname you want; boot it on the network.
# Credentials are read from the environment, never typed into argv:
#   SIGNAGE_TV_PASSWORD     CouchDB password for signage_tv (scripts/secure-couchdb.js)
#   SIGNAGE_MQTT_PASSWORD   MQTT password for signage_tv (optional while the broker
#                           still allows anonymous clients)
# It installs fonts, keeps the console from blanking, forces 1080p HDMI, registers
# the TV with the manager (or reuses its record by IP), installs the current build
# and its service with credentials in /etc/signage/slideshow.env (root, 0600).
# Safe to run again on the same Pi.
set -euo pipefail

PI_IP="${1:-}"; shift || true
NAME=""; LOCATION=""; REBOOT=false
MANAGER="${SIGNAGE_MANAGER:-http://192.168.1.215:3000}"
SERVER="192.168.1.215"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --name) NAME="$2"; shift 2 ;;
        --location) LOCATION="$2"; shift 2 ;;
        --manager) MANAGER="$2"; shift 2 ;;
        --server) SERVER="$2"; shift 2 ;;
        --reboot) REBOOT=true; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done
[[ -z "$PI_IP" || -z "$NAME" || -z "$LOCATION" ]] && { sed -n '2,17p' "$0"; exit 1; }
[[ -z "${SIGNAGE_TV_PASSWORD:-}" ]] && { echo "Set SIGNAGE_TV_PASSWORD (the signage_tv CouchDB password)" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="$ROOT/pi-slideshow-rs/target/aarch64-unknown-linux-musl/release/pi-slideshow-rs"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "pi@$PI_IP")

echo "1/6 Checking SSH and sudo on $PI_IP"
"${SSH[@]}" 'sudo -n true' || { echo "Need key-based SSH as pi with passwordless sudo" >&2; exit 1; }

echo "2/6 Registering with the manager"
TV_ID="$(curl -fsS "$MANAGER/api/tvs" | PI_IP="$PI_IP" node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const list = JSON.parse(s); const tvs = Array.isArray(list) ? list : list.tvs || list.data || [];
        const tv = tvs.find(t => t.ip_address === process.env.PI_IP); if (tv) console.log(tv._id);
    });')"
if [[ -z "$TV_ID" ]]; then
    TV_ID="$(NAME="$NAME" LOCATION="$LOCATION" PI_IP="$PI_IP" node -e '
        console.log(JSON.stringify({ name: process.env.NAME, location: process.env.LOCATION, ip_address: process.env.PI_IP }))' \
        | curl -fsS -X POST "$MANAGER/api/tvs" -H 'Content-Type: application/json' --data-binary @- \
        | node -e 'let s = ""; process.stdin.on("data", d => s += d).on("end", () => console.log(JSON.parse(s)._id));')"
    echo "    registered $NAME as $TV_ID"
else
    echo "    already registered as $TV_ID"
fi
MQTT_ID="${TV_ID#tv_}"

echo "3/6 Packages, console and HDMI"
"${SSH[@]}" 'set -e
    sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-liberation fonts-dejavu-core >/dev/null
    CMDLINE=/boot/firmware/cmdline.txt; [ -f $CMDLINE ] || CMDLINE=/boot/cmdline.txt
    for opt in consoleblank=0 vt.global_cursor_default=0; do
        grep -q "$opt" $CMDLINE || sudo sed -i "1 s/\$/ $opt/" $CMDLINE
    done
    CONFIG=/boot/firmware/config.txt; [ -f $CONFIG ] || CONFIG=/boot/config.txt
    grep -q "# signage display" $CONFIG || printf "\n# signage display: always 1080p60 on both HDMI ports\nhdmi_force_hotplug:0=1\nhdmi_group:0=1\nhdmi_mode:0=16\nhdmi_force_hotplug:1=1\nhdmi_group:1=1\nhdmi_mode:1=16\ndisable_overscan=1\ngpu_mem=512\n" | sudo tee -a $CONFIG >/dev/null
    sudo systemctl set-default multi-user.target >/dev/null
    sudo usermod -a -G video,render pi'

echo "4/6 Credentials (/etc/signage/slideshow.env)"
{
    echo "SIGNAGE_COUCHDB_USERNAME=signage_tv"
    echo "SIGNAGE_COUCHDB_PASSWORD=$SIGNAGE_TV_PASSWORD"
    if [[ -n "${SIGNAGE_MQTT_PASSWORD:-}" ]]; then
        echo "SIGNAGE_MQTT_USERNAME=signage_tv"
        echo "SIGNAGE_MQTT_PASSWORD=$SIGNAGE_MQTT_PASSWORD"
    fi
    echo "SIGNAGE_HTTP_ALLOW=$SERVER"
} | "${SSH[@]}" 'sudo install -d -m 755 /etc/signage && sudo tee /etc/signage/slideshow.env >/dev/null && sudo chmod 600 /etc/signage/slideshow.env && sudo chown root:root /etc/signage/slideshow.env'

echo "5/6 Installing pi-slideshow-rs and its service"
[[ -x "$BINARY" ]] || (cd "$ROOT/pi-slideshow-rs" && ./build.sh >/dev/null)
scp -q -o BatchMode=yes "$BINARY" "pi@$PI_IP:/home/pi/pi-slideshow-rs.new"
sed "s|@TV_ID@|$MQTT_ID|; s|@SERVER@|$SERVER|g" "$ROOT/pi-slideshow-rs/slideshow.service" \
    | "${SSH[@]}" 'sudo tee /etc/systemd/system/slideshow.service >/dev/null
        mv ~/pi-slideshow-rs.new ~/pi-slideshow-rs && chmod 755 ~/pi-slideshow-rs
        sudo systemctl daemon-reload && sudo systemctl enable slideshow >/dev/null && sudo systemctl restart slideshow'

echo "6/6 Checking it reports in"
for _ in $(seq 1 20); do
    sleep 3
    if curl -fsS --max-time 3 "http://$PI_IP:8080/api/health" >/dev/null 2>&1; then
        echo "✓ $NAME ($PI_IP) is running as $TV_ID. Assign it a sequence in TV Management."
        if $REBOOT; then "${SSH[@]}" 'sudo reboot' || true; echo "  rebooting to apply the HDMI and console settings"; fi
        exit 0
    fi
done
echo "✗ $NAME did not answer on :8080; see: ssh pi@$PI_IP journalctl -u slideshow -n 50" >&2
exit 1
