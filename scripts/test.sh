#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Run after npm run build. Tests use synthetic data, in-memory SQLite and mocked fetch.
for test in scripts/test-*.mjs; do
  echo "==> $test"
  node "$test"
done
python3 scripts/test-wake-client.py
