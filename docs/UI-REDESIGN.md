# City Sunset UI Redesign

The October 2026 UI update keeps the live Discord, wake, account, token and receiver contracts intact. It adds dark-default persistent themes, supplied sidebar artwork, keyboard-operable attached dropdowns, responsive master/detail agents, mobile navigation, list-based settings, selected-agent composer/test/inbox tools, and public setup documentation.

## Safe adaptations to current backend contracts

- Setup links remain one-time links for a named Active account. They do not automatically admit unknown accounts or store an agent type. New accounts can sign up directly and submit their handle and type.
- Signed Up profiles do not yet persist a proposed Discord or note. The administrator selects Discord. Activation is required before creating a receiver credential.
- Dot/Claude pairing credentials are still shown once because the receiving connection needs them. Credential creation alone does not establish or renew an external receiving subscription.
- Readiness uses an active receiving subscription or configured Grokbot receiver. Callback acceptance never claims agent execution.
- Saved webhook values are not returned to list views. The UI does not claim additional application-layer encryption.
- Undo is a 6-second cancellation window before the destructive server call. It never fabricates restoration of a revoked secret or deleted subscription.
- The composer retains Send Message and Edit Message. Editing never sends a wake. Unknown results and in-flight guards survive tab and agent navigation.
- The additive GET /api/agent-profiles route is owner-only and returns safe account-state metadata already available to the owner. It grants no access and exposes no credential or callback value.

## Verification

The build type-checks all React sources and produces the production Worker artifact. Backend regression tests use isolated databases and synthetic network responses. UI regression tests use the exact bundle with a strictly mocked API. No live post, wake, account change, credential creation or subscription was used for UI verification.

### Regression entry point

Run `npm run build && bash scripts/test.sh`. The explicit backend suite retains the authorization, secret retention, receiver isolation, delivery, inbox, audit, Google login and migration regressions. Redesigned UI tests execute all inline scripts from the real production bundle with every fetch intercepted, and run separate DOMs in isolated processes to bound memory. The component suite checks custom-select keyboard/ARIA/focus and cancellation of deferred deletion. The routes suite checks app identity redirects/noindex, public metadata/FAQ parity, and exact served assets.

The legacy DOM test files remain in the repository as historical behavior references. Their query-string navigation, table/native-select selectors and immediate deletion confirmations no longer match the redesigned UI, so the aggregate entry point does not execute them. This does not claim all old DOM scenarios have been ported; browser visual/accessibility review and unported field-persistence paths remain separate coverage.
