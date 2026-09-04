# Revenue attribution implementation notes

## What was built

- Click-based, last-touch attribution for `order_paid` events. Each order is deduplicated by `orderId` and assigned to the latest prior `DFEmailClicked` or `DFSmsClicked` event for the same non-empty Dittofeed `userId` when that click is within the configured window. Opens are never considered.
- Attribution carries `templateId`, `broadcastId`, `journeyId`, journey `nodeId`, and the clicked message ID. New and renewal order counts/revenue are reported independently.
- Revenue summary metrics include attributed and total revenue/orders, unattributed revenue/orders, sends, revenue per 1,000 sends, and attributed-order AOV. API amounts are cents and UI/CSV amounts are displayed as USD.
- Analytics now has the 7/14/30/custom selector from the design, attributed revenue/order stat cards, the required unattributed reconciliation line, and a sortable Revenue by email table with CSV export.
- Broadcast Deliveries and Journey Summary show date-scoped attributed revenue, orders, revenue per 1,000 sends, AOV, and new-versus-renewal counts for that item.

## Endpoints

- `GET /analysis/revenue/summary` — `workspaceId`, `startDate`, `endDate`, and optional `filters.broadcastIds`, `filters.journeyIds`, or `filters.templateIds`.
- `GET /analysis/revenue/breakdown` — the same range/filter arguments plus `groupBy=broadcast|journey|template|email`. Journey grouping includes the journey node ID; `email` is the granular source/template view used by Analytics.
- `GET /analysis/revenue/download` — the same range/filter arguments; returns the granular revenue-by-email CSV with resolved broadcast, journey, and template names where the resources still exist.

These routes use the existing analysis controller registration and therefore the same dashboard/admin/embedded session authentication as the existing analysis endpoints.

## Query and historical backfill behavior

Attribution is computed on read rather than materialized. A request scans only `order_paid` rows in its requested range and click rows from the range start minus `AMIE_ATTRIBUTION_WINDOW_DAYS` through the range end. The ASOF join uses ClickHouse's disk-capable full sorting merge algorithm and the configured ClickHouse memory ceiling, which avoids an unbounded all-history join on the 2-vCPU instance.

There is no separate write-heavy backfill. Historical data is available immediately: requesting a range beginning at the earliest `order_paid` computes the effective backfill directly from the source-of-truth events, in bounded chunks chosen by the caller/date selector. This also means late-arriving click/order events and attribution-window changes are reflected without rebuilding a table.

`AMIE_ATTRIBUTION_WINDOW_DAYS` defaults to `5` and is passed through all Compose configurations, including the production deployment example.

## Verification

- Added ClickHouse-backed fixtures covering: click then order inside the window, click outside the window, two clicks with latest-touch winning, and open-only remaining unattributed. The latest-click fixture also checks renewal separation.
- Type checks pass for `isomorphic-lib`, `backend-lib`, `api`, and `dashboard`.
- Focused lint passes for every touched TypeScript/TSX file.
- The attribution Jest suite was invoked with `yarn test:file packages/backend-lib/src/revenueAttribution.test.ts`, but this execution sandbox denied the test harness's local Postgres/ClickHouse connections with `EPERM` during global setup, before Jest could execute the fixtures. The test file compiles under the backend package type check and should be rerun in the normal service-enabled test environment.

## Deferred

- No currency conversion was added. The upstream contract supplies cents plus currency and the requested reporting currency is USD; this implementation displays the received cent amounts as USD.
- SMS click attribution is supported under the forward-compatible `DFSmsClicked` event name. The current shared internal event enum does not yet expose an SMS-click member.
