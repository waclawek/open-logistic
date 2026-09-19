#!/usr/bin/env bash
# Full GraphHopper demo setup: OSM extract → graph import → HTTP API on :8989
#
# Usage:
#   ./tools/graphhopper-demo/setup.sh              # Poland (demo default)
#   ./tools/graphhopper-demo/setup.sh --monaco     # tiny smoke (~1 min)
#   GH_DATA_DIR=/tmp/gh-data ./tools/graphhopper-demo/setup.sh  # reuse existing data
#   ./tools/graphhopper-demo/setup.sh --force      # wipe graph cache + reimport
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${GH_DATA_DIR:-$ROOT/data}"
IMAGE="${GH_IMAGE:-israelhikingmap/graphhopper:latest}"
CONTAINER="${GH_CONTAINER:-om-graphhopper-demo}"
PORT="${GH_PORT:-8989}"
JAVA_OPTS="${GH_JAVA_OPTS:--Xmx6g -Xms2g}"

REGION="poland"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --monaco) REGION="monaco" ;;
    --poland) REGION="poland" ;;
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

if [[ "$REGION" == "poland" ]]; then
  PBF_NAME="poland-latest.osm.pbf"
  PBF_URL="https://download.geofabrik.de/europe/poland-latest.osm.pbf"
  GRAPH_NAME="poland-gh"
  EXPECT_MIN_BYTES=$((1500 * 1024 * 1024))
else
  PBF_NAME="monaco-latest.osm.pbf"
  PBF_URL="https://download.geofabrik.de/europe/monaco-latest.osm.pbf"
  GRAPH_NAME="monaco-gh"
  EXPECT_MIN_BYTES=$((100 * 1024))
  JAVA_OPTS="${GH_JAVA_OPTS:--Xmx1g -Xms512m}"
fi

PBF_PATH="$DATA_DIR/$PBF_NAME"
GRAPH_PATH="$DATA_DIR/$GRAPH_NAME"
CONFIG_PATH="$ROOT/config.yml"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

need docker
need curl
docker info >/dev/null 2>&1 || die "docker daemon not reachable"

mkdir -p "$DATA_DIR"
cp -f "$CONFIG_PATH" "$DATA_DIR/config.yml"

if [[ "$FORCE" -eq 1 ]]; then
  log "Force: removing graph cache $GRAPH_PATH"
  rm -rf "$GRAPH_PATH"
fi

if [[ ! -f "$PBF_PATH" ]] || [[ "$(wc -c <"$PBF_PATH" | tr -d ' ')" -lt "$EXPECT_MIN_BYTES" ]]; then
  log "Downloading $PBF_URL → $PBF_PATH"
  tmp="$PBF_PATH.partial"
  curl -fL --progress-bar -o "$tmp" "$PBF_URL"
  mv "$tmp" "$PBF_PATH"
else
  log "PBF already present: $PBF_PATH ($(du -h "$PBF_PATH" | awk '{print $1}'))"
fi

if [[ -d "$GRAPH_PATH" ]] && [[ -f "$GRAPH_PATH/properties" || -f "$GRAPH_PATH/edges" || -f "$GRAPH_PATH/nodes" ]]; then
  log "Graph cache present: $GRAPH_PATH ($(du -sh "$GRAPH_PATH" | awk '{print $1}')) — skip import (use --force to rebuild)"
else
  log "No ready graph cache yet — first boot will import (Poland: ~15–40 min, ~6 GB RAM)"
fi

# Drop conflicting containers that also bind :8989
for other in om-gh-test om-graphhopper-demo; do
  if [[ "$other" != "$CONTAINER" ]] && docker ps -a --format '{{.Names}}' | grep -qx "$other"; then
    log "Removing conflicting container $other"
    docker rm -f "$other" >/dev/null
  fi
done

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  log "Container $CONTAINER already running"
else
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    log "Starting existing container $CONTAINER"
    docker start "$CONTAINER" >/dev/null
  else
    log "Pulling $IMAGE"
    docker pull "$IMAGE"
    log "Starting $CONTAINER on :$PORT (mount $DATA_DIR)"
    docker run -d --name "$CONTAINER" \
      -p "${PORT}:8989" \
      -e "JAVA_OPTS=$JAVA_OPTS" \
      -v "$DATA_DIR:/data" \
      "$IMAGE" \
      -i "/data/$PBF_NAME" \
      -o "/data/$GRAPH_NAME" \
      -c /data/config.yml \
      --host 0.0.0.0 \
      --port 8989 >/dev/null
  fi
fi

log "Waiting for http://127.0.0.1:${PORT}/info …"
ready=0
for i in $(seq 1 360); do
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/info" >/tmp/om-gh-info.json 2>/dev/null; then
    if grep -q '"car"' /tmp/om-gh-info.json 2>/dev/null || grep -q 'car' /tmp/om-gh-info.json 2>/dev/null; then
      ready=1
      break
    fi
  fi
  if [[ $((i % 12)) -eq 0 ]]; then
    printf '    … still importing (%ds)\n' "$((i * 5))"
    docker logs "$CONTAINER" 2>&1 | tail -2 | sed 's/^/    /' || true
  fi
  sleep 5
done

[[ "$ready" -eq 1 ]] || {
  docker logs "$CONTAINER" 2>&1 | tail -40 >&2
  die "GraphHopper did not become ready in time"
}

bbox="$(python3 -c 'import json;print(json.load(open("/tmp/om-gh-info.json")).get("bbox"))' 2>/dev/null || echo '?')"
log "Ready. bbox=$bbox"
log "UI:   http://127.0.0.1:${PORT}/"
log "API:  http://127.0.0.1:${PORT}/route"
log "Next: yarn graphhopper:test   OR   $ROOT/test.sh"
log "Map:  open $ROOT/demo.html in a browser (offline fixture + live toggle)"
