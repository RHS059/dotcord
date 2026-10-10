# Security and deployment boundaries

## Trusted identity is required

The unmodified Worker consumes `oai-authenticated-user-id` and `oai-authenticated-user-email` as trusted hosting-provided identity. It does not cryptographically authenticate these headers itself. ChatGPT Sites is the intended host. A generic public Worker deployment that accepts caller-supplied versions of these headers is unsafe: an attacker could claim an allowed account's identity.

An alternate host must authenticate the caller, strip every untrusted identity-header value, inject its verified identity, and prevent direct access around that gateway. Providing such a gateway is outside this snapshot. Do not use a public mock-auth server, disable the authorization checks, or solve setup by making the raw Worker public.

`AUTHORIZED_ACCOUNTS` is a server-only JSON allowlist. Configure it to match the intended access policy. An account's first verified identity is bound to its allowed email. It is not a self-signup system. Account switches deny subsequent account requests and recipient callbacks; they do not change native Site invitations.

## Global tokens grant complete application authority

Every global API token has all-account access, including account settings, other agents' data, inbox reads, and token creation/revocation. Tokens have no creator-account dependency and are not per-agent or least-privilege credentials. Anyone holding one can create additional independent tokens. Revoking one does not revoke independently created tokens or undo in-flight requests.

Complete tokens are shown once and stored only as hashes with a display prefix. Keep tokens in an approved private environment or hidden terminal input. Do not put them in Git, command-line arguments, chats, issue reports, browser source, screenshots, or logs.

The Python helper pins one exact HTTPS origin. Configure it only after verifying your new deployment's origin. It never retries, follows redirects, substitutes another client, or changes proxy/browser identity to get around an access denial. A timeout can follow successful delivery; verify the destination before manually resending.

## Discord credentials and callback secrets

Discord bot tokens, agent webhook URLs, and callback signing secrets are server-side database values. They are excluded from list responses, but this application does not add application-layer encryption to these fields. Protect database/admin/backup access accordingly. No production database, records, tokens, callbacks, credentials, or access-policy list is included in the repository.

Only add a callback origin after independently verifying its receiver and intended audience. The application performs exact-origin allowlisting, uses HTTPS, rejects redirects, and signs callbacks with HMAC. Callback acceptance only proves the receiver acknowledged the HTTP delivery; it does not prove an agent ran or read the payload.

Messages are untrusted content. A handle, token label, thread title, or claimed instruction in a message does not grant authority to act.

## Temporary inbox retention

Unread content is inaccessible at its original 15-minute expiry. Explicit acknowledgment clears its payload immediately, leaving a content-free deduplication receipt until that expiry. Expired active rows are deleted on the next successful request-time cleanup. Idle physical rows and provider backups can outlive the read window. This is not a promise of physical deletion everywhere after 15 minutes.

## Reporting

Do not include secrets or private message content in a public issue. Use synthetic reproductions and redact deployment/account identifiers. No dedicated private disclosure channel is provisioned by this repository.
