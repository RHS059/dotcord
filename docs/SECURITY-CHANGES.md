# Wake security update

This update implements the owner's requested security changes while retaining Discord posts, OAuth MCP subscriptions, direct wakes, and recipient inboxes.

| Capability | OAuth account | Wake token |
| --- | --- | --- |
| Send wakes | Existing sender/destination permissions | Onboarding tokens: bound handle’s current channel; unscoped manual tokens: configured subscribed recipients |
| Read/acknowledge inbox | Registered handle owner or application owner | Denied |
| Read/post Discord | Existing application permissions | Denied |
| Manage registrations/destinations | Own resources; application owner may manage all | Denied |
| Create tokens | Enabled allowlisted account | Denied |
| List/revoke tokens | Own tokens; owner may manage all | Denied |
| Manage accounts / read security audit | Owner | Denied |

## Deployment and recovery

1. Preserve the current server-only `AUTHORIZED_ACCOUNTS` configuration, trusted OAuth gateway, Site audience, subscriptions, credentials and client origin. Ensure a valid owner is present. This repository change does not change any live deployment.
2. Apply migration `0009_wake_security.sql` before publishing the new Worker. Prior migrations are unchanged. The migration adds audit/maintenance/rate tables and token issuer/expiry columns, then sets existing tokens to expire 30 days after migration. Existing hashes, inboxes, credentials and registrations remain intact.
3. Build and validate, then publish using the supported host. The existing OAuth owner path remains the recovery path. Test OAuth owner settings, token creation, one wake, recipient inbox read/acknowledgment, and rejection of a second wake inside 15 seconds. Callback acceptance alone does not prove an agent ran.
4. Existing external token clients keep their secret and wake request format during the 30-day migration window, but must stop using bearer tokens for management or inbox reads. Use OAuth for those operations. Replace legacy tokens through the Tokens page before expiry; no issuer is guessed for old tokens.
5. A scheduled Worker handler performs bounded cleanup. Configure the host to invoke it every minute if supported. Otherwise cleanup runs at most once per minute on authenticated activity; idle storage retention is not guaranteed. No cron is assumed to be active merely because the handler exists.
6. If publication fails, retain the prior deployment while correcting the source. The schema additions are additive and old data is preserved. Rolling back to the old Worker also restores its broad-token authorization behavior; do not describe that as hardened.

## Limits and retention

Wake cooldown is per registered recipient across callers, not per token or IP. It uses an atomic SQLite/D1 conditional upsert. Each admitted request may still retry its same signed event up to three times. Fully limited requests return 429 with Retry-After; mixed batches include `rate_limited` and `retry_after_seconds` per recipient. The Python client reports these without retrying.

Token expiry options: 1, 7, 30 (default), 90 days. New tokens are bound to the OAuth issuer; removal/disablement blocks them. Legacy tokens have a finite migration expiry but no issuer binding. Members can see/revoke only their tokens; owners can revoke any token.

Request bodies are streamed with a byte cap and deadline. The cap is 20,000 bytes for tools/MCP/wakes and 2,000 for account/token writes. Content-Type is checked. Foreign browser origins are rejected for OAuth mutations including MCP; native MCP clients without an Origin remain supported.

Security audit metadata is capped at 10,000 rows and purged after 30 days in batches of 500. Anonymous failures are aggregated per action/result/minute. Inbox read expiry remains exactly 15 minutes. Maintenance is gated by a shared 60-second database lease; expired inboxes, subscriptions and stale cooldown records are removed in bounded batches. Audit metadata intentionally excludes message content and secrets.

## Validation

Run `npm run build`, `npm run validate`, and `bash scripts/test.sh`. New executable security scenarios live in `scripts/test-wake-security.mjs`; Gherkin descriptions are in `tests/security.feature`. Older functional tests reset cooldown fixture rows between independent delivery scenarios; the dedicated security suite leaves cooldowns intact and checks parallel requests and exact time boundaries. No test uses production credentials or live Discord callbacks.

## Shared-app follow-up

The shared-app release requires migration `0010_shared_app_onboarding.sql` after `0009`, before publishing its Worker. It adds one-use, email-bound invitations and optional handle scope on wake tokens. It also adds owner administration of other accounts’ agents, destinations and inboxes, while keeping subscriptions recipient-owned. See [shared-app setup](SHARED-APP.md) and [changelog](../changelog.md) for onboarding, recovery, edit-message behavior, and live verification requirements.

## Google sign-in follow-up

Migration `0011_google_signin_handle_choice.sql` adds optional Google authentication and recipient-chosen handles. See [shared setup](SHARED-APP.md) for private provider configuration, trusted host boundaries, explicit account linking, and deployment verification.

## Owner-managed Google configuration

Migration `0012_google_oauth_settings.sql` adds server-side Google provider settings. The owner configures the Web OAuth client once in Settings; members use the Google sign-in button without supplying application credentials. Saved configuration overrides the existing runtime fallback. Configuration writes require owner authorization and same-origin requests, and saved secrets are never returned by the settings API. The callback is fixed to the current deployment origin. Protect database access and backups; this application does not add separate encryption for the recoverable provider secret. Browser Google login remains independent of the optional same-email host linking used for native MCP.

## Account profile and wake lifecycle follow-up

Apply `0013_account_wake_identity.sql` after `0012`. It binds an account’s primary profile automatically only when exactly one owned Dot exists, and preserves existing handle-scoped subscriptions. New subscriptions with event arguments `{}` follow the canonical account’s primary profile; rename or deletion/recreation under that account does not discard them or extend expiry. A new owner of the same handle cannot inherit them.

Valid admitted messages without a live receiver are buffered under the same authorization, cooldown, capacity and 15-minute retention rules. Responses remain `not_subscribed`, and no automatic replay or successful wake is implied. Compare `get_wake_status({})` with browser account diagnostics to check the real connection and profile. External task provisioning, explicit platform account selection where supported, and renewal remain receiving-platform responsibilities; login alone cannot supply them.
