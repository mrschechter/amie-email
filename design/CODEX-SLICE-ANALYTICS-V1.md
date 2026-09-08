# Codex slice — Amie Send Analytics v1 ("best in class", Ian 2026-09-08)

Owner: Codex (authors all code). Gate/deploy: Fable. Design authority: `design/amie-send-app-canvas.html` (tokens, nav, table style, pills). Product name is **Amie Send**; never say Dittofeed in UI copy.

## Why
Ian: "It's hard to see the per flow analytics and it can be better navigation — make this best in class and up to date." Today `/analysis/overview` is the stock time-series chart with a bolted-on revenue table; `/analysis/messages` is a flat message table. Per-flow (journey) and per-broadcast performance is not visible anywhere except a node-level breakdown buried in `GET /api/analysis/revenue/breakdown?groupBy=journey` (which returns one row per journey NODE, not per journey). Live 30d: 11,330 sends, 1,254 orders ($189k) in `order_paid`, 3 attributed.

## Information architecture (Reporting → Analytics)
Route `/analysis` with tabs (URL-addressable, date range + compare persisted in query string, default Last 30 days, compare = previous period):

1. **Overview** — KPI strip (8 cards, each with value + delta vs previous period + sparkline): Sends, Delivered rate, Open rate, Click rate (CTR and CTOR), Unsubscribe rate, Bounce+complaint rate, Attributed revenue, Attributed orders (+ RPM = revenue per 1,000 sends). Below: one time-series chart (daily) with metric picker; then "Top flows" (5) and "Top broadcasts" (5) mini tables linking into the tabs.
2. **Flows** — one row per JOURNEY (aggregate all message nodes): Name (link), Status pill (Running/Paused/Draft), Entered, Completed, Sends, Delivered %, Open %, Click %, Unsub %, Attributed orders, Attributed revenue, RPM, Last send. Sortable; search; status filter. Row click → `/journeys/[id]?tab=performance`.
3. **Flow detail (Performance tab on the journey page)** — header KPIs for this journey; **per-message table** (one row per message node: step name, template, sends, delivered %, open %, click %, unsub %, attributed orders/revenue, RPM); **step funnel** (entered → each message node → exit) using existing node stats in `backend-lib/src/journeys.ts` (`getJourneysStats`); daily time series for this journey; "Recent deliveries" list (reuse deliveries table filtered by journeyId).
4. **Broadcasts** — one row per broadcast: Name, Status, Audience size, Sent at, Sends, Delivered %, Open %, Click %, Unsub %, Attributed orders/revenue, RPM. Row click → broadcast page gets the same Performance panel (per-template rows if multi-template, else single).
5. **Emails** — one row per TEMPLATE across all sources (flows + broadcasts): same metrics; expandable to show which flows/broadcasts used it.
6. **Revenue** — attribution explainer line ("Last-touch, click-based, {N}-day window; opens ignored"), cards: Total orders/revenue in period (from `order_paid`), Attributed (new vs renewal), Unattributed; table "Revenue by source" (flow/broadcast/template switch); orders list (order, date, amount, kind, attributed to, minutes-since-click) with CSV (reuse `buildRevenueAttributionFile`). Window selector (5/7/14 days) — default from `AMIE_ATTRIBUTION_WINDOW_DAYS`; changing it re-queries, does not persist.
7. **Deliverability** — bounce, complaint, unsubscribe by day; by recipient domain (gmail.com / yahoo.com / icloud.com / outlook.com / other) with sends and rates; list of hard-bounce and complaint addresses in period (link to user).

Navigation: sidebar "Reporting → Analytics" lands on Overview; "Deliveries" stays. Journey list page (`/journeys`) gains Open %, Click %, Attributed revenue columns (30d) so flows are comparable without leaving the list. Broadcast list likewise. All tables: canvas table style, sticky header, right-aligned numerics, rate cells show % with count on hover, empty states with a one-line explanation (e.g. "No sends in this range").

## Backend
- New `packages/backend-lib/src/analytics.ts`: ClickHouse queries over `user_events_v2` (db `dittofeed`) computing sends/delivered/opened/clicked/bounced/complaint/unsubscribed per {journeyId, nodeId, templateId, broadcastId, day, recipient domain} from the `DFEmail*` / `DFSms*` events (properties carry `journeyId`, `nodeId`, `templateId`, `broadcastId`, `messageId`). Unique-per-message for opens/clicks (count distinct messageId), raw counts available. Join with `revenueAttribution.ts` for attributed orders/revenue (refactor so one function returns rows keyed by source + node + template, and an aggregate-by-journey helper — fix the "one row per node" leak in `groupBy=journey`).
- Cache 60s in-process keyed by (workspace, range, groupBy). Every query bounded by range and workspace; hard cap range 400 days.
- API (`packages/api/src/controllers/analysisController.ts`): `GET /api/analysis/overview`, `/flows`, `/flows/:journeyId`, `/broadcasts`, `/broadcasts/:id`, `/emails`, `/deliverability`, all `{workspaceId, startDate, endDate, compare?, windowDays?}`; existing revenue routes stay. TypeBox schemas in `isomorphic-lib`.
- Previous-period compare computed server-side (same length window immediately before).

## Frontend
- Next pages under `packages/dashboard/src/pages/analysis/` (`index` → overview, `flows`, `broadcasts`, `emails`, `revenue`, `deliverability`); components under `components/analytics/` (KpiCard, DeltaChip, RateCell, MetricTimeSeries, PerformanceTable). React-query hooks in `lib/`. Journey page: add Performance tab (`?tab=performance`), keep the builder as default tab.
- Style: canvas tokens (blush #F5E6E0 bg accents, teal #2D7A7A, ivory #FAF8F5, warm grey #4A4A4A, borders #E3DAD1, radius 8/12, DM Sans 13.5px), pills exactly as canvas (`Running` sage, `Paused` rose, `Draft` sand). No MUI default blue anywhere in these screens.
- Loading skeletons; errors show the message inline, never a blank screen.

## Definitions (put in a "How these are calculated" drawer on Overview)
Delivered % = delivered / sent. Open % = unique opened / delivered (note Apple MPP inflates opens). Click % (CTR) = unique clicked / delivered; CTOR = unique clicked / unique opened. Unsub % = unsubscribed / delivered. Bounce % = bounced / sent. Attributed revenue: last click within window before `order_paid`; one order → one message. RPM = attributed revenue / sends × 1000.

## Tests
Unit tests for the ClickHouse query builders (SQL snapshot + parameter binding) and the aggregation helpers (node→journey rollup, compare deltas, rate math with zero denominators). Run unit suites DB-free with the inline jest config trick used in earlier slices (ts-jest, roots=packages/<pkg>/src).

## Out of scope (v1)
Currency conversion, cohort/retention charts, A/B stats, SMS-specific deliverability beyond counts.

## Definition of done
`yarn tsc` clean for backend-lib/api/dashboard; unit tests green; screenshots (or a written walkthrough) of Overview, Flows, Flow detail Performance tab, Revenue with real workspace data; a short CHANGELOG entry. Do not touch deploy manifests.
