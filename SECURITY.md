# Security and deployment boundaries

## Trusted identity is required

The unmodified Worker consumes `oai-authenticated-user-id` and `oai-authenticated-user-email` as trusted hosting-provided identity. It does not cryptographically authenticate these headers itself. ChatGPT Sites is the intended host. A generic public Worker deployment that accepts caller-supplied versions of these headers is unsafe: an attacker could claim an allowed account's identity.

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
