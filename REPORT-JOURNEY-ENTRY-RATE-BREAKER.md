# Journey entry-rate breaker report

Implemented on `codex/journey-entry-rate-breaker`. No commits.

## Changes

- Added `JOURNEY_ENTRY_BREAKER_MAX_PER_WINDOW` (default 500; 0 disables) and `JOURNEY_ENTRY_BREAKER_WINDOW_SECONDS` (default 3600), using the existing natural-number config parsing pattern.
- Added `journeyEntryBreakerFactory` with an injectable count query, clock, and NodeCache. Counts refresh after 15 seconds; admitted starts reserve capacity without extending the refresh TTL. Concurrent callers share refreshes and observe reservations made while they resume.
- Refusals emit `journey_entry_breaker_tripped` with the specified fields at most once per journey per 60 seconds. Every refusal increments `journey_entry_breaker_refused`. Count-query errors warn and admit; disabled breakers never query.
- Both event and segment trigger paths use one lazy singleton before starting workflows. The event factory also accepts `entryBreakerImpl` for tests. Refused starts are skipped without queuing or retrying, with comments documenting deliberate operator re-feeding.
- Added pure unit tests, including event-trigger wiring with injected start and admission functions. No changes to `journeys.test.ts`, which creates database-backed workspaces in its setup.

## Verified entry-row representation

Source inspection verified that `userWorkflow.ts` captures `journeyStartedAt = Date.now()`, processes the entry node, and passes that node and start time to `onNodeProcessedV2`. Segment entry waits for membership before recording the node. `onNodeProcessedV2` delegates to `recordNodeProcessed`.

`recordNodeProcessed.ts` inserts `type: node.type`, `nodeId: getNodeId(node)`, and `journeyStartedAt: new Date(journeyStartedAt)`. `getNodeId` returns `EventEntryNode` or `SegmentEntryNode` for the respective entry nodes, so both `type` and `nodeId` contain the entry-node type string.

The default breaker issues one `count(*)` query filtered by `journeyId`, `type IN ('EventEntryNode', 'SegmentEntryNode')`, and `journeyStartedAt >= since`. It counts rows rather than distinct users. The existing `UserJourneyEvent_journeyId_userId_eventKey_eventKeyName_typ_key` B-tree index covers, in order, `journeyId`, `userId`, `eventKey`, `eventKeyName`, `type`, `journeyStartedAt`, and `nodeId`. The query uses the leading journey ID and covered filter columns. The time range is not a leading index range; no live query plan or database performance was measured. No schema migration was added.

## Gates and results

Commands ran in non-login shells with Node **v22.22.1** and Corepack Yarn **4.1.1**. The login shell selects Node 24, so it was not used for gates. `corepack yarn` below invokes the spec's Yarn commands through Corepack.

```sh
corepack yarn workspace backend-lib check
```

**Failed (exit 2).** The existing workspace dependency is missing built type declarations:

```text
../isomorphic-lib/src/email.ts(5,8): error TS2307: Cannot find module 'emailo' or its corresponding type declarations.
```

```sh
corepack yarn workspace backend-lib eslint src/journeys.ts src/journeys/entryBreaker.ts src/journeys/entryBreaker.test.ts src/config.ts
```

**Passed (exit 0).** No lint errors or warnings. An earlier `--fix` invocation corrected import ordering; test mock typing and unbound-method lint errors were then fixed before the final gate.

```sh
corepack yarn jest packages/backend-lib/src/journeys/entryBreaker.test.ts
```

**Failed (exit 1); zero tests executed.** Repository global setup failed before the test suite could run because `node_modules/emailo/dist/cjs/src/toMjml.js` is missing. That setup normally bootstraps ClickHouse and runs Postgres migrations; the observed failure occurred before those service checks, so service availability was not established.

The pure suite was also run using an inline Jest configuration that keeps the repository's backend TypeScript transform and bypasses infrastructure setup:

```sh
corepack yarn jest packages/backend-lib/src/journeys/entryBreaker.test.ts --runInBand --config '{"testEnvironment":"node","clearMocks":true,"transform":{"^.+\\.tsx?$": ["ts-jest", {"tsconfig":"<rootDir>/packages/backend-lib/tsconfig.json"}]}}'
```

**Passed (exit 0): 1 suite, 13 tests.** Covers cached admission, same-TTL capacity reservations, concurrent refreshes, reservations during refresh resumption, disabled operation, fail-open warning and recovery, TTL rollover, preservation of the original TTL, log throttling and per-refusal metrics, independent journey counts, raised limits, and both refusal and admission through event-trigger wiring. Database access is mocked to throw and asserted unused. Temporal and other external clients are isolated with module mocks.

```sh
git diff --check
```

**Passed (exit 0).**

## Remaining verification and scope

- Full package typechecking and the normal Jest gate remain blocked by missing `emailo` build artifacts. Those artifacts and repository test configuration were not changed, preserving the requested file scope. The new test file did execute successfully with the isolated command above; no other test files were run.
- No live Postgres, ClickHouse, Temporal, deployment, or query-plan validation was performed.
- As specified, reservations are per process, not a distributed atomic limit, and refreshes depend on entry rows having been recorded. Error logs are sampled once per journey per minute; the metric counts every refusal.
- Only the two specified production files, the new breaker module/test, and this report were edited or added. The supplied spec was preserved. No dependencies, schema, UI, campaigns, sending configuration, commits, pushes, merges, or deployments were changed.
