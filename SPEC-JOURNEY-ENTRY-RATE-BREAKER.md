# SPEC: Journey entry-rate breaker

Date: 2026-09-21. Branch `codex/journey-entry-rate-breaker`. Implementer: Codex. No new deps, no commits, no schema migration, no dashboard UI. Follow AGENTS.md (typecheck + eslint on touched packages; state exact commands and results).

## Why (verified incident)
On 2026-09-11/12 an upstream feed change made the portal emit ~15.6k `quiz_completed_unpaid` events in ~20 hours. Every one of them entered the event-entry journey "Abandoned quiz → purchase" and ~46k emails went out. Nothing on the sending side could refuse a burst. Ian's decision (2026-09-21): journeys get an **entry-rate breaker** — when a journey admits more users than a per-window limit, further entries are refused (not queued) and loudly logged, until the window rolls or the limit is raised.

## Where
`packages/backend-lib/src/journeys.ts`:
- `triggerEventEntryJourneysFactory` — before `startKeyedJourneyImpl(...)` for each matched journey.
- `triggerSegmentEntryJourney` — before `workflowClient.signalWithStart(...)`.

## Design
1. Config (`packages/backend-lib/src/config.ts`, same pattern as `defaultUserJourneyMaxAttempts`):
   - `journeyEntryBreakerMaxPerWindow` — env `JOURNEY_ENTRY_BREAKER_MAX_PER_WINDOW`, integer, default **500**. `0` disables the breaker.
   - `journeyEntryBreakerWindowSeconds` — env `JOURNEY_ENTRY_BREAKER_WINDOW_SECONDS`, default **3600**.
2. New module `packages/backend-lib/src/journeys/entryBreaker.ts` exporting `journeyEntryBreakerFactory({ countRecentEntriesImpl, nowImpl, cache })` → `async function admit({ workspaceId, journeyId, journeyName, userId }): Promise<boolean>`.
   - Source of truth for the window count: `countRecentEntriesImpl({ journeyId, since })` — default implementation counts `UserJourneyEvent` rows for that `journeyId` whose `type` is the entry node type (`EventEntryNode` or `SegmentEntryNode` — verify in `journeys/userWorkflow.ts` / `recordNodeProcessed.ts` what `type` and `nodeId` are written when the entry node is processed, and count on that) with `journeyStartedAt >= since`. One indexed query; check the existing indexes on `UserJourneyEvent` and use the columns they cover.
   - The count is cached per journeyId in a `NodeCache` (TTL 15 s). Between refreshes, a per-journey in-process counter of admitted starts is added to the cached count so a burst inside one TTL cannot overshoot: `admit` returns false when `cached + admittedSinceRefresh >= max`.
   - When refusing: `logger().error({ workspaceId, journeyId, journeyName, userId, count, max, windowSeconds }, "journey_entry_breaker_tripped")`, increment an OpenTelemetry counter `journey_entry_breaker_refused` (same helper style as `journeyTriggerCounter()`), and return false. Log the error at most once per journey per 60 s (rate-limit the log, not the refusal); refusals still increment the metric each time.
   - Breaker disabled (`max === 0`) → always true, no DB query.
   - If the count query throws, log a warn and ADMIT (fail open) — the breaker must never make the platform stop sending because Postgres hiccupped.
3. Wire it in `journeys.ts`: a module-level singleton breaker built lazily from config; both trigger paths call `admit` and skip the start when false. In `triggerEventEntryJourneysFactory` allow injecting the breaker (`entryBreakerImpl` option, default singleton) for tests, matching how `startKeyedJourneyImpl` is injected.
4. Refused users are not queued or retried; the error log carries `userId` so an operator can re-feed them deliberately. Say so in a comment.

## Tests
New `packages/backend-lib/src/journeys/entryBreaker.test.ts`, pure unit tests with an injected `countRecentEntriesImpl` and `nowImpl` (no Postgres, no Temporal):
a. below the limit → admit true; count query called once per TTL (second call within TTL uses cache).
b. count = max−1, two admits in the same TTL → first true, second false (in-process counter).
c. disabled (max 0) → true, count never queried.
d. count query throws → warn + true.
e. TTL rolled + fresh count below limit → true again.
Also a test in `journeys.test.ts` style ONLY IF it can run without the DB; otherwise cover the wiring in `triggerEventEntryJourneysFactory` by a unit test that injects `startKeyedJourneyImpl` and `entryBreakerImpl` (a stub returning false must prevent the start).

If the jest global setup requires Postgres/ClickHouse/Temporal that are not available on this machine, do not fight it: run what runs, and record in the report exactly which test files could not be executed and why.

## Gate (paste commands and results into `REPORT-JOURNEY-ENTRY-RATE-BREAKER.md`)
```
yarn workspace backend-lib check
yarn workspace backend-lib eslint src/journeys.ts src/journeys/entryBreaker.ts src/journeys/entryBreaker.test.ts src/config.ts
yarn jest packages/backend-lib/src/journeys/entryBreaker.test.ts
```
Report: what changed, what was verified about `UserJourneyEvent` entry rows, test counts, anything not done. Do NOT commit.
