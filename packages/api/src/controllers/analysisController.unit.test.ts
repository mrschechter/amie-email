import { getAnalytics } from "backend-lib/src/analytics";
import { getRevenueOrders } from "backend-lib/src/revenueAttribution";
import Fastify from "fastify";
import {
  AnalyticsResponse,
  validateAnalyticsRange,
} from "isomorphic-lib/src/analytics";

import analysisController from "./analysisController";

jest.mock("backend-lib/src/analysis", () => ({
  getChartData: jest.fn(),
  getJourneyEditorStats: jest.fn(),
  getSummarizedData: jest.fn(),
}));
jest.mock("backend-lib/src/analytics", () => ({ getAnalytics: jest.fn() }));
jest.mock("backend-lib/src/revenueAttribution", () => ({
  buildRevenueAttributionFile: jest.fn(),
  getRevenueSummary: jest.fn(),
  getRevenueBreakdown: jest.fn(),
  getRevenueOrders: jest.fn(),
}));
const report: AnalyticsResponse = {
  windowDays: 5,
  startDate: "2026-08-01T00:00:00.000Z",
  endDate: "2026-08-31T00:00:00.000Z",
  summary: {
    sends: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complaint: 0,
    unsubscribed: 0,
    rawOpened: 0,
    rawClicked: 0,
    smsFailed: 0,
    attributedOrders: 0,
    attributedRevenueCents: 0,
    deliveredRate: 0,
    openRate: 0,
    clickRate: 0,
    ctor: 0,
    unsubRate: 0,
    bounceRate: 0,
    complaintRate: 0,
    bounceComplaintRate: 0,
    rpm: 0,
  },
  rows: [],
  daily: [],
  flows: [],
  broadcasts: [],
  sources: [],
  funnel: [],
  addresses: [],
  deltas: {},
};
const params = {
  workspaceId: "workspace",
  startDate: report.startDate,
  endDate: report.endDate,
};
const id = "955b7f09-0a58-4af6-93f2-3e878a290ff3";

describe("analytics API (DB-free)", () => {
  const app = Fastify();
  beforeAll(async () => {
    await app.register(analysisController, { prefix: "/api/analysis" });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAnalytics).mockImplementation((request) => {
      validateAnalyticsRange(request.startDate, request.endDate);
      return Promise.resolve(report);
    });
  });
  it.each([
    "overview",
    "flows",
    "broadcasts",
    "emails",
    "deliverability",
    "revenue/report",
  ])("serves %s with validated query options", async (route) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/analysis/${route}`,
      query: { ...params, compare: "false", windowDays: "14" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(report);
    expect(getAnalytics).toHaveBeenCalledWith(
      { ...params, compare: false, windowDays: 14 },
      route === "revenue/report" ? "revenue" : route,
    );
  });
  it.each(["flows", "broadcasts"])("binds the %s detail ID", async (route) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/analysis/${route}/${id}`,
      query: params,
    });
    expect(response.statusCode).toBe(200);
    expect(getAnalytics).toHaveBeenCalledWith(params, route, id);
  });
  it("rejects invalid windows, dates, IDs and excessive ranges inline", async () => {
    await Promise.all(
      [
        { ...params, windowDays: "9" },
        { ...params, startDate: "invalid" },
        { ...params, endDate: "2028-08-01T00:00:00.000Z" },
      ].map(async (query) => {
        const response = await app.inject({
          method: "GET",
          url: "/api/analysis/overview",
          query,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<{ message: string }>().message).toBeTruthy();
      }),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/analysis/flows/not-an-id",
          query: params,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("pages orders and preserves the existing revenue endpoints", async () => {
    jest.mocked(getRevenueOrders).mockResolvedValue([]);
    const response = await app.inject({
      method: "GET",
      url: "/api/analysis/revenue/orders",
      query: { ...params, offset: "100" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ orders: [], hasMore: false });
    expect(getRevenueOrders).toHaveBeenCalledWith(
      { ...params, offset: 100 },
      101,
      100,
    );
    for (const route of ["summary", "breakdown", "download"])
      expect(
        app.hasRoute({ method: "GET", url: `/api/analysis/revenue/${route}` }),
      ).toBe(true);
  });
});
