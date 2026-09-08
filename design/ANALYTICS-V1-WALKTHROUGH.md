# Amie Send Analytics v1 walkthrough

## Scope and baseline

User report: per-flow analytics were difficult to find, and the revenue journey breakdown returned one row per message node. Reproduce the former experience by opening Analytics Overview, then comparing a multi-message journey's revenue breakdown with the journey list: there was no aggregated flow-performance view or Performance tab.

The slice document supplies a live 30-day baseline of **11,330 sends, 1,254 order_paid orders (approximately $189k), and 3 attributed orders**. Those are supplied observations, not newly measured results. The screens request the selected workspace's data through the API; no baseline values or example campaigns are embedded in the UI. This checkout has no environment file, so fresh live-workspace numbers, actual ClickHouse execution, and browser screenshots were not verified here. The checks below are DB-free.

## Overview — `/analysis/overview`

Reporting → **Analytics** and `/analysis` lead here. Six tabs preserve the start, end, and compare query parameters. The default is the last 30 UTC calendar days including today; compare uses the adjacent period of equal length. Custom ranges are limited to 400 days.

Eight cards show sends, delivered/open/click/unsubscribe/bounce+complaint rates, attributed revenue, and attributed orders. Click rate includes CTOR; orders include RPM. Each card has a daily sparkline and, when comparison is enabled, a relative delta. A nonzero result after zero is labeled “New”. Choose a metric for the daily chart. Top flows and broadcasts show five sources and link into Performance; their headings link to the full analytics tabs.

Open **How these are calculated** for every formula, click-only attribution, Apple MPP, zero denominators, range boundaries, comparison semantics, and known data limits. For the supplied live baseline, total order revenue belongs on Revenue; it must not be presented as attributed revenue.

## Flows — `/analysis/flows`

One row represents one journey across all message nodes. Search, filter by status, and sort any column. Columns include entered/completed, delivery and engagement metrics, attributed orders/revenue, RPM, and last send. Rate hover text contains the numerator and denominator. Click a name or row to open `/journeys/[id]?tab=performance` with the reporting range preserved. Broadcast-backed journeys are excluded from the flow list.

## Journey Performance

The journey editor keeps **Builder** as its default tab. **Performance** shows that journey's eight KPIs, one row per message step, its template, and the same delivery/engagement/revenue metrics. Historical steps with activity remain visible even when absent from the current definition.

The funnel follows journey connections from entry through message nodes to exit using date-bounded node-processing counts. Branches and re-entry mean this is activity reporting, not a conversion cohort. A daily chart and the existing Recent deliveries table use the selected journey and date range.

## Broadcasts — `/analysis/broadcasts` and broadcast Performance

Compare name/status, audience size, sent time, sends, rates, orders, revenue, and RPM. Audience size is current stored segment membership, because there is no historical audience snapshot. Sent time uses the recorded trigger time, falling back to the first send observed in the range.

Rows open Performance. The current broadcast page has Broadcast/Performance tabs; legacy broadcast review has Review/Performance tabs. Performance shows KPIs, per-template rows, the daily chart, and filtered recent deliveries. This slice does not alter or send campaign content.

## Emails — `/analysis/emails`

One row per template aggregates flow and broadcast usage, including templates with no activity. **Show sources** expands the template to one row per source, combining repeated uses within the same flow. This prevents the old per-node duplication from resurfacing as apparently separate flows. `/analysis/messages` remains a compatibility entry to this screen.

## Revenue — `/analysis/revenue`

The explainer states last-touch, click-based attribution and the active window. Select 5, 7, or 14 days to requery this view without saving a workspace setting. The initial window comes from `AMIE_ATTRIBUTION_WINDOW_DAYS`.

Cards separate total, attributed, new, renewal, unknown-kind, and unattributed orders/revenue. Switch Revenue by source between flows, broadcasts, and templates. The orders table includes order/date/amount/kind/source/minutes-since-click, with 100-row pagination. **Download all orders CSV** uses the existing attribution exporter and exports the whole selected range, including unattributed orders, with USD amounts.

## Deliverability — `/analysis/deliverability`

View daily bounces, complaints, and unsubscribes, then compare gmail.com, yahoo.com, icloud.com, outlook.com, and other domains with sends and rates. Address rows link to the user. The list contains the latest 1,000 address/event combinations for complaints and explicitly classified hard/permanent bounces. Existing SES event ingestion omits bounce classification; those unclassified events count in bounce totals but cannot honestly be labeled hard bounces. No SES changes were made.

## Journeys and broadcasts lists

The existing lists gain sortable **Open % (30d)**, **Click % (30d)**, and **Attributed revenue (30d)** columns. Each list loads metrics in one request. Rates expose counts on hover; loading/unavailable values remain distinct from measured zero. Status pills use the canvas sage, rose, and sand colors.

All new screens include loading skeletons, inline error messages, and explanatory empty states. Tables have sticky headers, right-aligned numerics, and canvas borders/radii/colors.

## Validation

The repository-pinned Yarn CLI was invoked with Node because `yarn` is not on this shell's PATH. From the repository root:

```sh
node .yarn/releases/yarn-4.1.1.cjs workspace emailo build
node .yarn/releases/yarn-4.1.1.cjs workspace isomorphic-lib check
node .yarn/releases/yarn-4.1.1.cjs workspace backend-lib check
node .yarn/releases/yarn-4.1.1.cjs workspace api check
node .yarn/releases/yarn-4.1.1.cjs workspace dashboard check
```

The emailo build supplies its local type declarations. All four package typechecks pass. ESLint on changed TypeScript/TSX files passes with no errors; eight pre-existing warnings remain in the existing lists/deliveries code (console statements and redundant conditions). `git diff --check` passes.

Exact lint commands (changed TypeScript/TSX files):

```sh
node .yarn/releases/yarn-4.1.1.cjs workspace backend-lib eslint src/analytics.ts src/analyticsHelpers.ts src/analytics.unit.test.ts src/journeys.ts src/revenueAttribution.ts
node .yarn/releases/yarn-4.1.1.cjs workspace api eslint src/controllers/analysisController.ts src/controllers/analysisController.unit.test.ts
node .yarn/releases/yarn-4.1.1.cjs workspace isomorphic-lib eslint src/analytics.ts src/types.ts
node .yarn/releases/yarn-4.1.1.cjs workspace dashboard eslint 'src/components/analytics/*.tsx' src/lib/useAnalytics.ts 'src/pages/analysis/*.tsx' src/components/broadcasts/indexTable.tsx src/components/journeys/v2/journeysTable.tsx src/components/deliveriesTableV2.tsx src/components/menuItems/main.ts 'src/pages/broadcasts/[id].page.tsx' 'src/pages/broadcasts/review/[id].page.tsx' src/pages/broadcasts/v2.page.tsx src/pages/journeys/v2.page.tsx
```

Exact DB-free commands:

```sh
node .yarn/releases/yarn-4.1.1.cjs jest --config '{"transform":{"^.+\\.tsx?$": ["ts-jest", {"tsconfig":"packages/backend-lib/tsconfig.json"}]},"testEnvironment":"node","roots":["<rootDir>/packages/backend-lib/src"],"testMatch":["**/analytics.unit.test.ts"],"moduleNameMapper":{"^isomorphic-lib/src/(.*)$":"<rootDir>/packages/isomorphic-lib/src/$1"}}' --runInBand

node .yarn/releases/yarn-4.1.1.cjs jest --config '{"transform":{"^.+\\.tsx?$": ["ts-jest", {"tsconfig":"packages/api/tsconfig.json"}]},"testEnvironment":"node","roots":["<rootDir>/packages/api/src"],"testMatch":["**/analysisController.unit.test.ts"],"moduleNameMapper":{"^isomorphic-lib/src/(.*)$":"<rootDir>/packages/isomorphic-lib/src/$1","^backend-lib/src/(.*)$":"<rootDir>/packages/backend-lib/src/$1"}}' --runInBand
```

Results: **17 backend tests, 6 SQL snapshots, and 10 API tests pass**. Coverage includes SQL bindings, date/workspace bounds, click-only attribution, zero denominators, weighted node rollups, compare windows, revenue-only activity, unknown order kinds, source-scoped reports, in-flight/cache reuse, route validation, pagination, and CSV export. No deploy manifests or Docker files were modified. Changes are committed locally on `analytics-v1`; nothing is pushed or deployed.
