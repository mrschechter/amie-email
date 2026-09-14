import {
  AnalyticsRequest,
  DAY_MS,
  previousPeriod,
  validateAnalyticsRange,
} from "isomorphic-lib/src/analytics";

import {
  buildAnalyticsQuery,
  buildDeliverabilityAddressesQuery,
  getAnalytics,
  mergeRevenue,
} from "./analytics";
import {
  aggregateByJourney,
  compareDeltas,
  emptyRow,
  metrics,
  revenueTotals,
  sumMetrics,
} from "./analyticsHelpers";
import { query } from "./clickhouse";
import {
  buildRevenueAttributionFile,
  buildRevenueFactsQuery,
  buildRevenueOrdersQuery,
  getRevenueBreakdown,
  getRevenueFacts,
  RevenueFact,
} from "./revenueAttribution";

const mockJourneys = [
  { id: "flow", name: "Reminder flow", status: "Running", definition: null },
  {
    id: "broadcast-flow",
    name: "Internal broadcast flow",
    status: "Broadcast",
    definition: null,
  },
];
const mockBroadcasts = [
  {
    id: "broadcast",
    name: "September broadcast",
    journeyId: "broadcast-flow",
    version: "V2",
    statusV2: "Completed",
    segmentId: null,
    triggeredAt: null,
  },
];

const mockQueryRows: unknown[][] = [];

jest.mock("./config", () => ({
  __esModule: true,
  default: () => ({
    amieAttributionWindowDays: 5,
    amieAttributionIncludeOpens: true,
    clickhouseMaxMemoryUsage: "1000000000",
  }),
}));
jest.mock("./logger", () => ({
  __esModule: true,
  default: () => ({ debug: jest.fn() }),
}));
jest.mock("./openTelemetry", () => ({}));
jest.mock("./clickhouse", () => ({
  ...jest.requireActual<typeof import("./clickhouse")>("./clickhouse"),
  query: jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(mockQueryRows.shift() ?? []),
    }),
  ),
}));
jest.mock("./journeys", () => ({
  getJourneysStats: jest.fn().mockResolvedValue([]),
}));
jest.mock("./resources", () => ({
  getResources: jest.fn().mockResolvedValue({}),
}));
jest.mock("./db", () => ({
  db: () => ({
    query: {
      journey: { findMany: () => Promise.resolve(mockJourneys) },
      broadcast: { findMany: () => Promise.resolve(mockBroadcasts) },
      messageTemplate: {
        findMany: () =>
          Promise.resolve([{ id: "template", name: "Reminder email" }]),
      },
    },
    select: () => ({
      from: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }),
    }),
  }),
}));
const request: AnalyticsRequest = {
  workspaceId: "workspace-' OR 1=1 --",
  startDate: "2026-08-01T00:00:00.000Z",
  endDate: "2026-08-31T00:00:00.000Z",
  windowDays: 7,
};
const fact = (overrides: Partial<RevenueFact> = {}): RevenueFact => ({
  journeyId: "flow",
  broadcastId: "",
  nodeId: "step1",
  templateId: "template",
  day: "2026-08-05",
  kind: "new",
  attributed: 1,
  orders: 2,
  revenueCents: 20000,
  ...overrides,
});

describe("analytics SQL builders (DB-free)", () => {
  it.each(["message", "day", "domain"] as const)(
    "snapshots %s SQL and binds workspace/range",
    (group) => {
      const result = buildAnalyticsQuery(request, group);
      expect({
        ...result,
        query: result.query.replace(/[ \t]+\n/g, "\n"),
      }).toMatchSnapshot();
      expect(result.query).not.toContain(request.workspaceId);
      expect(result.query_params).toEqual({
        v0: request.workspaceId,
        v1: request.startDate,
        v2: request.endDate,
      });
      expect(result.query).toContain("FROM dittofeed.user_events_v2");
      expect(result.query).toContain("hidden = false");
      expect(result.query).toContain("event_time < parseDateTime64BestEffort");
      expect(result.query).toContain("countIf(event = 'DFEmailOpened') > 0");
      expect(result.query).toContain("AS rawOpened");
      expect(result.query).not.toContain("has_opened OR has_clicked");
    },
  );
  it.each(["message", "day", "domain"] as const)(
    "bounds the base %s events scan before JSON extraction",
    (group) => {
      const { query: sql } = buildAnalyticsQuery(request, group);
      const baseCte = sql.split("), resolved_events AS (")[0];
      expect(baseCte).toContain(
        "SELECT event, event_time, properties, message_id",
      );
      expect(baseCte).toContain("PREWHERE workspace_id = {v0:String}");
      expect(baseCte).toContain(
        "event_time >= parseDateTime64BestEffort({v1:String}, 3, 'UTC')",
      );
      expect(baseCte).toContain(
        "event_time < parseDateTime64BestEffort({v2:String}, 3, 'UTC')",
      );
      expect(baseCte).toContain("event_type = 'track' AND hidden = false");
      expect(baseCte).not.toContain("JSONExtract");
      expect(sql).not.toContain("SELECT *");
      // In-range events ingested later must still count in the selected period.
      expect(sql).toContain(
        "processing_time >= parseDateTime64BestEffort({v1:String}, 3, 'UTC') - INTERVAL 2 DAY",
      );
      expect(sql).toContain(
        "processing_time < parseDateTime64BestEffort({v2:String}, 3, 'UTC') + INTERVAL 2 DAY",
      );
    },
  );
  it("requires a permanent/hard classification for bounce addresses", () => {
    const result = buildDeliverabilityAddressesQuery(request);
    expect({
      ...result,
      query: result.query.replace(/[ \t]+\n/g, "\n"),
    }).toMatchSnapshot();
    expect(result.query).toContain("'permanent', 'hard', 'hardbounce'");
    expect(result.query).toContain("LIMIT 1000");
    expect(result.query_params.v0).toBe(request.workspaceId);
  });
  it("binds the selected attribution window and ignores opens even when the legacy flag is true", () => {
    const result = buildRevenueFactsQuery(request);
    expect({
      ...result,
      query: result.query.replace(/[ \t]+\n/g, "\n"),
    }).toMatchSnapshot();
    expect(result.query_params.v3).toBe(7);
    expect(result.query_params.v4).toEqual(["DFEmailClicked", "DFSmsClicked"]);
    expect(result.query).toContain("ASOF LEFT JOIN");
    expect(result.query).toContain("GROUP BY user_id, touch_time");
    expect(result.query).toContain("GROUP BY order_id");
  });
  it("binds order filters and pagination with stable ordering", () => {
    const result = buildRevenueOrdersQuery(
      {
        ...request,
        filters: { journeyIds: ["flow-'"], templateIds: ["template"] },
      },
      101,
      100,
    );
    expect({
      ...result,
      query: result.query.replace(/[ \t]+\n/g, "\n"),
    }).toMatchSnapshot();
    expect(Object.values(result.query_params)).toContainEqual(["flow-'"]);
    expect(result.query).not.toContain("flow-'");
    expect(result.query).toContain("ORDER BY order_time DESC, order_id DESC");
  });
  it("rejects invalid or excessive ranges before accessing a database", async () => {
    for (const [startDate, endDate] of [
      ["bad", request.endDate],
      [request.endDate, request.startDate],
      [request.startDate, request.startDate],
      [
        request.startDate,
        new Date(Date.parse(request.startDate) + 401 * DAY_MS).toISOString(),
      ],
    ]) {
      expect(() =>
        buildAnalyticsQuery({
          ...request,
          startDate: startDate ?? "",
          endDate: endDate ?? "",
        }),
      ).toThrow("at most 400 days");
    }
    expect(() =>
      validateAnalyticsRange(
        request.startDate,
        new Date(Date.parse(request.startDate) + 400 * DAY_MS).toISOString(),
      ),
    ).not.toThrow();
    await expect(
      getAnalytics({ ...request, endDate: "bad" }, "overview"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rolls existing groupBy=journey SQL up without leaking a node dimension", async () => {
    mockQueryRows.push([]);
    await getRevenueBreakdown({ ...request, groupBy: "journey" });
    const sql = jest.mocked(query).mock.calls.at(-1)?.[0].query;
    expect(sql).toContain("ie.journey_id AS source_id, '' AS journey_node_id");
    expect(sql).toContain("ao.journey_id AS source_id, '' AS journey_node_id");
  });
  it("normalizes ClickHouse numeric strings", async () => {
    mockQueryRows.push([
      { ...fact(), orders: "2", revenueCents: "20000", attributed: "1" },
    ]);
    expect(await getRevenueFacts(request)).toEqual([fact()]);
  });
});

describe("analytics aggregations", () => {
  it("rolls nodes into one journey and recomputes weighted rates and RPM", () => {
    const rows = [
      emptyRow({
        journeyId: "flow",
        nodeId: "step1",
        sends: 100,
        delivered: 80,
        opened: 40,
        clicked: 8,
        attributedOrders: 2,
        attributedRevenueCents: 20000,
        lastSend: "2026-08-01",
      }),
      emptyRow({
        journeyId: "flow",
        nodeId: "step2",
        sends: 300,
        delivered: 300,
        opened: 60,
        clicked: 30,
        attributedOrders: 1,
        attributedRevenueCents: 10000,
        lastSend: "2026-08-02",
      }),
      emptyRow({
        journeyId: "broadcast-flow",
        broadcastId: "broadcast",
        sends: 1000,
      }),
    ];
    const result = aggregateByJourney(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "flow",
      nodeId: "",
      sends: 400,
      delivered: 380,
      opened: 100,
      clicked: 38,
      clickRate: 0.1,
      attributedOrders: 3,
      attributedRevenueCents: 30000,
      rpm: 75000,
      lastSend: "2026-08-02",
    });
    expect(result[0]?.openRate).toBeCloseTo(100 / 380);
  });
  it("computes all denominators exactly and keeps zero denominators finite", () => {
    const result = metrics({
      sends: 100,
      delivered: 80,
      opened: 40,
      clicked: 8,
      unsubscribed: 4,
      bounced: 10,
      complaint: 2,
      attributedRevenueCents: 10000,
    });
    expect(result).toMatchObject({
      deliveredRate: 0.8,
      openRate: 0.5,
      clickRate: 0.1,
      ctor: 0.2,
      unsubRate: 0.05,
      bounceRate: 0.1,
      complaintRate: 0.02,
      bounceComplaintRate: 0.12,
      rpm: 100000,
    });
    expect(Object.values(metrics({ clicked: 1 })).every(Number.isFinite)).toBe(
      true,
    );
    expect(metrics({ clicked: 1 }).ctor).toBe(0);
    expect(sumMetrics([])).toEqual(metrics());
  });
  it("computes adjacent equal-length compare windows and honest zero-baseline deltas", () => {
    const previous = previousPeriod(request.startDate, request.endDate);
    expect(previous.endDate).toBe(request.startDate);
    expect(Date.parse(previous.endDate) - Date.parse(previous.startDate)).toBe(
      30 * DAY_MS,
    );
    const result = compareDeltas(
      metrics({ sends: 150, clicked: 1 }),
      metrics({ sends: 100, opened: 1 }),
    );
    expect(result.sends).toBe(0.5);
    expect(result.clicked).toBeNull();
    expect(result.opened).toBe(-1);
    expect(result.delivered).toBe(0);
  });
  it("joins revenue once per source/node/template and preserves revenue with no sends", () => {
    const joined = mergeRevenue(
      [
        emptyRow({
          journeyId: "flow",
          nodeId: "step1",
          templateId: "template",
          sends: 10,
        }),
      ],
      [
        fact(),
        fact({ day: "2026-08-06", orders: 1 }),
        fact({ nodeId: "step2", orders: 3 }),
        fact({ attributed: 0, orders: 100 }),
      ],
    );
    expect(joined).toHaveLength(2);
    expect(sumMetrics(joined)).toMatchObject({
      sends: 10,
      attributedOrders: 6,
      attributedRevenueCents: 60000,
    });
    expect(
      mergeRevenue([], [fact(), fact({ day: "2026-08-06" })], true),
    ).toHaveLength(2);
  });
  it("partitions revenue into attributed kinds and unattributed without losing unknowns", () => {
    expect(
      revenueTotals([
        fact(),
        fact({ kind: "renewal" }),
        fact({ kind: "other" }),
        fact({ attributed: 0 }),
      ]),
    ).toMatchObject({
      totalOrders: 8,
      attributedOrders: 6,
      totalRevenueCents: 80000,
      attributedRevenueCents: 60000,
      newOrders: 2,
      renewalOrders: 2,
      unknownOrders: 2,
      unattributedOrders: 2,
      unattributedRevenueCents: 20000,
    });
  });
});

describe("analytics report assembly", () => {
  it("aggregates sources, fills missing UTC days, computes compare server-side, and deduplicates in-flight requests", async () => {
    const beforeCalls = jest.mocked(query).mock.calls.length;
    mockQueryRows.push(
      [
        emptyRow({
          journeyId: "flow",
          nodeId: "step1",
          templateId: "template",
          sends: 10,
          delivered: 8,
          opened: 4,
        }),
        emptyRow({
          journeyId: "flow",
          nodeId: "step2",
          templateId: "template",
          sends: 30,
          delivered: 20,
          opened: 5,
        }),
        emptyRow({
          journeyId: "broadcast-flow",
          templateId: "template",
          sends: 5,
        }),
      ],
      [
        emptyRow({
          journeyId: "flow",
          nodeId: "step1",
          templateId: "template",
          day: "2026-08-05",
          sends: 10,
        }),
      ],
      [fact()],
      [emptyRow({ sends: 30 })],
      [],
    );
    const reportRequest = { ...request, workspaceId: "report-assembly" };
    const [report, concurrent] = await Promise.all([
      getAnalytics(reportRequest, "overview"),
      getAnalytics(reportRequest, "overview"),
    ]);
    expect(report).toBe(concurrent);
    expect(jest.mocked(query).mock.calls.length - beforeCalls).toBe(5);
    const eventQueries = jest
      .mocked(query)
      .mock.calls.slice(beforeCalls)
      .map(([options]) => options)
      .filter((options) => options.query.startsWith("WITH events AS ("));
    expect(eventQueries).toHaveLength(3);
    const previous = previousPeriod(request.startDate, request.endDate);
    [request, request, previous].forEach((range, index) => {
      const options = eventQueries[index];
      expect(options?.query_params).toEqual({
        v0: reportRequest.workspaceId,
        v1: range.startDate,
        v2: range.endDate,
      });
      const baseCte = options?.query.split("), resolved_events AS (")[0];
      expect(baseCte).toContain("PREWHERE workspace_id = {v0:String}");
      expect(baseCte).toContain(
        "event_time >= parseDateTime64BestEffort({v1:String}, 3, 'UTC')",
      );
      expect(baseCte).toContain(
        "event_time < parseDateTime64BestEffort({v2:String}, 3, 'UTC')",
      );
    });
    expect(report.flows).toHaveLength(1);
    expect(report.flows[0]).toMatchObject({
      name: "Reminder flow",
      sends: 40,
      delivered: 28,
      opened: 9,
      attributedOrders: 2,
    });
    expect(report.broadcasts[0]).toMatchObject({
      sends: 5,
      name: "September broadcast",
    });
    expect(report.daily).toHaveLength(30);
    expect(report.daily[0]).toMatchObject({ day: "2026-08-01", sends: 0 });
    expect(report.previous?.sends).toBe(30);
    expect(report.deltas.sends).toBe(0.5);
    expect(await getAnalytics(reportRequest, "overview")).toBe(report);
    expect(jest.mocked(query).mock.calls.length - beforeCalls).toBe(5);
    await getAnalytics(
      { ...reportRequest, compare: false, windowDays: 14 },
      "overview",
    );
    expect(jest.mocked(query).mock.calls.length - beforeCalls).toBe(8);
  });
  it("scopes a detail response to the selected source and returns 404 for absent resources", async () => {
    mockQueryRows.push(
      [
        emptyRow({ journeyId: "flow", sends: 5 }),
        emptyRow({ journeyId: "unrelated", sends: 999 }),
      ],
      [],
      [],
    );
    const report = await getAnalytics(
      { ...request, workspaceId: "scoped-detail", compare: false },
      "flows",
      "flow",
    );
    expect(report.summary.sends).toBe(5);
    expect(report.flows.map((row) => row.id)).toEqual(["flow"]);
    await expect(
      getAnalytics(
        { ...request, workspaceId: "absent-detail", compare: false },
        "flows",
        "missing",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

it("exports all order rows with dollar amounts through the existing CSV function", async () => {
  mockQueryRows.push([
    {
      orderId: "order-1",
      userId: "user",
      date: "2026-08-05",
      amountCents: "12500",
      kind: "new",
      journeyId: "flow",
      broadcastId: "",
      templateId: "template",
      nodeId: "step",
      messageId: "message",
      minutesSinceClick: "60",
    },
  ]);
  const csv = await buildRevenueAttributionFile({
    ...request,
    exportKind: "orders",
  });
  expect(csv.fileName).toBe("revenue-orders-2026-08-01.csv");
  expect(csv.fileContent).toContain("Amount (USD)");
  expect(csv.fileContent).toContain("125.00");
  expect(jest.mocked(query).mock.calls.at(-1)?.[0].query).not.toContain(
    "LIMIT",
  );
});
