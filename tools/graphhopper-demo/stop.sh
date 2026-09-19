#!/usr/bin/env bash
set -euo pipefail
CONTAINER="${GH_CONTAINER:-om-graphhopper-demo}"
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker rm -f "$CONTAINER" >/dev/null
  echo "Stopped and removed $CONTAINER"
else
  echo "No container named $CONTAINER"
fi
# Legacy name from earlier experiments
if docker ps -a --format '{{.Names}}' | grep -qx om-gh-test; then
  docker rm -f om-gh-test >/dev/null
  echo "Also removed legacy om-gh-test"
fi
