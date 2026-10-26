#!/bin/bash
# Build pi-slideshow-rs once and roll it out to every TV the manager knows.
#
#   scripts/deploy-fleet.sh [--manager http://192.168.1.215:3000] [--only <ip>] [--dry-run]
#
# Canary first: the first TV is updated and must come back healthy (service
# active and reporting the new version) before the rest are touched. Each TV
# keeps its previous binary as ~/pi-slideshow-rs.prev; on a failed health check
# that TV is rolled back and the rollout stops.
# Needs key-based SSH as pi@<tv> with passwordless sudo for systemctl.
set -euo pipefail

MANAGER="${SIGNAGE_MANAGER:-http://192.168.1.215:3000}"
ONLY=""
DRY_RUN=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --manager) MANAGER="$2"; shift 2 ;;
        --only) ONLY="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="$ROOT/pi-slideshow-rs/target/aarch64-unknown-linux-musl/release/pi-slideshow-rs"
VERSION="$(grep -m1 '^version' "$ROOT/pi-slideshow-rs/Cargo.toml" | cut -d'"' -f2)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10)

# TVs from the manager: "name ip status" per line
mapfile -t TVS < <(curl -fsS "$MANAGER/api/system/fleet" | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        for (const tv of JSON.parse(s).tvs) console.log([tv.name.replace(/\s+/g, "_"), tv.ip_address, tv.status].join(" "));
    });')
[[ -n "$ONLY" ]] && mapfile -t TVS < <(printf '%s\n' "${TVS[@]}" | awk -v ip="$ONLY" '$2 == ip')
[[ ${#TVS[@]} -eq 0 ]] && { echo "No TVs to deploy to." >&2; exit 1; }

echo "pi-slideshow-rs $VERSION -> ${#TVS[@]} TV(s):"
printf '  %s\n' "${TVS[@]}"
$DRY_RUN && exit 0

echo "Building…"
(cd "$ROOT/pi-slideshow-rs" && ./build.sh >/dev/null)

healthy() {
    local ip="$1"
    for _ in $(seq 1 20); do
        sleep 3
        local reported
        reported="$(curl -fsS --max-time 3 "http://$ip:8080/api/version" 2>/dev/null | node -e '
            let s = ""; process.stdin.on("data", d => s += d).on("end", () => { try { console.log(JSON.parse(s).data.version) } catch {} });')"
        if [[ "$reported" == "$VERSION" ]] && "${SSH[@]}" "pi@$ip" 'systemctl is-active --quiet slideshow'; then
            return 0
        fi
    done
    return 1
}

deploy() {
    local name="$1" ip="$2"
    echo "→ $name ($ip)"
    scp -q -o BatchMode=yes "$BINARY" "pi@$ip:/home/pi/pi-slideshow-rs.new"
    "${SSH[@]}" "pi@$ip" 'cp ~/pi-slideshow-rs ~/pi-slideshow-rs.prev 2>/dev/null || true
        sudo systemctl stop slideshow && mv ~/pi-slideshow-rs.new ~/pi-slideshow-rs && sudo systemctl start slideshow'
    if healthy "$ip"; then
        echo "  ✓ $name runs $VERSION"
        return 0
    fi
    echo "  ✗ $name did not come back on $VERSION: rolling back" >&2
    "${SSH[@]}" "pi@$ip" 'sudo systemctl stop slideshow; cp ~/pi-slideshow-rs.prev ~/pi-slideshow-rs && sudo systemctl start slideshow' || true
    return 1
}

FAILED=0
for i in "${!TVS[@]}"; do
    read -r name ip status <<<"${TVS[$i]}"
    if [[ "$status" != "online" ]]; then
        echo "→ $name ($ip): offline, skipped"
        continue
    fi
    if ! deploy "$name" "$ip"; then
        FAILED=1
        echo "Stopping the rollout after a failure (canary rule)." >&2
        break
    fi
done
exit $FAILED
