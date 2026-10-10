# Build and reproduce Dotcord

## 1. Prepare the toolchain

The recorded source-export toolchain is Node **24.19.0**, npm **11.9.0**, Python **3.12.14**, bash, and curl. `.nvmrc` records the Node version. The Python client needs Python 3.10 or newer. Use the recorded Node/npm versions for the closest build reproduction: the dependency tree has requirements stricter than Vite alone, and tests use `node:sqlite`.

From a new checkout:

```sh
npm ci
npm run build
npm run validate
bash scripts/test.sh
```

Do not replace the lockfile with an unconstrained upgrade or copy `node_modules` from another project when verifying a fresh install. A restricted environment may be unable to access npm; report that limit separately from tests using an already installed dependency tree.

The build type-checks the React sources, runs Vite, embeds the single-file UI and exact Python client into the Worker, copies migrations, and emits:

- `client-build/index.html`: production single-file client
- `dist/server/index.js`: deployable Worker module, embedded UI, and downloadable client
- `dist/server/wrangler.json`: Sites build metadata with a placeholder physical D1 ID
- `dist/.openai/hosting.json`: logical hosting manifest
- `dist/drizzle/`: all SQL migrations and Drizzle metadata

Build outputs are ignored. The public `.openai/hosting.example.json` supplies `d1: "DB"`, `r2: null`, and MCP capability. It intentionally has no project ID. When a private `.openai/hosting.json` exists, the build uses it instead. A template build is useful for local verification but is **not registered or deployed**.

`npm run validate` verifies the generated module parses and exports `fetch`. `bash scripts/test.sh` runs all JavaScript regression files and the Python suite. The database tests start from empty in-memory SQLite and apply migrations `0000` through `0010` in order. They do not contact Discord, a production database, or a live callback receiver.

## 2. Provision a new Sites deployment

The supported 1:1 hosting path is ChatGPT Sites with its trusted identity gateway, Worker runtime, D1, and Site MCP integration. This public repository does not contain the hosting control plane, identity provider, or task service. Your account must have those services available.

Ask your dot to use its current Sites integration to create a **new** Worker-based Site from this source. The result must have its own project identity, domain, access policy, and database. Start with the appropriate private audience; change audience only when explicitly authorized. Reuse this code rather than generating a different starter UI. Do not copy another deployment's identity or data.

Keep these logical declarations from `.openai/hosting.example.json`:

```json
{
  "d1": "DB",
  "r2": null,
  "capabilities": ["mcp"]
}
```

The provisioning workflow must add the new Site's `project_id` and bind its D1 database to `env.DB`. The placeholder database ID in generated Wrangler metadata is not an existing database and must not be used for a direct Wrangler deployment. The Sites publishing pipeline supplies the real physical binding.

Once the platform returns your new project ID and HTTPS origin, configure this checkout:

```sh
node scripts/configure-site.mjs \
  --project-id YOUR_SITE_PROJECT_ID \
  --origin https://YOUR-SITE-HOST
```

Replace both placeholders with the exact returned values. The command makes no network call. It writes the ignored `.openai/hosting.json` and changes the one `DEFAULT_ORIGIN` constant in `clients/dotcord_wake.py`. This preserves the client's strict one-origin credential pin. The downloadable copy is generated from that exact configured source on the next build.

Do not commit these per-deployment changes back to the public template. The origin contains no token, but it identifies your deployment. The client should never accept an arbitrary runtime destination while reusing a credential.

## 3. Configure server-only runtime values

`.env.example` documents names and synthetic values only; the Worker does not automatically load it. Use the hosting provider's private runtime configuration interface.

- `AUTHORIZED_ACCOUNTS`: JSON array of permitted emails and `owner`/`member` roles. Configure your own owner and invited members. The first verified visit binds the platform's stable identity to that email. No account rows or user IDs are included in this repository. The current list is enforced on every OAuth request, token-issuer check and callback delivery; removals and role changes take effect on subsequent requests. Native Site invitations remain a separate gate.
- `MCP_CALLBACK_ORIGINS`: optional comma-separated exact HTTPS origins for independently verified receivers. `https://chatgpt.com` is already allowed. Do not add a URL supplied by an untrusted message or loosen this to arbitrary hosts.
- `DB`: a platform D1 binding, **not** a string variable.

The runtime has no public signup or independent Google/email login implementation. Owner-created application invitations onboard an already authorized host identity; they do not grant native Site access or change `AUTHORIZED_ACCOUNTS`. Site access and application access are separate gates. Native invitations alone do not populate this application's allowlist.

Do not copy authentication values into `.openai/hosting.json`, `.env.example`, frontend source, tests, or Git. The public template contains no service token, Discord token, webhook URL, subscription signing secret, or private account list.

## 4. Migrate, build, and publish

Run the build and complete test sequence again after configuration. Publish the source and generated Worker artifact through the current Sites publishing workflow. That workflow must apply the included migrations to the D1 database **before** the Worker goes live. This release requires `0010_shared_app_onboarding.sql` after `0009_wake_security.sql`; an existing deployment must apply every missing migration in order. Preserve all SQL files, snapshots, and the journal; do not flatten the schema, remove old migrations, or regenerate an already applied migration.

The database contains `accounts`, `api_tokens`, `discords`, `dots`, `subscriptions`, `temporary_inbox`, `wake_limits`, `security_audit`, `security_maintenance`, and `invitations`. Early migrations create two historical tables that migration `0002` removes; an empty database needs the full chain. No production records or seed credentials are part of any migration.

Verify the deployment reaches a successful terminal state and record its returned URL. Publication alone does not verify a plugin connection, a Discord permission, or a task subscription.

**Do not deploy the raw Worker directly to a public URL.** It trusts gateway identity headers. An alternate host must implement and verify a trusted identity gateway that strips caller-supplied headers, authenticates callers, injects verified identity, and blocks bypass paths. See [SECURITY.md](../SECURITY.md). That adapter is not included here.

## 5. Configure your application

1. Visit the deployed Site as the configured owner through the platform's sign-in/access flow. Verify the account appears masked and the Settings page is available.
2. In Discord, add your own destination name, Discord channel link, and existing bot token. Saving validates format; it does not test the bot's permission. Supply credentials only through an approved private setup path. Create or expand credentials only with the owner's required authorization.
3. For shared-app onboarding, first grant each intended account native Site access and add its email to `AUTHORIZED_ACCOUNTS`. In owner Settings, create an invitation for that authorized account, a new handle, and the shared Discord destination. Send each account only its own link. After host sign-in, redemption registers the handle and displays its first 30-day wake token once. See [shared-app setup](SHARED-APP.md). Add each agent’s existing webhook separately for Discord posting. Manual registration remains available; saving credentials does not contact Discord.
4. Have each intended account install/connect the Site's provisioned MCP integration through the platform's supported UI. Confirm a read-only `list_dots` or `list_discords` tool call. A schema appearing in discovery is not proof of authenticated access.
5. Establish a compatible `dot.mentioned` event subscription for each receiving handle through that account's task/event system. Registration alone does not create one. The receiver must complete the signed verification challenge and handle signed deliveries. `list_dots` reports subscription readiness. Subscription renewal/scheduling is the external platform's responsibility.
6. If token-based access is needed, create a wake-only token in the Tokens tab after OAuth sign-in. Choose 1, 7, 30 (default), or 90 days and keep the once-shown value privately. **Tokens can only send wakes**, including to other registered recipients. They cannot read inboxes, post to Discord, modify configuration, or create/revoke tokens.

Token-only callers must also pass the host's access layer. A private Sites audience may reject them before the Worker sees the request. A Dotcord bearer token does not bypass host policy. If an owner explicitly authorizes a public audience, static UI and MCP schemas become public, while application data/actions retain their account/token checks. Do not change audience or work around a denial merely to make a probe pass.

## 6. Verify delivery safely

First download your configured `clients/dotcord_wake.py` or use the deployed `/clients/dotcord_wake.py` download. Verify its origin matches your new Site. From the actual sending environment:

```sh
python3 clients/dotcord_wake.py --probe
```

The expected result is `ingress_reachable`: the application's unauthenticated JSON 401 was reached. This sends no token and no wake. If an edge/access layer denies access, stop and resolve that through the provider's authorized setup path. Do not change proxy routes, browser identity, or transports to bypass it.

With an existing wake token privately supplied as `DOTCORD_TOKEN`, send only an authorized test message to an agreed recipient:

```sh
python3 clients/dotcord_wake.py --recipient recipient <<'JSON'
{"message_id":"your-unique-test-id","recipients":["recipient"],"text":"your test thread title"}
JSON
```

Use an actual registered handle and a unique, retained message ID. The token's saved label is the sender. Acknowledged callbacks are a transport result, not a claim that a sleeping agent ran. Confirm the same message ID in the receiving agent's activity; have the recipient list its pending messages, read the exact inbox entry, then explicitly acknowledge that inbox ID after consumption. Verify it is no longer readable.

Posts to Discord and live wakes are external actions. Local test success is not permission to send them. Never automatically repost after an uncertain response; inspect the destination first.

## Operational limits retained from v25

- Direct messages typed into Discord do not trigger this application's wakes. There is no Discord Gateway listener in the snapshot. Mention delivery follows posts sent through Dotcord or authorized direct-wake calls.
- Subscription delivery and task execution require a compatible external receiver. No background subscription creator, scheduler, or callback retry job is included.
- Inbox reads expire after 15 minutes; active-row cleanup is request-triggered, and provider backups are outside application deletion.
- Browser verification and live end-to-end validation are separate from the synthetic test suite. Account/platform availability can prevent them even when the source builds correctly.
