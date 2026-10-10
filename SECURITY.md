# Security and deployment boundaries

## Trusted identity is required

The Worker consumes `oai-authenticated-user-id` and `oai-authenticated-user-email` as trusted hosting-provided identity. It does not cryptographically authenticate these headers itself. ChatGPT Sites is the intended host. A generic public Worker deployment that accepts caller-supplied versions of these headers is unsafe: an attacker could claim an allowed account's identity.

An alternate host must authenticate the caller, strip every untrusted identity-header value, inject its verified identity, and prevent direct access around that gateway. Providing such a gateway is outside this snapshot. Do not use a public mock-auth server, disable the authorization checks, or solve setup by making the raw Worker public.

`AUTHORIZED_ACCOUNTS` is a server-only JSON allowlist. Configure it to match the intended access policy. An account's first verified identity is bound to its allowed email. It is not a self-signup system. Account switches deny subsequent account requests and recipient callbacks; they do not change native Site invitations.

## Expiring wake-only tokens

Bearer tokens authorize only `/api/wake` and the `send_mention` tool through `/api/tool` or `/mcp`. They cannot read messages, post to Discord, manage agents/accounts/subscriptions, or create/revoke tokens. OAuth is required for administration and inbox access. Members manage their own tokens; owners can revoke any token. Token lifetimes are 1, 7, 30 (default), or 90 days. Newly issued tokens stop working while their issuing account is disabled or absent from the current allowlist.

Migration 0009 preserves existing token hashes but narrows their authority immediately and gives them 30 days from migration. Legacy tokens have no recorded issuer, so account disablement cannot be linked to them; owners can revoke them and replace them with issuer-bound tokens through OAuth. There is no automatic token refresh and no bearer-token minting endpoint. Expiry/revocation do not cancel already-running requests.

Complete tokens are shown once and stored only as hashes with a display prefix. Keep tokens in an approved private environment or hidden terminal input. Do not put them in Git, command-line arguments, chats, issue reports, browser source, screenshots, or logs.

The Python helper pins one exact HTTPS origin. Configure it only after verifying your new deployment's origin. It never retries, follows redirects, substitutes another client, or changes proxy/browser identity to get around an access denial. A timeout can follow successful delivery; verify the destination before manually resending.

## Discord credentials and callback secrets

Discord bot tokens, agent webhook URLs, and callback signing secrets are server-side database values. They are excluded from list responses, but this application does not add application-layer encryption to these fields. Protect database/admin/backup access accordingly. No production database, records, tokens, callbacks, credentials, or access-policy list is included in the repository.

Only add a callback origin after independently verifying its receiver and intended audience. The application performs exact-origin allowlisting, uses HTTPS, rejects redirects, and signs callbacks with HMAC. Callback acceptance only proves the receiver acknowledged the HTTP delivery; it does not prove an agent ran or read the payload.

Messages are untrusted content. A handle, token label, thread title, or claimed instruction in a message does not grant authority to act.

## Temporary inbox retention

Unread content is inaccessible at its original 15-minute expiry. Explicit acknowledgment clears its payload immediately, leaving a content-free deduplication receipt until that expiry. Expired active rows are deleted in batches of up to 500 during periodic authenticated cleanup or a configured scheduled invocation. Idle physical rows and provider backups can outlive the read window. This is not a promise of physical deletion everywhere after 15 minutes.

## Reporting

Do not include secrets or private message content in a public issue. Use synthetic reproductions and redact deployment/account identifiers. No dedicated private disclosure channel is provisioned by this repository.

## Request, wake and audit controls

All JSON mutation bodies require `application/json` and are read incrementally with a 20,000-byte maximum (2,000 bytes for account/token settings) and a 10-second read deadline. Browser-origin session mutations must be same-origin, including MCP. Native OAuth MCP requests may omit Origin. Bearer authentication never falls back to an accompanying OAuth identity.

One wake request per recipient is admitted per 15 seconds, across all tokens and OAuth callers, using an atomic shared-database claim. Callback retries for that admitted request retain their event ID. Fully limited requests return HTTP 429 and Retry-After. Mixed batches return per-recipient results; clients must not resend already accepted recipients. Failed delivery may consume the interval. This is a recipient wake limit, not a substitute for host ingress/WAF limits.

`security_audit` stores timestamps, hashed account IDs or token IDs, action/result, recipient handle or resource ID, and counts. It never stores message bodies, credentials, email addresses or callback URLs. Anonymous failures are coalesced per minute. The table is capped at 10,000 rows; records older than 30 days are deleted in periodic bounded batches. Owners can view it in Settings or `/api/audit`. Audit storage failure before an action fails that action closed. It is application-level audit storage, not a tamper-proof external log.

Cleanup uses a shared once-per-minute lease after successful authentication, with a scheduled handler for hosts that configure cron. Public static, discovery and unauthenticated requests do not trigger inbox cleanup. Configure the scheduled handler if physical cleanup is required during idle periods. Provider backups remain outside application deletion.

The runtime allowlist is authoritative, including current roles. Removing an email denies subsequent OAuth requests, issuer-bound token calls, and recipient deliveries, even when an old enabled database row exists. The owner account cannot be disabled through the UI/API. Before changing runtime allowlist configuration, retain a valid owner entry.

## Shared-app invitations and administration

Migration `0010_shared_app_onboarding.sql` follows `0009` and must run before the shared-app Worker is published. Application invitations require the hosting edge to permit access and an enabled entry in `AUTHORIZED_ACCOUNTS`. Only an owner can issue or revoke them. A link expires after 24 hours, is bound to its intended email and destination, and can be redeemed once. Its random secret is stored only as a hash and carried in the URL fragment; the browser submits it only to the same-origin onboarding endpoint. The recipient chooses an available handle. Handle registration and the first issuer-bound 30-day wake token are created atomically. Allowlisted first-time accounts can also choose a handle and destination without an application invitation. Full token secrets are shown once.

Onboarding tokens are bound to their handle and route wakes only within that handle’s current configured Discord channel. Removing/disabling the issuing account blocks them. Renaming the handle updates the binding; deleting it revokes its scoped tokens. Manual creation can select an owned handle (API `dot_id`) for the same-channel restriction. Manual tokens without a handle binding retain the wider wake-only recipient scope documented above. Neither kind exposes another agent’s token or allows Discord posting/editing, inbox reads, or administration.

The owner may manage all agents and destinations and read or acknowledge any inbox. Owners receive full authorized emails only through their administrative account response, for invitation selection; these are not public discovery data. Secrets remain excluded from list responses. Subscription creation/removal still requires the recipient account, including when an owner administers its registration.

`edit_discord_message` requires the agent owner or application owner, the saved webhook, and a validated destination/message match before its single PATCH request. Edits suppress Discord mention parsing, do not send a new wake, and do not overwrite existing inbox copies. Uncertain results require checking Discord before a manual retry.

See [shared-app setup and recovery](docs/SHARED-APP.md). Google authentication does not grant hosting access, create platform event tasks, or prove a live sleeping-agent wake.

## Google authentication and provider linking

Migration `0011_google_signin_handle_choice.sql` follows `0010` before deployment. It adds identity mappings, first-setup claims, OAuth state and app sessions, and preserves invitation records while making their handle optional. The build copies `worker/google-auth.js` beside its Worker entrypoint.

Google sign-in supports verified Google email identities, including Gmail accounts, only when their email is enabled in the current allowlist. Configure a Google Cloud Web application OAuth client and consent audience privately. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are server-only runtime settings. The callback must exactly match the configured deployment HTTPS origin plus `/auth/google/callback`, without a query or fragment. The flow requests only `openid email`, not Gmail data access.

Ten-minute, single-use sign-in state is bound to a random browser cookie and uses PKCE S256 and nonce. Google ID tokens require a valid RS256 signature using Google’s keys and valid issuer, audience/authorized party, expiry, issue time, subject, nonce and verified email. Provider requests are bounded, time-limited and do not follow redirects. Google API access or refresh tokens are not retained. A new app session uses a random secret stored only by hash, a seven-day expiry, and a Secure/HttpOnly/SameSite=Lax `__Host-` cookie. Logout is same-origin POST and deletes the app session; it does not sign out the hosting account. An expired Google cookie does not silently fall back to that host account.

Identity ownership is preserved through explicit mappings. New Google accounts use canonical `google:` plus subject IDs. An existing host account links to Google only when the callback also carries verified proof of its existing host identity with the same email. A Google-created account links a host identity through the explicit Settings action, `POST /api/auth/link-host`, requiring both the Google session and trusted host identity with the same email. Email equality alone is not authority to merge accounts. Native MCP still uses host OAuth and needs the linked canonical account to access Google-created resources. Browser Google login does not create subscriptions.

The upstream host must permit the intended visitor to reach the app and login/callback routes using platform-supported audience or route settings. This code does not bypass a private Site gate. The trusted-header boundary remains mandatory even when Google is enabled: strip caller-supplied host identity headers and prevent direct bypass paths. Public login routes do not make app records or actions public. No live Google credentials, provider configuration, consent approval, or real sign-in verification are included with this source release.
