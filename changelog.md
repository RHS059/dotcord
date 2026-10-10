# Changelog

## 2026-10-10 — Shared-app onboarding and administration

- Added owner-created, email-bound invitations for separate accounts in one shared Dotcord. The owner selects an authorized account, an unused handle and a Discord destination in Settings. Links expire after 24 hours, are revocable and single-use, and store only a hash of their fragment secret.
- Added automatic invitation redemption after trusted host sign-in. Redemption atomically creates the recipient’s registration and first issuer-bound, 30-day wake token, displayed once. Onboarding tokens are scoped to their registered handle and its current Discord channel; recipients never exchange tokens.
- Added an explicit wake-scope selector for manually created/replacement tokens: an owned handle’s current channel, or the existing all-configured-recipient wake scope.
- Expanded owner administration to all agent registrations, Discord destinations and temporary inboxes. Members retain their resource boundaries, and subscriptions remain recipient-owned. Owner-only account responses expose allowed emails for accurate invitation selection; list responses continue withholding credentials.
- Added `edit_discord_message` for an agent’s owner or the application owner. Existing webhook, message and destination checks run before one PATCH request. Edits do not trigger wakes or rewrite inbox copies; uncertain operations are not automatically retried.
- Added migration `0010_shared_app_onboarding.sql` for invitations and optional token handle scope. Apply it after migration `0009` and before publishing the updated Worker. Prior migration files and existing data are preserved.
- Kept onboarding success audits within the 10,000-row cap and suppressed internal database exception details in API errors.
- Documented setup, token recovery, permissions and required live round-trip verification in [docs/SHARED-APP.md](docs/SHARED-APP.md). Removed the obsolete bearer-token `list_dots` example; read-only app tools require OAuth.

Validation: build and artifact validation passed, along with all 20 JavaScript test entrypoints and 17 Python tests. Coverage includes two-account routing, concurrent invitation redemption, rollback/recovery, member isolation, scoped replacement tokens, onboarding and editing UI, and an independent security review.

Authentication still comes from the trusted hosting gateway. Native Site invitations and `AUTHORIZED_ACCOUNTS` must be configured first; this release does not add Google/email authentication or install receiving event subscriptions. Existing manual unscoped wake tokens keep their documented broader recipient scope. Local tests use simulated external services; no live sleeping-agent wake or production deployment is claimed.

## 2026-10-10 — Wake security hardening

- Restricted bearer tokens to wake operations and added issuer binding and 1/7/30/90-day lifetimes. Migration `0009_wake_security.sql` gives legacy tokens a finite 30-day migration window.
- Enforced current account allowlist entries and roles for OAuth, token issuers and receiving accounts.
- Added a shared per-recipient 15-second wake cooldown, metadata-only security audit records and owner audit view.
- Bounded streamed JSON reads, enforced content type and browser-origin checks, and moved cleanup behind authenticated periodic maintenance or an explicitly configured scheduled handler.
- Added regression coverage and [security rollout documentation](docs/SECURITY-CHANGES.md). Build, artifact validation, 16 JavaScript test entrypoints and 17 Python tests passed for that hardening commit; those results describe the earlier release, not a live deployment.
