# Dedicated Dotcord receiver

This dedicated, owner-private Sites app pairs one receiving platform connection with an account in shared Dotcord. Sites provides the trusted identity and OAuth gateway. Shared Dotcord remains responsible for account settings, credential generation, message inboxes and delivery. This app never invents a callback URL or signing secret. Token replacement keeps its existing, still-authorized wake setup.

## Private browser pairing

1. Create a new private Sites project for this receiver, separate from shared Dotcord. Copy `.openai/hosting.example.json` to the ignored `.openai/hosting.json`, set the newly returned project ID, and retain the DB/MCP declarations. For an existing receiver, preserve that receiver’s project ID, database and private audience. Configure `DOTCORD_ORIGIN` as the exact shared Site HTTPS origin, without a trailing slash or path. Optionally configure `EXPECTED_ACCOUNT_BINDING` to the intended shared account's nonsecret binding, verified separately.
2. The user opens shared Dotcord, selects the intended account, and generates a credential under **Settings → Wake receiver credentials**. Shared Dotcord displays that credential only once.
3. The user opens this private receiver Site, pastes the credential into its password field and presses **Validate and pair receiver**. The agent must not retrieve, handle or submit the user's token. The server validates the token with the configured shared origin before saving it to D1. Successful first submission atomically pins the caller's trusted, Site-specific subject. Merely opening the page never pins an account.
4. The page returns only the paired handle and wake status. The credential is not returned in HTML, API responses or MCP results. It is never placed in browser storage, logs or source. The form clears on submission and navigation. Later replacement is available only to the same pinned identity and same shared account, and is validated before changing the saved token. Concurrent setup or replacement returns a conflict instead of overwriting another completed setup.
5. Connect this receiver's native connector in the receiving platform. Create its `dot.mentioned` subscription with empty arguments `{}`. The platform supplies and verifies the callback and signing secret and must renew before expiry. Pairing alone does not create a wake task. Check `receiver_ready` and `receiver_subscriptions` using `get_receiver_status`; general account readiness alone can reflect another receiver.
6. Verify an authorized end-to-end mention and actual receiver execution. Read and acknowledge inbox messages with the existing shared Dotcord tools. This app deliberately exposes only receiver status and subscription operations.

Subjects are different across Sites. The pasted upstream credential provides the explicit account binding; neither email nor cross-site subject equality is used to guess ownership.

## Runtime and build

- `DOTCORD_ORIGIN`: Required, exact HTTPS shared Site origin.
- `EXPECTED_ACCOUNT_BINDING`: Optional guard requiring the shared account binding to match during validation/status.
- `DOTCORD_SITES_TOKEN`: Optional private host service-access credential, only when the upstream Site requires it. It goes solely to that exact origin as `OAI-Sites-Authorization`. It does not provide account identity. Do not configure an empty string.
- `DB`: Sites-managed D1 binding, declared in `.openai/hosting.json`. `drizzle/0000_receiver_pairing.sql` creates the singleton pairing table; `0001_receiver_continuity.sql` adds private retry proofs, a stable receiver identity and a bounded operation lease. Only the private server reads the token column.
- `RECEIVER_SUBJECT`, `DOTCORD_RECEIVER_TOKEN`: Legacy server configuration remains supported before browser setup. An existing subject is enforced on all reads and writes; it cannot be overwritten by another identity. A successful browser submission saves the replacement in D1 and retains that subject. A conflict between a configured subject and a saved pin fails closed.

Run `npm test` (Node with `node:sqlite` support), then `npm run build`. Build output contains `dist/server/index.js`, Worker binding metadata, `dist/.openai/hosting.json`, and `dist/drizzle/` SQL plus migration metadata. Publish using the selected Site's source helper and native owner-private deployment path. Never reuse another receiver's project ID, database, OAuth subject, lineage identity or runtime credentials. Never deploy this Worker directly outside the trusted Sites gateway. Schema migrations are applied by Sites, not by request handlers.

## Security properties and limits

All setup routes require the gateway-authenticated visitor. After pairing, the page, setup status, identity status and every MCP request require the pinned subject. Initial MCP discovery exposes only static schemas until pairing. Setup POST additionally requires an exact same-origin `Origin`, JSON content type, a small bounded body and no extra fields. MCP browser calls reject foreign origins. SQL uses bound values. The singleton key makes initial pinning atomic; replacement checks both subject and revision. No agent-facing setup tool or token-reading endpoint exists.

Upstream requests use the fixed configured origin, refuse redirects, send no inbound cookies or identity headers, and have bounded response sizes/timeouts. Status responses are allowlisted and token echoes rejected; arbitrary upstream/DB/network error details are never returned. The server necessarily stores the credential for future wake subscription renewal, in the private D1 database. Gateway access, private Site audience and account isolation are prerequisites, not optional hardening.

The tests cover authentication, wrong identities, CSRF, body validation, validation failures, replacements, first-setup and replacement races, legacy pinning, secret non-disclosure, callback forwarding and deployment data shape. They do not prove hosted OAuth behavior or a sleeping-agent wake. Browser handoff and an actual platform subscription are still required for end-to-end verification.


## Credential replacement without repeated wake setup

Deploy shared Dotcord migration `0016_receiver_continuity.sql` and its Worker first, then this companion's `0001_receiver_continuity.sql` and Worker. Existing pairing subjects, credentials, account bindings and revisions are preserved. The migration gives each existing pairing a fresh private lineage identity. On the next authorized status check, the companion establishes the shared revision fence and adopts a single existing credential-bound callback without changing any of its delivery settings or expiry. Multiple ambiguous legacy callbacks fail closed instead of being guessed or merged.

A valid same-account replacement advances that receiver's shared lineage and resumes only its unexpired registrations. Revoked/expired credentials remain unusable; other valid credentials are not revoked globally. A delayed old subscribe/unsubscribe cannot overwrite the current binding, including when rotation happened before the first callback was registered. Each established receiver remains isolated even if a credential was accidentally reused elsewhere. Use one dedicated credential per receiver for unambiguous legacy setup.

If restoration has an uncertain result, the page says it is pending. Server-only prior-token proofs remain available for an idempotent status retry and are cleared after confirmation. They are never returned to the browser or MCP client. A concurrent setup/event operation may return a retryable conflict. A legacy runtime-only receiver without a stored account binding needs its valid old credential or an explicitly verified `EXPECTED_ACCOUNT_BINDING` for the first browser replacement; it cannot infer a revoked credential's account.

The receiving platform must still authorize the initial task and renew its normal TTL. Expired or explicitly canceled callbacks are not revived, and replacing a token never extends an existing lease. A successful synthetic test is not evidence of an actual sleeping-agent wake.


### Narrow legacy first-subscribe upgrade limit

An already-registered receiver upgrades by adopting its preserved callback. For a receiver that has never registered a callback, finish or quiesce old-version subscription requests before replacing its token and upgrading. A first-subscribe request already in flight from the old, untagged protocol can otherwise arrive after the upgraded app initialized under a different token and leave an unbound callback row. This legacy-only case requires the receiving platform to cancel the stale registration and renew the intended one; token replacement must not guess or copy its callback. Established callbacks and all lineage-aware requests have the atomic revision fence described above.
