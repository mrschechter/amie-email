import { ChannelType } from "isomorphic-lib/src/types";

import {
  getChartData,
  getJourneyEditorStats,
  getSummarizedData,
} from "./analysis";
import { query } from "./clickhouse";

let mockRows: unknown[] = [];

jest.mock("./clickhouse", () => ({
  ...jest.requireActual<typeof import("./clickhouse")>("./clickhouse"),
  query: jest.fn(() =>
    Promise.resolve({ json: () => Promise.resolve(mockRows) }),
  ),
}));
jest.mock("./logger", () => ({
  __esModule: true,
  default: () => ({ debug: jest.fn() }),
}));

const mockQuery = jest.mocked(query);
const request = {
  workspaceId: "workspace",
  startDate: "2026-09-01",
  endDate: "2026-09-17",
};

function respondWith(rows: unknown[]) {
  mockRows = rows;
}

it.each(["2", 2])(
  "returns numeric complaint counts (%s) alongside unchanged bounces",
  async (complaints) => {
    respondWith([
      {
        sent: "2000",
        deliveries: "1000",
        opens: "50",
        clicks: "10",
        bounces: "3",
        complaints,
      },
    ]);
    const result = await getSummarizedData({
      ...request,
      filters: { channel: ChannelType.Email },
    });
    expect(result.summary).toEqual({
      sent: 2000,
      deliveries: 1000,
      opens: 50,
      clicks: 10,
      bounces: 3,
      complaints: 2,
    });
    expect(mockQuery.mock.calls[0]?.[0].query).toContain(
      "max(se.event IN ('DFEmailMarkedSpam', 'DFEmailComplaint')) as has_complained",
    );
    expect(mockQuery.mock.calls[0]?.[0].query).toContain(
      "sum(toUInt64(has_complained)) as complaints",
    );
  },
);

it.each([ChannelType.Email, ChannelType.Sms, undefined])(
  "returns zero complaints for an empty %s result",
  async (channel) => {
    respondWith([]);
    const result = await getSummarizedData({
      ...request,
      filters: { channel },
    });
    expect(result.summary.complaints).toBe(0);
    if (channel !== ChannelType.Email) {
      expect(mockQuery.mock.calls[0]?.[0].query).toContain("0 as complaints");
    }
  },
);

it("returns complained time-series and journey states", async () => {
  respondWith([
    { timestamp: "2026-09-01T00:00:00Z", groupKey: "complained", count: "2" },
  ]);
  const result = await getChartData({ ...request, groupBy: "messageState" });
  expect(result.data[0]).toMatchObject({ groupKey: "complained", count: 2 });
  expect(mockQuery.mock.calls[0]?.[0].query).toContain(
    "'complained' as event_type",
  );
  respondWith([{ node_id: "node", state: "complained", count: "2" }]);
  const stats = await getJourneyEditorStats({
    ...request,
    journeyId: "journey",
  });
  expect(stats.nodeStats.node).toMatchObject({ complained: 2, bounced: 0 });
});
