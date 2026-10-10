# Changelog

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
