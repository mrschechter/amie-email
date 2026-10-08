Implemented Nicholate's October 8, 2026 request on `codex/provider-analytics`. Local code changes only; no push, PR, merge, deployment, provider configuration, sending identities, or campaign/template content changes.

Provider/domain reporting:

- SQL maps lowercased recipient domains to Google, Microsoft, Yahoo, AOL, Apple, AT&T, Comcast, and Other using the requested exact domains and anchored multi-label suffix matches.
- `AnalyticsResponse.providers` and `.domains` carry the new breakdowns independently of `.rows`. Domain queries retain source dimensions, then reuse the existing broadcast-journey normalization and source filter before aggregation. Broadcast-owned journeys are excluded from flow details.
- Both deliverability and individual broadcast/journey Performance screens show By provider first and Top domains second. Top domains keeps the 15 literal domains with most sends, combining remaining/missing domains into `other`.
- Hard (`Permanent`), soft (`Transient`), and unknown bounce counts are aggregated and displayed as count/rate table cells alongside existing metrics. Total bounces still include unclassified events.

Unsubscribe attribution:

- Liquid unsubscribe/management tags and HTTPS/HTTP List-Unsubscribe URLs carry an optional `attribution` token containing original messageId, journeyId, broadcastId, templateId, nodeId, and recipient email where known.
- The token is HMAC-SHA256 signed with the existing subscription secret, a purpose marker, and the existing identity hash. Identity hash validation is unchanged and runs before metadata is accepted. Tokens cannot select a different user or modify subscription actions. Invalid/tampered metadata is discarded while a correctly authenticated user can still unsubscribe.
- The token passes through API GET, one-click POST, browser form POST (including custom forms posting to the original query URL), public dashboard page, and PUT updates. Only verified metadata reaches `updateUserSubscriptions`, then the event builders. Hidden form values are HTML-escaped.
- SES complaint/permanent-bounce suppression events receive the original message metadata without changing suppression policy or their stable event IDs.
- Event-level messageId remains the unique event/deduplication ID; `properties.messageId` is the original send ID. Existing `message_events_slim` already resolves this property and includes DFSubscriptionChange. Existing analytics deduplicates Unsubscribe events by resolved message ID, including opt-outs across multiple groups. No MV migration or backfill is needed.
- Legacy links and events without metadata retain existing behavior. The UI says attribution starts with new links and automatic suppressions after the October 8, 2026 update is deployed; old unsubscribes are not backfilled.
- Mailto attribution was skipped as allowed: the inbound processor reads the inbound Message-ID and sender but has no original-message correlation lookup. Correctly correlating References/In-Reply-To with SES/internal send IDs and ownership would require additional lookup work. Mailto unsubscribe behavior is unchanged.

Validation (Node 22 via `PATH=/usr/bin:$PATH`; commands run from this worktree):

```bash
PATH=/usr/bin:$PATH corepack yarn jest --config .tmp/provider-unit.jest.config.cjs --runInBand packages/backend-lib/src/analytics.unit.test.ts packages/backend-lib/src/subscriptionAttribution.test.ts packages/backend-lib/src/destinations/amazonses.test.ts packages/backend-lib/src/liquid.test.ts packages/backend-lib/src/messaging/unsubscribeHeaders.test.ts packages/api/src/controllers/subscriptionManagementController.test.ts packages/api/src/controllers/analysisController.unit.test.ts
```

Result: exit 0, 7 suites passed, 118 tests passed, 1 pre-existing skipped test, 7 snapshots passed. The skip is liquid.test.ts's existing “when inlining a file” describe.skip. Three analytics SQL snapshots were updated earlier to reflect the new metrics and domain query.

```bash
PATH=/usr/bin:$PATH corepack yarn jest --config .tmp/provider-unit.jest.config.cjs --runInBand packages/backend-lib/src/analytics.unit.test.ts packages/api/src/controllers/subscriptionManagementController.test.ts
```

Result after adding 8 explicit provider cases and the custom-form query fallback: exit 0, 2 suites passed, 48 tests passed, 7 snapshots passed. Tests exercise each requested provider family, wildcard boundaries, top-15 aggregation, broadcast fallback mapping, flow exclusion, and all public controller transports.

```bash
PATH=/usr/bin:$PATH corepack yarn jest --config .tmp/provider-unit.jest.config.cjs --runInBand packages/backend-lib/src/messaging/listIdHeader.test.ts
PATH=/usr/bin:$PATH corepack yarn jest --config .tmp/provider-dashboard.jest.config.cjs --runInBand packages/dashboard/src/components/analytics/kpiCard.test.tsx
PATH=/usr/bin:$PATH corepack yarn jest --selectProjects backend-lib-jsdom --runInBand --runTestsByPath packages/backend-lib/src/jsdom-tests/subscriptionManagementPage.test.ts
```

Results: exit 0 for each; respectively 3, 1, and 22 tests passed. Across these focused files, 153 distinct tests pass and 1 existing test remains skipped.

```bash
PATH=/usr/bin:$PATH corepack yarn test:file packages/backend-lib/src/subscriptionGroups.test.ts --runInBand
```

Result: exit 1 before tests in database globalSetup, AggregateError EPERM under the network sandbox. A subsequent permitted TCP-only check of 127.0.0.1:5432 and :8123 returned ECONNREFUSED for both. Database-backed subscription/messaging integration tests and execution of the generated SQL against ClickHouse could not run. The mapping-expression and filtered report assembly tests above run without databases. The database log is `.tmp/20261008-103819-subscriptionGroups.test.log`.

```bash
PATH=/usr/bin:$PATH corepack yarn workspace backend-lib eslint src/analytics.ts src/analytics.unit.test.ts src/analyticsHelpers.ts src/recipientProviders.ts src/destinations/amazonses.ts src/destinations/amazonses.test.ts src/liquid.ts src/messaging.ts src/messaging/email.ts src/subscriptionGroups.ts src/subscriptionManagementPage.ts src/subscriptionManagementTemplate.ts src/subscriptionAttribution.ts src/subscriptionAttribution.test.ts src/types.ts
PATH=/usr/bin:$PATH corepack yarn workspace api eslint src/controllers/subscriptionManagementController.ts src/controllers/subscriptionManagementController.test.ts src/controllers/analysisController.unit.test.ts
PATH=/usr/bin:$PATH corepack yarn workspace isomorphic-lib eslint src/analytics.ts src/types.ts src/subscriptionMessageMetadata.ts
PATH=/usr/bin:$PATH corepack yarn workspace dashboard eslint src/components/analytics/analyticsLayout.tsx src/components/analytics/analyticsPage.tsx src/components/analytics/performancePanel.tsx src/components/analytics/performanceTable.tsx src/components/analytics/providerTables.tsx src/components/analytics/kpiCard.test.tsx src/components/subscriptionManagement.tsx src/pages/public/subscription-management.page.tsx
```

Results: all exit 0 with zero errors. Backend retains 8 existing warnings (nullish/optional checks, throw style and non-null assertion); dashboard retains 1 existing nullish-coalescing warning. API and isomorphic-lib have no warnings. Liquid scope types were narrowed at the library boundary, an unused import removed, and existing provider/render assertions received explicit local lint annotations to address pre-existing lint errors in touched files without changing provider behavior.

```bash
PATH=/usr/bin:$PATH heavy-run -- corepack yarn workspace isomorphic-lib tsc --noEmit -p .
PATH=/usr/bin:$PATH heavy-run -- corepack yarn workspace backend-lib tsc --noEmit -p .
PATH=/usr/bin:$PATH heavy-run -- corepack yarn workspace api tsc --noEmit -p .
PATH=/usr/bin:$PATH heavy-run -- corepack yarn workspace dashboard tsc --noEmit -p .
PATH=/usr/bin:$PATH heavy-run -- corepack yarn workspace isomorphic-lib build
PATH=/usr/bin:$PATH heavy-run -- corepack yarn workspace backend-lib build
git diff --check
```

Results: all exit 0; all four final typechecks emit no diagnostics. Builds refresh local dependency declarations only. heavy-run required sandbox escalation for its existing shared lock directory; its limits remained enabled. The initial node_modules link resolved workspace packages to another lane; local links were isolated before validation, and unchanged emailo build artifacts were copied locally. No source/dependency files in the other checkout were modified. Initial stale-type and a test-only HTTPS URL assumption failure were fixed before the successful runs above. No browser visual session was run.

The temporary no-globalSetup configs remain in `.tmp`. For reproduction, `.tmp/provider-unit.jest.config.cjs` contains:

```javascript
module.exports = {
 rootDir: "..", testEnvironment: "node", clearMocks: true,
 setupFilesAfterEnv: ["jest-expect-message"],
 moduleNameMapper: {
   "^isomorphic-lib/src/(.*)$": "<rootDir>/packages/isomorphic-lib/src/$1",
   "^backend-lib/src/(.*)$": "<rootDir>/packages/backend-lib/src/$1",
 },
 transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/packages/backend-lib/tsconfig.json" }] },
};
```

`.tmp/provider-dashboard.jest.config.cjs` contains:

```javascript
module.exports = {
 rootDir: "..", testEnvironment: "jsdom", clearMocks: true,
 setupFilesAfterEnv: ["jest-expect-message"],
 moduleNameMapper: {
   "^isomorphic-lib/src/(.*)$": "<rootDir>/packages/isomorphic-lib/src/$1",
   "^backend-lib/src/(.*)$": "<rootDir>/packages/backend-lib/src/$1",
   "\\.css$": "<rootDir>/packages/dashboard/test/__mocks__/styleMock.ts",
 },
 transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/packages/dashboard/tsconfig.json" }] },
};
```

Final validation output is retained in `/tmp/provider-unit-tests.log`, `/tmp/provider-final-targeted-tests.log`, `/tmp/provider-listid-tests.log`, `/tmp/provider-dashboard-tests.log`, `/tmp/provider-page-tests.log`, and `/tmp/provider-{backend,api,isomorphic,dashboard}-{lint,tsc}.log`.

Changed files:

- `packages/api/src/controllers/analysisController.unit.test.ts`
- `packages/api/src/controllers/subscriptionManagementController.test.ts`
- `packages/api/src/controllers/subscriptionManagementController.ts`
- `packages/backend-lib/src/__snapshots__/analytics.unit.test.ts.snap`
- `packages/backend-lib/src/analytics.ts`
- `packages/backend-lib/src/analytics.unit.test.ts`
- `packages/backend-lib/src/analyticsHelpers.ts`
- `packages/backend-lib/src/destinations/amazonses.test.ts`
- `packages/backend-lib/src/destinations/amazonses.ts`
- `packages/backend-lib/src/liquid.ts`
- `packages/backend-lib/src/messaging.ts`
- `packages/backend-lib/src/messaging/email.ts`
- `packages/backend-lib/src/recipientProviders.ts`
- `packages/backend-lib/src/subscriptionAttribution.test.ts`
- `packages/backend-lib/src/subscriptionAttribution.ts`
- `packages/backend-lib/src/subscriptionGroups.ts`
- `packages/backend-lib/src/subscriptionManagementPage.ts`
- `packages/backend-lib/src/subscriptionManagementTemplate.ts`
- `packages/backend-lib/src/types.ts`
- `packages/dashboard/src/components/analytics/analyticsLayout.tsx`
- `packages/dashboard/src/components/analytics/analyticsPage.tsx`
- `packages/dashboard/src/components/analytics/kpiCard.test.tsx`
- `packages/dashboard/src/components/analytics/performancePanel.tsx`
- `packages/dashboard/src/components/analytics/performanceTable.tsx`
- `packages/dashboard/src/components/analytics/providerTables.tsx`
- `packages/dashboard/src/components/subscriptionManagement.tsx`
- `packages/dashboard/src/pages/public/subscription-management.page.tsx`
- `packages/isomorphic-lib/src/analytics.ts`
- `packages/isomorphic-lib/src/subscriptionMessageMetadata.ts`
- `packages/isomorphic-lib/src/types.ts`
- `PROVIDER_ANALYTICS_SUMMARY.md` (this requested output summary; no -o path was supplied).
