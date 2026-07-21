#!/usr/bin/env bash
# Regenerates tests/golden/ from the current library. Writes nowhere else.
# Review the resulting git diff — that diff IS the review artifact for any
# change to a fragment.
set -euo pipefail

cd "$(dirname "$0")/.."

for fixture in tests/fixtures/*.answers.json; do
  name=$(basename "$fixture" .answers.json)
  tmp=$(mktemp -d)
  node scripts/resolve.mjs --answers "$fixture" --out "$tmp/plan.json" --quiet
  rm -rf "tests/golden/$name"
  node scripts/render.mjs --plan "$tmp/plan.json" --out "tests/golden/$name" >/dev/null
  rm -rf "$tmp"
  echo "updated tests/golden/$name"
done
