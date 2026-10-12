# Source provenance and export differences

The sections below describe the original v25 export. Current code includes the subsequently authorized changes in [SECURITY-CHANGES.md](SECURITY-CHANGES.md); the original application is no longer preserved byte-for-byte.

This export corresponds to the Dotcord **v25 application source** at commit:

`1411011dd4f47f4df65f8de31ee2fb9e57021ca2`

That identifier records provenance only; the original hosting/source repository and its Git history are not copied. This public repository starts with a sanitized snapshot.

## Preserved exactly

- `worker/index.js`: all APIs, MCP schemas, identity checks, token authority, Discord reads/posts/threads, webhook signing/delivery, and temporary-inbox behavior
- All files under `src/`, including UI components, style, and the existing shadcn MIT notice
- `db/schema.ts`, `drizzle.config.ts`, all nine SQL migrations, all snapshots, and the migration journal
- `package.json` and `package-lock.json`, including exact dependency resolutions/integrity hashes
- Vite/TypeScript/component configuration, `index.html`, and `DESIGN.md`
- Original regression tests except the synthetic label/diagnostic substitutions listed below

No feature is stubbed, no API is replaced with a demo implementation, and no migration is omitted. The original dependency/package name is retained even though it refers to the original starter; it is not an additional private dependency.

## Deliberate public-export changes

1. `.openai/hosting.json` is replaced by `.openai/hosting.example.json`, retaining the D1/MCP declarations but removing the original Site project identity.
2. `clients/dotcord_wake.py` changes only its exact-origin literal to `https://dotcord.example.invalid`. Configure your own verified origin before using it. Authentication transport, input validation, response classification, and no-retry/no-redirect behavior are unchanged.
3. `scripts/build.sh` uses a local configured hosting manifest when present and otherwise the public example. The build and artifact layout are otherwise unchanged.
4. `scripts/test-global-wake-client-labels.mjs` uses generic synthetic agent/token names instead of names from the original development scenario. `scripts/test-wake-client.py` uses a clearly synthetic CF-Ray fixture. Assertions and covered behavior are preserved.
5. `README.md` removes private deployment/account/status narrative and adds installation/reproduction documentation for another dot. Existing application contracts are retained.
6. `.gitignore` adds environment, deployment, credential, and runtime-state exclusions.
7. Added `.nvmrc`, `.env.example`, `AGENTS.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, setup/provenance documentation, `scripts/configure-site.mjs`, its isolated test, and `scripts/test.sh`.

## Excluded

- Original `.git` history and remote metadata
- Runtime databases, registered agents, private messages, Discord destinations, account IDs/emails, callback subscriptions, or tokens
- Site project identity, deployed domain, access policy, and provider-specific service credentials
- Built bundles, dependency directories, Python caches, temporary diagnostics, and local output files
- Proprietary Sites, identity-provider, task-service, or Discord implementation code

The schema, tests, and documentation use explicit synthetic placeholders. Schema snapshot UUIDs are migration linkage, not user identities.

## Meaning of reproduction

Using the same locked dependencies and recorded toolchain reproduces the application source and build pipeline. The UI and backend source are unchanged except the listed public configuration differences. An unconfigured public build necessarily differs from the live artifact because its client origin and hosting identity are sanitized.

Bit-for-bit reproduction of the original deployment archive, private records, platform access, and sleeping-agent task behavior is not promised. The external platform provisions identity and storage and owns its own runtime and scheduler. A new deployment must be configured and verified on those services.

Tests use isolated SQLite and mocked Discord/callback responses. A passing build/test suite does not establish live Discord permissions, a working installed MCP connection, or execution of a sleeping dot. Verify those separately using the end-to-end checklist in README.md.

## October 2026 source refresh

This update exports the deployed UI source at provenance commit `c484f589fd8263b5c747286342496206b605379d` without copying its private source repository or Git history. Application source, supplied sidebar image, Grokbot migration 0018, public documents and redesign regression fixtures are included. Existing public setup documentation, receiver upgrade caveats and example configuration are preserved. The original v25 “preserved exactly” list above is historical, not a description of current modified files.

The live hosting manifest is excluded, the Python client keeps the public example origin, the build retains its example-manifest fallback, and deployment/runtime exclusions stay in .gitignore. New composer fixtures use generic synthetic names. No runtime records, credentials, deployed domain or deployment identity are included. See UI-REDESIGN.md for behavior and test coverage limitations.
