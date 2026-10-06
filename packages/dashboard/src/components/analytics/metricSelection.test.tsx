/** @jest-environment jsdom */
import { Value } from "@sinclair/typebox/value";
import { AnalyticsResponse, AnalyticsRow } from "isomorphic-lib/src/analytics";
import { NextRouter } from "next/router";
import React, { act, ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";

import AnalyticsPage from "./analyticsPage";
import { chartMetrics } from "./chartMetrics";
import { KpiCard } from "./kpiCard";
import PerformancePanel from "./performancePanel";

const mockRouter = jest.fn();
const mockAnalytics = jest.fn();
const mockRange = jest.fn();
jest.mock("next/router", () => ({ useRouter: () => mockRouter() }));
jest.mock("../../lib/useAnalytics", () => ({
  useAnalytics: () => mockAnalytics(),
  useAnalyticsRange: () => mockRange(),
}));
jest.mock("../../lib/useRevenueAttribution", () => ({
  useDownloadRevenueAttributionMutation: jest.fn(),
}));
jest.mock("./analyticsLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RangeControls: () => null,
  CalculationDrawer: () => null,
}));
jest.mock("./performanceTable", () => ({
  __esModule: true,
  default: () => null,
  StatusPill: () => null,
}));
jest.mock("../deliveriesTableV2", () => ({ DeliveriesTableV2: () => null }));
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
    <div data-chart={JSON.stringify(data)}>{children}</div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <span data-line={dataKey} />,
  YAxis: ({
    tickFormatter,
    allowDecimals,
    domain,
  }: {
    tickFormatter: (n: number) => string;
    allowDecimals: boolean;
    domain: unknown;
  }) => (
    <span
      data-axis={tickFormatter(12.5)}
      data-decimals={allowDecimals}
      data-domain={JSON.stringify(domain)}
    />
  ),
  XAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;
let query: NextRouter["query"];
let render: () => void;
let push: jest.Mock;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  query = {
    startDate: "2026-09-01",
    endDate: "2026-09-23",
    compare: "false",
    tab: "performance",
    id: "source",
  };
  push = jest.fn((url: { query: NextRouter["query"] }) => {
    query = url.query;
    render();
    return Promise.resolve(true);
  });
  mockRouter.mockImplementation(() => ({
    query,
    pathname: "/analysis/overview",
    push,
  }));
  const data = Value.Create(AnalyticsResponse);
  data.daily = [
    {
      ...Value.Create(AnalyticsRow),
      id: "day",
      day: "2026-09-01",
      name: "",
      journeyId: "",
      nodeId: "",
      templateId: "",
      broadcastId: "",
      sends: 10000,
      openRate: 0.125,
    },
  ];
  mockAnalytics.mockReturnValue({
    data,
    isLoading: false,
    dataUpdatedAt: Date.now(),
  });
  mockRange.mockReturnValue({
    params: {
      startDate: "2026-09-01",
      endDate: "2026-09-23",
      compare: false,
    },
    setRange: jest.fn(),
  });
  render = () => root.render(<AnalyticsPage tab="overview" />);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const lines = () =>
  Array.from(container.querySelectorAll("[data-line]"), (node) =>
    node.getAttribute("data-line"),
  );
const button = (label: string) => {
  const result = Array.from(container.querySelectorAll("button")).find((node) =>
    node.textContent?.startsWith(label),
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
};

it.each(["overview", "flows", "broadcasts"])(
  "isolates and restores from KPI cards on %s",
  (view) => {
    if (view === "flows" || view === "broadcasts")
      render = () => root.render(<PerformancePanel kind={view} id="source" />);
    act(render);
    expect(lines()).toEqual(chartMetrics.map((metric) => metric.key));
    act(() => button("Open rate").click());
    expect(lines()).toEqual(["openRate"]);
    expect(button("Open rate").getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector("[data-axis]")?.getAttribute("data-axis"),
    ).toBe("12.5%");
    expect(
      container.querySelector("[data-axis]")?.getAttribute("data-domain"),
    ).toBe('[0,"auto"]');
    expect(
      JSON.parse(
        container.querySelector("[data-chart]")?.getAttribute("data-chart") ??
          "[]",
      ),
    ).toEqual([{ day: "2026-09-01", openRate: 12.5 }]);
    expect(query).toMatchObject({
      metric: "openRate",
      compare: "false",
      tab: "performance",
      id: "source",
    });
    expect(push).toHaveBeenLastCalledWith(expect.anything(), undefined, {
      shallow: true,
      scroll: false,
    });
    act(() => button("Open rate").click());
    expect(lines()).toHaveLength(chartMetrics.length);
    expect(query.metric).toBeUndefined();
    expect(button("Open rate").getAttribute("aria-pressed")).toBe("false");
    act(() => button("Sends").click());
    expect(lines()).toEqual(["sends"]);
    expect(
      container.querySelector("[data-axis]")?.getAttribute("data-axis"),
    ).toBe("13");
    expect(
      container.querySelector("[data-axis]")?.getAttribute("data-decimals"),
    ).toBe("false");
    act(() => button("Show all").click());
    expect(lines()).toHaveLength(chartMetrics.length);
  },
);
it.each([
  "openRate",
  "attributedRevenueCents",
  "unknown",
  ["openRate", "sends"],
])("restores URL selection %j on mount and navigation", (metric) => {
  query.metric = metric;
  act(render);
  expect(lines()).toEqual(
    typeof metric === "string" && metric !== "unknown"
      ? [metric]
      : chartMetrics.map((m) => m.key),
  );
  if (metric === "attributedRevenueCents")
    expect(
      container.querySelector("[data-axis]")?.getAttribute("data-axis"),
    ).toBe("$12.5");
  query = { ...query, metric: "sends" };
  act(render);
  expect(lines()).toEqual(["sends"]);
});
it.each(["Enter", " "])(
  "uses a focusable native button for %j keyboard activation",
  (key) => {
    act(render);
    const card = button("Open rate");
    card.focus();
    expect(document.activeElement).toBe(card);
    expect(card.type).toBe("button");
    expect(card.tabIndex).toBe(0);
    // jsdom has no native keyboard default actions; model the browser-generated click.
    act(() => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      card.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(lines()).toEqual(["openRate"]);
  },
);
it("keeps a card without a chart action non-interactive", () => {
  act(() => root.render(<KpiCard label="No series" value="1" values={[]} />));
  expect(
    container.querySelector("button, [aria-pressed], [tabindex]"),
  ).toBeNull();
  expect(container.firstElementChild?.getAttribute("class")).not.toContain(
    "kpiButton",
  );
});
