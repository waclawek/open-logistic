#!/usr/bin/env bash
# Smoke-test GraphHopper: Warszawa → Poznań (or Monaco A→B with --monaco)
#
# Asserts distance band, prints PL turn-by-turn head/tail, refreshes fixture optionally.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${GH_PORT:-8989}"
BASE="http://127.0.0.1:${PORT}"
FIXTURE="$ROOT/fixtures/waw-poz.route.json"
UPDATE_FIXTURE=0
REGION="poland"

for arg in "$@"; do
  case "$arg" in
    --monaco) REGION="monaco" ;;
    --update-fixture) UPDATE_FIXTURE=1 ;;
    -h|--help)
      echo "Usage: $0 [--monaco] [--update-fixture]"
      exit 0
      ;;
  esac
done

if [[ "$REGION" == "poland" ]]; then
  FROM_LAT=52.2297; FROM_LNG=21.0122; FROM_NAME="Warszawa"
  TO_LAT=52.4064; TO_LNG=16.9252; TO_NAME="Poznań"
  MIN_KM=280; MAX_KM=360
else
  FROM_LAT=43.7391; FROM_LNG=7.4270; FROM_NAME="Monaco-A"
  TO_LAT=43.7350; TO_LNG=7.4215; TO_NAME="Monaco-B"
  MIN_KM=0.5; MAX_KM=10
fi

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

curl -sf --max-time 5 "$BASE/info" >/tmp/om-gh-info.json \
  || die "GraphHopper not reachable at $BASE — run setup.sh first"

URL="${BASE}/route?point=${FROM_LAT}%2C${FROM_LNG}&point=${TO_LAT}%2C${TO_LNG}&profile=car&locale=pl&points_encoded=false&instructions=true"

log "GET $FROM_NAME → $TO_NAME"
curl -sf --max-time 30 -o /tmp/om-gh-route.json -w "    http=%{http_code} time=%{time_total}s\n" "$URL" \
  || die "route request failed"

python3 - "$FROM_NAME" "$TO_NAME" "$FROM_LAT" "$FROM_LNG" "$TO_LAT" "$TO_LNG" "$MIN_KM" "$MAX_KM" "$FIXTURE" "$UPDATE_FIXTURE" <<'PY'
import json, sys
from_name, to_name = sys.argv[1], sys.argv[2]
from_lat, from_lng = float(sys.argv[3]), float(sys.argv[4])
to_lat, to_lng = float(sys.argv[5]), float(sys.argv[6])
min_km, max_km = float(sys.argv[7]), float(sys.argv[8])
fixture_path, update = sys.argv[9], sys.argv[10] == "1"

d = json.load(open("/tmp/om-gh-route.json"))
if "paths" not in d:
    raise SystemExit(f"unexpected response: {d}")

p = d["paths"][0]
km = p["distance"] / 1000
mins = p["time"] / 60000
npts = len(p["points"]["coordinates"])
nins = len(p.get("instructions") or [])

print(f"OK  {from_name} → {to_name}")
print(f"    distance: {km:.1f} km")
print(f"    time:     {mins:.0f} min ({mins/60:.1f} h)")
print(f"    points:   {npts}")
print(f"    instructions: {nins}")
for ins in (p.get("instructions") or [])[:3]:
    print(f"      • {ins.get('text')}")
print("      …")
for ins in (p.get("instructions") or [])[-2:]:
    print(f"      • {ins.get('text')}")

if not (min_km <= km <= max_km):
    raise SystemExit(f"distance {km:.1f} km outside expected band [{min_km}, {max_km}]")

fixture = {
    "meta": {
        "from": {"name": from_name, "lat": from_lat, "lng": from_lng},
        "to": {"name": to_name, "lat": to_lat, "lng": to_lng},
        "profile": "car",
        "provider": "graphhopper",
        "locale": "pl",
    },
    "distance_m": round(p["distance"]),
    "time_ms": p["time"],
    "points": p["points"],
    "instructions": [
        {
            "text": i.get("text"),
            "distance_m": round(i.get("distance", 0)),
            "time_ms": i.get("time", 0),
            "sign": i.get("sign"),
            "street_name": i.get("street_name"),
        }
        for i in (p.get("instructions") or [])
    ],
}

import pathlib
path = pathlib.Path(fixture_path)
if update:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")))
    print(f"    fixture updated: {path} ({path.stat().st_size} bytes)")
elif path.exists() and from_name.startswith("Wars"):
    committed = json.loads(path.read_text())
    committed_km = committed["distance_m"] / 1000
    delta = abs(committed_km - km)
    print(f"    fixture: {committed_km:.1f} km (Δ {delta:.1f} km vs live)")
    if delta > 25:
        print("    WARN: live route drifted >25 km from committed fixture — consider --update-fixture")
PY

log "Pass. Open demo.html for the map, or $BASE/"
