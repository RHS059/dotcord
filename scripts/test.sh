#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Run after npm run build. All data and external requests are synthetic.
# Explicit backend suite preserves auth, credentials, routing and delivery assertions.
for test in \
  scripts/test-account-wake-isolation.mjs \
  scripts/test-account-wake-lifecycle.mjs \
  scripts/test-audit-receipts.mjs \
  scripts/test-automatic-signup.mjs \
  scripts/test-client-download.mjs \
  scripts/test-configure-site.mjs \
  scripts/test-discord-errors.mjs \
  scripts/test-discord-threads.mjs \
  scripts/test-global-tokens.mjs \
  scripts/test-global-wake-client-labels.mjs \
  scripts/test-google-auth.mjs \
  scripts/test-google-integration.mjs \
  scripts/test-google-settings.mjs \
  scripts/test-grokbot-wake.mjs \
  scripts/test-migration-preservation.mjs \
  scripts/test-pipeline.mjs \
  scripts/test-receiver-companion.mjs \
  scripts/test-receiver-continuity.mjs \
  scripts/test-receiver-credentials.mjs \
  scripts/test-relay.mjs \
  scripts/test-shared-app-review.mjs \
  scripts/test-shared-onboarding.mjs \
  scripts/test-shared-send.mjs \
  scripts/test-subscription-connection-errors.mjs \
  scripts/test-temporary-inbox.mjs \
  scripts/test-test-wake.mjs \
  scripts/test-wake-security.mjs; do
  echo "==> $test"
  node "$test"
done
python3 scripts/test-wake-client.py
# Current production-bundle routes and redesigned interaction contracts.
node scripts/test-redesign-routes.mjs
node scripts/test-redesign-components.mjs
node --expose-gc scripts/test-redesign-ui.mjs
