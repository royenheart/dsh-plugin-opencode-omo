#!/usr/bin/env bash
# Build this package with its own npm toolchain (`npm install` provides
# node_modules). No sibling-checkout assumptions: on a fresh clone, run
# `npm install` once (install.py does this automatically when lib/ is
# missing), then `npm run build`.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -x node_modules/.bin/tsc || ! -x node_modules/.bin/tsdown ]]; then
  echo "build toolchain missing - run: npm install" >&2
  exit 1
fi

# Regenerate the bundle patch from its sources first, so a template or preset
# composition edit can never ship a stale preset declaration.
node scripts/build-preset-patch.mjs
node_modules/.bin/tsc --noEmit -p tsconfig.json
node_modules/.bin/tsdown
