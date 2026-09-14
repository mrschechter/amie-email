# Message analytics slim table (v1)

The 2026-09-14 production report measured 45–55-second overview requests:
`DFInternalMessageSent.properties` averaged 84 KB and occupied 5.4 GB over
14 days. Repeated JSON extraction dominated despite a fast PREWHERE scan.

`src/userEvents/messageEventsSlim.ts` contains the complete table and MV DDL.
`createUserEventsTables()` installs both on fresh bootstrap, after source and
destination tables exist. This is an additive v1 schema using the existing
`CREATE ... IF NOT EXISTS` convention. Existing boxes use the script below;
there is no historical POPULATE and no need to rerun old release upgrades.

The table has no partition, uses MergeTree, and is ordered by
`(workspace_id, event_time, resolved_id, event, message_id)`. It stores all
requested dimensions plus `user_id`, subscription `action`, and normalized
`bounce_type` (top-level `bounceType`, falling back to `bounce.bounceType`).
`resolved_id` falls back from nonempty `properties.messageId` to `message_id`;
address falls back from nonempty email to variant.to. Missing strings stay empty.
Hidden events are retained and filtered at query time. Channel exclusions remain
in analytics so the materialized view retains every requested message event.

The overview, message/day/domain groups, previous period, and deliverability
address list read typed columns without JSON extraction. Revenue was audited:
message node/user/dimension fields are represented here; existing revenue
attribution queries are unchanged. Their `order_paid` properties are not message
events and remain in user_events_v2.

## Existing-box migration and backfill

Run from the repository root with the platform's usual backend configuration.
Choose `--from` at or before the earliest historical processing_time to retain.
For a complete migration, omit `--workspace-id` and cover all retained history.

```sh
corepack yarn workspace backend-lib ts-node scripts/backfillMessageEventsSlim.ts \
  --from 2020-01-01T00:00:00.000Z --interval-minutes 60 --dry-run

corepack yarn workspace backend-lib ts-node scripts/backfillMessageEventsSlim.ts \
  --from 2020-01-01T00:00:00.000Z --interval-minutes 60
```

The script creates the table, then the MV, then captures/logs an exclusive
processing_time cutoff. Capturing after MV creation covers the installation
window. New inserts feed the MV while historical rows are copied in sequential
half-open processing_time chunks. Optional `--to <ISO-UTC>` fixes a historical
cutoff; optional `--workspace-id <id>` limits the backfill (the MV remains global).
Use a smaller interval if an insert hits memory or timeout limits.

Rerun the same range to resume, including after a partially completed insert.
The anti-membership check skips `(workspace_id, message_id, event, event_time)`
already in the destination, with no destination processing_time restriction.
`LIMIT 1 BY` also collapses duplicate source keys within a chunk. No OFFSET is
used. Run one backfill process at a time: MergeTree has no unique constraint,
so concurrent copies or concurrent replay of historical keys can race the
presence check. Finish/drain such replays before backfilling their range.
Normal new events after the fixed cutoff continue through the MV.

Install and finish the backfill **before switching API traffic to this query
version**, or historical reports will be incomplete. The script logs each
completed chunk and exits nonzero on failure. Dry run performs no DB operations.
Neither the migration nor backfill has been executed against production here.

Like the repository's other incremental MVs, this view processes inserts;
source UPDATE/DELETE mutations do not propagate. Retention/deletion operations
that must remove derived message data must also include the slim table.

## Verification

DB-free tests snapshot table/MV/backfill SQL and all analytic group variants,
check shared projection/filter, cross-chunk dedupe, millisecond chunk boundaries,
typed unsubscribe/bounce handling, and current/previous-period query bounds.
To reproduce the original issue before rollout, request the overview for a busy
14-day period and compare request timings and ClickHouse query read bytes before
and after the migration/backfill, checking all metrics and the previous period.
No production latency improvement is claimed without that measurement.

Local gate results (2026-09-14): all commands below exited 0. Analytics:
23 tests passed, 7 snapshots (updated as requested).

```sh
corepack yarn workspace backend-lib check
corepack yarn workspace api check
corepack yarn workspace backend-lib eslint src/analytics.ts src/analytics.unit.test.ts src/userEvents/clickhouse.ts src/userEvents/messageEventsSlim.ts src/messageEventsSlimBackfill.ts scripts/backfillMessageEventsSlim.ts
corepack yarn test:file packages/backend-lib/src/analytics.unit.test.ts --config .tmp/analytics-jest.config.cjs --runInBand --updateSnapshot
```

CLI `--help` and a three-chunk `--dry-run` also passed. Live ClickHouse SQL and
timing checks could not run: sandbox access to the local Docker socket was denied.
