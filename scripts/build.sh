#!/usr/bin/env bash
# Build this package with its own npm toolchain (`npm ci` provides
# node_modules from package-lock.json). No sibling-checkout assumptions: on a
# fresh clone, run `npm ci` once (install.py does this automatically when the
# node_modules/.bin toolchain is missing or package-lock.json is newer), then
# `npm run build`.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -x node_modules/.bin/tsc || ! -x node_modules/.bin/tsdown ]]; then
  echo "build toolchain missing - run: npm ci" >&2
  exit 1
fi

node scripts/check-architecture.mjs
node_modules/.bin/tsc --noEmit -p tsconfig.json
node_modules/.bin/tsdown
