import { classifyLink, displayLink } from "isomorphic-lib/src/linkClicks";

import { buildLinkClicksQuery, getLinkClicks } from "./linkClicks";

let mockRows: unknown[] = [];

jest.mock("./config", () => ({
  __esModule: true,
  default: () => ({ clickhouseMaxMemoryUsage: "1000000000" }),
}));
jest.mock("./logger", () => ({
  __esModule: true,
  default: () => ({ debug: jest.fn() }),
}));
jest.mock("./openTelemetry", () => ({}));
jest.mock("./clickhouse", () => ({
  ...jest.requireActual<typeof import("./clickhouse")>("./clickhouse"),
  query: jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(mockRows) }),
  ),
}));
const request = {
  workspaceId: "workspace-' OR 1=1 --",
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-11-01T00:00:00.000Z",
};
const broadcasts = [
  {
    id: "broadcast",
    journeyId: "internal-journey",
    name: "Fall broadcast",
    createdAt: new Date("2026-10-01"),
    triggeredAt: null,
  },
  {
    id: "new-broadcast",
    journeyId: null,
    name: "New broadcast",
    createdAt: new Date("2026-10-20"),
    triggeredAt: null,
  },
];
const startsAt = "2026-10-13T00:00:00.000Z";

it.each([{ broadcastId: "broadcast-'" }, { journeyId: "flow-'" }, {}])(
  "binds scope %j, including legacy broadcast mappings, and deduplicates before aggregation",
  (source) => {
    const result = buildLinkClicksQuery(request, broadcasts, source);
    expect(result.query_params).toMatchObject({
      v0: request.workspaceId,
      v1: request.startDate,
      v2: request.endDate,
      v3: ["internal-journey"],
      v4: ["broadcast"],
    });
    expect(result.query).not.toContain(request.workspaceId);
    expect(result.query).not.toContain("internal-journey");
    expect(result.query).toContain("PREWHERE workspace_id = {v0:String}");
    expect(result.query).toContain(
      "event_time < parseDateTime64BestEffort({v2:String}",
    );
    expect(result.query).toContain(
      "event = 'DFEmailClicked' AND hidden = false",
    );
    expect(result.query).toContain(
      "LIMIT 1 BY message_id, event_time, user_id, link",
    );
    expect(result.query).toContain(
      "uniqExactIf(user_id, user_id != '') AS allUniqueClickers",
    );
    expect(result.query).toContain("countIf(link = '') AS clicksWithoutLink");
    expect(result.query).toContain(
      "ORDER BY uniqueClickers DESC, totalClicks DESC, link ASC",
    );
    if ("broadcastId" in source) {
      expect(result.query_params.v5).toBe(source.broadcastId);
      expect(result.query).toContain("WHERE broadcastId = {v5:String}");
    } else if ("journeyId" in source) {
      expect(result.query_params.v5).toBe(source.journeyId);
      expect(result.query).toContain(
        "WHERE broadcastId = '' AND journeyId = {v5:String}",
      );
    }
  },
);
it("rejects invalid query ranges before querying", () => {
  expect(() =>
    buildLinkClicksQuery(
      { ...request, endDate: request.startDate },
      broadcasts,
    ),
  ).toThrow("valid date range");
});
it("assembles numeric counts, keeps unknown clicks in the denominator, and labels historical broadcasts", async () => {
  const rows = [
    {
      broadcastId: "broadcast",
      journeyId: "",
      templateId: "",
      link: "https://example.com/offer?raw=1",
      uniqueClickers: "2",
      totalClicks: "4",
      allUniqueClickers: "3",
      clicksWithoutLink: "1",
    },
    {
      broadcastId: "broadcast",
      journeyId: "",
      templateId: "",
      link: "",
      uniqueClickers: "1",
      totalClicks: "1",
      allUniqueClickers: "3",
      clicksWithoutLink: "1",
    },
    {
      broadcastId: "broadcast",
      journeyId: "",
      templateId: "",
      link: "https://example.com/unsubscribe",
      uniqueClickers: "1",
      totalClicks: "2",
      allUniqueClickers: "3",
      clicksWithoutLink: "1",
    },
  ];
  mockRows = rows;
  const groups = await getLinkClicks(request, broadcasts, [], [], startsAt);
  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({
    name: "Fall broadcast",
    uniqueClickers: 3,
    clicksWithoutLink: 1,
    incomplete: true,
  });
  expect(groups[0]?.rows).toEqual([
    {
      link: rows[0]?.link,
      linkKind: "content",
      uniqueClickers: 2,
      totalClicks: 4,
      clickerRate: 2 / 3,
    },
    {
      link: rows[2]?.link,
      linkKind: "unsubscribe",
      uniqueClickers: 1,
      totalClicks: 2,
      clickerRate: 1 / 3,
    },
  ]);
  expect(groups[1]).toMatchObject({ incomplete: false, rows: [] });
});
it("keeps broadcast detail empty states scoped and includes journey-template labels", async () => {
  mockRows = [];
  const groups = await getLinkClicks(request, broadcasts, [], [], startsAt, {
    broadcastId: "broadcast",
  });
  expect(groups.map((g) => g.broadcastId)).toEqual(["broadcast"]);
  expect(groups[0]).toMatchObject({ incomplete: true, rows: [] });
  mockRows = [
    {
      broadcastId: "",
      journeyId: "flow",
      templateId: "template",
      link: "https://example.com/offer",
      uniqueClickers: "1",
      totalClicks: "2",
      allUniqueClickers: "1",
      clicksWithoutLink: "0",
    },
  ];
  const flows = await getLinkClicks(
    request,
    broadcasts,
    [{ id: "flow", name: "Reminder", createdAt: new Date("2026-10-20") }],
    [{ id: "template", name: "Welcome" }],
    startsAt,
    { journeyId: "flow" },
  );
  expect(flows).toHaveLength(1);
  expect(flows[0]).toMatchObject({
    name: "Reminder · Welcome",
    broadcastId: "",
    incomplete: false,
  });
});
it.each([
  [
    "https://example.com/api/public/subscription-management/page?sub=0",
    "unsubscribe",
  ],
  [
    "https://example.com/api/public/subscription-management/page?sub=1",
    "preferences",
  ],
  ["https://example.com/preferences", "preferences"],
  ["https://example.com/api/public/view-in-browser?token=x", "view_in_browser"],
  ["https://example.com/article?utm_content=unsubscribe", "content"],
  ["https://example.com/why-unsubscribe-matters", "content"],
  ["not a URL", "content"],
])("classifies %s as %s", (link, expected) =>
  expect(classifyLink(link)).toBe(expected),
);
it("normalizes only the display, retaining campaign/content and the full original elsewhere", () => {
  const link =
    "https://example.com/offer?token=private&utm_source=email&utm_campaign=fall&utm_content=button&token=again#details";
  expect(displayLink(link)).toBe(
    "https://example.com/offer?utm_campaign=fall&utm_content=button#details",
  );
  expect(displayLink("invalid?token=private")).toBe("invalid");
});
