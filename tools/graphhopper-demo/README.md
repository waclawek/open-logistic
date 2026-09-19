# GraphHopper demo (WAW → POZ)

Self-contained routing demo for Open Mercato showcases. Uses **GraphHopper** + Poland OSM extract behind Docker, with a **committed route fixture** so route geometry is available before import finishes (Leaflet and map tiles still require network access).

## Quick start (demo laptop)

```bash
# 1) Full setup — download Poland PBF (~2 GB) + import graph (~15–40 min first time, ~6 GB RAM)
yarn graphhopper:setup

# 2) Assert Warszawa → Poznań (~308 km / ~2.8 h)
yarn graphhopper:test

# 3) Map UI
#    - GraphHopper built-in: http://127.0.0.1:8989/
#    - Offline fixture viewer:
npx --yes serve tools/graphhopper-demo -p 8765
#    open http://127.0.0.1:8765/demo.html
```

Reuse an already-imported graph (e.g. from an earlier `/tmp/gh-data` experiment):

```bash
GH_DATA_DIR=/tmp/gh-data yarn graphhopper:setup
```

Stop:

```bash
yarn graphhopper:stop
```

## What ships in git

| Path | Purpose |
|------|---------|
| `config.yml` | Car-only, no elevation (fast import) |
| `fixtures/waw-poz.route.json` | Committed WAW→POZ geometry + PL instructions (~42 KB) |
| `demo.html` | Leaflet map: local fixture / live `:8989` |
| `setup.sh` / `test.sh` / `stop.sh` | Full setup + smoke test |

**Not in git** (downloaded by setup): `data/*.osm.pbf`, `data/*-gh/` graph cache.

## Smoke without Poland

```bash
./tools/graphhopper-demo/setup.sh --monaco   # ~1 min
./tools/graphhopper-demo/test.sh --monaco
```

## Expected WAW→POZ numbers

| | |
|--|--|
| Distance | ~307–310 km |
| Time | ~2.8–3.1 h |
| Live latency (warm) | ~70–130 ms |

## API example

```bash
curl -sS 'http://127.0.0.1:8989/route?point=52.2297,21.0122&point=52.4064,16.9252&profile=car&locale=pl&points_encoded=false&instructions=true' \
  | python3 -c 'import json,sys;p=json.load(sys.stdin)["paths"][0];print(round(p["distance"]/1000,1),"km",round(p["time"]/60000),"min")'
```

Refresh the committed fixture after a big OSM refresh:

```bash
./tools/graphhopper-demo/test.sh --update-fixture
```

## Requirements

- Docker Desktop (or Engine) running
- ~8 GB free RAM for Poland import
- ~4 GB disk (`data/`)

## Limitations and Windows

Run the shell scripts in Git Bash or WSL with Docker access; they are not PowerShell scripts. The car profile does not enforce truck height, weight, axle or hazardous-goods constraints. This standalone demo does not update dispatcher business records. The local route fixture does not require GraphHopper, but the viewer still downloads Leaflet from a CDN and OSM map tiles.
