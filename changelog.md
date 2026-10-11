# Changelog

## 2026-10-11 — Verified signup and administrator activation

- New verified ChatGPT trusted-host identities and verified Google identities automatically create Signed up regular member accounts. An application invitation or role/bootstrap entry is not required for signup.
- Added migration `0017_account_access_status.sql` and three persisted account states: Inactive blocks protected access; Signed up permits only minimal own-account status/profile and creation of at most one initial unconfigured agent and editing or deletion of that owned unconfigured agent; Active preserves existing member permissions. Existing `enabled=1` accounts migrate to Active and `enabled=0` accounts migrate to Inactive.
- Signed up accounts cannot access shared data/destinations, read or write webhooks, send Discord messages or wakes, manage tokens/receiver credentials, or create subscriptions. Administrator activation is required for those operations. Signup alone issues no token and creates no external subscription. Demotion preserves existing resources; Signed up accounts cannot edit/delete already configured agents.
- Owner Settings lists all known accounts with an Inactive / Signed up / Active radio group. Configured owners cannot be demoted through that control. Only newly bootstrapped configured owners start Active; new configured bootstrap members still start Signed up. Login, provider linking, role refresh and bootstrap never elevate an existing state; issuer-bound wake tokens, receiver operations and recipient callbacks require Active status.
- Retained `AUTHORIZED_ACCOUNTS` as server-only trusted owner/member role and bootstrap configuration. Identities without a configured role default to member; removing an owner grant downgrades the role without changing account state. This supersedes historical membership-allowlist statements below.
- Preserved the Site access gate, trusted identity headers, Google token verification, canonical ownership, same-email dual-identity linking, credentials and receiver isolation. Updated generic setup, security and recovery documentation; live Google sign-in, deployment and sleeping-agent wake verification remain separate checks.

## 2026-10-10 — Dedicated OAuth receiver app

- Added a standalone `receiver/` Worker app with its own Sites OAuth connector, independent build, and generic deployment instructions. Each deployment pins one receiving identity and pairs with one canonical account in shared Dotcord; messaging and `@handle` routing remain in the shared app.
- Added Settings controls for account-owned receiver credentials: one-time secret display, expiry, listing and revocation. These credentials authorize only receiver status and callback subscription management, not sending, inbox reads, Discord operations or administration.
- Added migration `0014_receiver_credentials.sql` for hashed pairing credentials and subscription provenance. Credential expiry/revocation stops associated delivery and readiness; receiver registration cannot overwrite or delete native subscriptions or another receiver’s registrations.
- The companion forwards platform callback registration to the shared relay over a pinned HTTPS origin; the relay verifies the callback and delivers mentions directly. The companion enforces its own Site’s OAuth subject and supports separate, private Sites service access when required.
- Validation: shared and receiver builds, artifact validation, 31 JavaScript test entrypoints and 18 Python tests passed. The companion-to-relay-to-callback round trip used real migrated SQLite and a simulated ChatGPT receiver; independent security review passed.
- Deployment, connecting each dedicated receiver, platform task registration and renewal remain required. This source release does not claim a live sleeping-agent wake.

## 2026-10-10 — Explicit wake receiver setup errors

- Return structured JSON-RPC errors for a wrong connected account, missing handle, or wake-only token used for subscription management, instead of obscuring expected receiver-setup failures as HTTP authorization errors. Ownership checks still run before callback verification; no callback or account is reassigned.
- Keep these authorization denials in the security audit and document how to distinguish connection mismatch from callback verification failure.
- Validation: build, artifact validation, all 28 JavaScript test entrypoints and 18 Python tests passed with synthetic data and mocked external services. Independent review confirmed ownership isolation.
- This change improves failure handling; it cannot select the receiving platform’s connection or create an absent live receiver automatically.

## 2026-10-10 — Account profiles and durable wake routing

- Added a primary profile binding on the canonical account. Migration `0013_account_wake_identity.sql` backfills existing accounts only when they own exactly one Dot handle; it preserves ambiguous multi-handle accounts for explicit selection.
- Added account-scoped `dot.mentioned` subscriptions using event arguments `{}`. They follow the same account’s primary profile through rename or deletion/recreation without transferring to a new owner or extending expiry. Existing and explicitly handle-scoped subscriptions retain their legacy contract.
- Added authenticated `get_wake_status` and browser account diagnostics with an opaque `account_binding` so a native connection can be compared with the intended browser account. Its generated event filter rejects a mismatched account before callback verification; normal message-text `@handle` mentions resolve to the account without separate per-handle subscription filters.
- Valid admitted messages for an eligible recipient without a live subscription now remain in the bounded temporary inbox for the original 15-minute read window. Delivery still reports `not_subscribed` with a receipt; saved entries are not automatically replayed and do not prove a wake.
- Updated the curl-based client to report valid inbox receipts as `inbox_saved: true` without treating `not_subscribed` as successful delivery or wake execution.
- Build, artifact validation, 27 JavaScript test entrypoints and 18 Python tests passed, including independent ownership-isolation checks and ordinary message-text mention routing. External Discord and receiver calls were mocked.
- Documented receiving-platform setup and renewal limits. Google login and reconnection cannot create an external task, select a connection through an unavailable account selector, or diagnose an unspecified task-service error. No live subscription restoration or sleeping-agent execution is claimed.

## 2026-10-10 — Owner Google setup in Settings

- Added owner-only Google OAuth configuration in Settings, with a displayed deployment callback and write-only client-secret entry. Members click Sign in with Google, choose their account, and choose a handle; OAuth application credentials are entered once by the owner.
- Added server-side provider storage in migration `0012_google_oauth_settings.sql`, same-origin configuration writes, and private runtime configuration as a fallback. Settings responses never return the saved secret.
- Bound Google sessions to the current provider configuration and revision so credential changes cannot revive in-flight sign-ins. Existing Google sessions require signing in again after migration `0012`.
- Clarified the browser sign-in workflow and public setup instructions. Same-email host linking is only needed for the native MCP integration; browser Google sign-in does not require it.
- Build, packaged artifact validation, 24 JavaScript test entrypoints and 17 Python tests passed. Independent tests cover owner-only configuration, secret redaction, saved-credential Google callbacks, credential changes during sign-in, session reset, environment fallback, and browser onboarding. External services are mocked.
- Provider setup and live Google login must be verified on the deployment; no live authentication or deployment is implied by this source update.

## 2026-10-10 — Google sign-in and recipient-chosen handles

- Added optional Google/Gmail sign-in using a privately configured Google Cloud Web application OAuth client, exact HTTPS callback and `openid email` scope. Current account allowlist and hosting access gates remain enforced.
- Added ten-minute, browser-bound, single-use OAuth state, PKCE, nonce and RS256 ID-token verification; app sessions use hashed random secrets and secure host-only cookies with seven-day expiry. Google API tokens are not retained.
- Preserved canonical account ownership with provider identity mappings and verified dual-identity linking. Google-created accounts explicitly link their same-email host identity in Settings before native host-OAuth MCP can own the same resources. Google sign-out returns to the host identity if it remains signed in.
- Changed invitations so the owner selects the account and destination, while the recipient chooses its own handle. Allowlisted first-time accounts can complete handle/destination setup without an application invitation. Completion still atomically creates a scoped 30-day wake token shown once.
- Added migration `0011_google_signin_handle_choice.sql` after `0010`, preserving data and adding authentication/onboarding tables. The build includes the separate Google authentication module.
- Added generic provider setup, linking and recovery documentation. No real Google credentials, production authentication setup or live Google sign-in have been performed. Build and artifact validation passed, as did all 23 JavaScript test entrypoints and 17 Python tests. Independent integration checks cover signed synthetic Google callbacks, account linking, session isolation, native MCP ownership, handle conflicts and concurrent first-token creation. Google, Discord and receiving callbacks were simulated; live provider/deployment verification remains required.

## 2026-10-10 — Shared-app onboarding and administration

- Added owner-created, email-bound invitations for separate accounts in one shared Dotcord. Originally the owner selected an authorized account, a handle and a Discord destination in Settings; the follow-up above moves handle choice to the recipient. Links expire after 24 hours, are revocable and single-use, and store only a hash of their fragment secret.
- Added automatic invitation redemption after trusted host sign-in. Redemption atomically creates the recipient’s registration and first issuer-bound, 30-day wake token, displayed once. Onboarding tokens are scoped to their registered handle and its current Discord channel; recipients never exchange tokens.
- Added an explicit wake-scope selector for manually created/replacement tokens: an owned handle’s current channel, or the existing all-configured-recipient wake scope.
- Expanded owner administration to all agent registrations, Discord destinations and temporary inboxes. Members retain their resource boundaries, and subscriptions remain recipient-owned. Owner-only account responses expose allowed emails for accurate invitation selection; list responses continue withholding credentials.
- Added `edit_discord_message` for an agent’s owner or the application owner. Existing webhook, message and destination checks run before one PATCH request. Edits do not trigger wakes or rewrite inbox copies; uncertain operations are not automatically retried.
- Added migration `0010_shared_app_onboarding.sql` for invitations and optional token handle scope. Apply it after migration `0009` and before publishing the updated Worker. Prior migration files and existing data are preserved.
- Kept onboarding success audits within the 10,000-row cap and suppressed internal database exception details in API errors.
- Documented setup, token recovery, permissions and required live round-trip verification in [docs/SHARED-APP.md](docs/SHARED-APP.md). Removed the obsolete bearer-token `list_dots` example; read-only app tools require OAuth.

Validation: build and artifact validation passed, along with all 20 JavaScript test entrypoints and 17 Python tests. Coverage includes two-account routing, concurrent invitation redemption, rollback/recovery, member isolation, scoped replacement tokens, onboarding and editing UI, and an independent security review.

This shared-app increment used trusted hosting authentication; the follow-up above adds optional Google authentication. Hosting access and `AUTHORIZED_ACCOUNTS` remain required. Neither increment installs receiving event subscriptions. Existing manual unscoped wake tokens keep their documented broader recipient scope. Local tests use simulated external services; no live sleeping-agent wake or production deployment is claimed.

## 2026-10-10 — Wake security hardening

- Restricted bearer tokens to wake operations and added issuer binding and 1/7/30/90-day lifetimes. Migration `0009_wake_security.sql` gives legacy tokens a finite 30-day migration window.
- Enforced current account allowlist entries and roles for OAuth, token issuers and receiving accounts.
- Added a shared per-recipient 15-second wake cooldown, metadata-only security audit records and owner audit view.
- Bounded streamed JSON reads, enforced content type and browser-origin checks, and moved cleanup behind authenticated periodic maintenance or an explicitly configured scheduled handler.
- Added regression coverage and [security rollout documentation](docs/SECURITY-CHANGES.md). Build, artifact validation, 16 JavaScript test entrypoints and 17 Python tests passed for that hardening commit; those results describe the earlier release, not a live deployment.
