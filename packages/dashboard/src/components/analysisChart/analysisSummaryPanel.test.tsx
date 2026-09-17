/** @jest-environment jsdom */
import { ChannelType, SummaryMetric } from "isomorphic-lib/src/types";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";

import {
  AnalysisFiltersState,
  FilterType,
  StageType,
} from "./analysisChartFilters";
import { AnalysisSummaryPanel } from "./analysisSummaryPanel";

let mockSummary: SummaryMetric;
jest.mock("../../lib/useAnalysisSummaryQuery", () => ({
  useAnalysisSummaryQuery: () => ({
    data: { summary: mockSummary },
    isLoading: false,
  }),
}));
jest.mock("../../lib/useRevenueAttribution", () => ({
  useRevenueSummaryQuery: () => ({ isLoading: false }),
}));
jest.mock("../revenueByEmailTable", () => ({ formatUsd: () => "$0.00" }));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

describe("spam complaint summary", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mockSummary = {
      sent: 2000,
      deliveries: 1000,
      opens: 100,
      clicks: 10,
      bounces: 3,
      complaints: 1,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    channel: ChannelType = ChannelType.Email,
    displayMode: "absolute" | "percentage" = "absolute",
  ) {
    const filtersState: AnalysisFiltersState = {
      open: false,
      inputValue: "",
      stage: { type: StageType.SelectKey },
      filters: new Map([
        ["channels", { type: FilterType.Value, value: channel }],
      ]),
    };
    act(() =>
      root.render(
        <AnalysisSummaryPanel
          dateRange={{ startDate: "2026-09-01", endDate: "2026-09-17" }}
          filtersState={filtersState}
          displayMode={displayMode}
        />,
      ),
    );
    return Array.from(container.querySelectorAll(".MuiCard-root")).find(
      (card) => card.textContent?.includes("SPAM COMPLAINTS"),
    );
  }

  it.each(["absolute", "percentage"] as const)(
    "shows count and delivered-based rate after bounces in %s mode",
    (mode) => {
      const card = render(ChannelType.Email, mode);
      expect(card?.textContent).toBe("SPAM COMPLAINTS10.10%");
      expect(card?.previousElementSibling?.textContent).toContain("BOUNCED");
      expect(card?.getAttribute("aria-label")).toBe(
        "Complaints ÷ delivered, from SES feedback notifications",
      );
      const value = card?.querySelector<HTMLElement>(
        ".MuiTypography-root:nth-child(2)",
      );
      if (!value) throw new Error("Missing complaint count");
      expect(getComputedStyle(value).color).toBe("rgb(211, 47, 47)");
    },
  );

  it("uses sent as fallback and keeps sub-threshold rates neutral", () => {
    mockSummary.deliveries = 0;
    const card = render();
    expect(card?.textContent).toBe("SPAM COMPLAINTS10.05%");
    const value = card?.querySelector<HTMLElement>(
      ".MuiTypography-root:nth-child(2)",
    );
    if (!value) throw new Error("Missing complaint count");
    expect(getComputedStyle(value).color).not.toBe("rgb(211, 47, 47)");
  });

  it("handles zero denominators and hides complaints for non-email channels", () => {
    mockSummary = {
      sent: 0,
      deliveries: 0,
      opens: 0,
      clicks: 0,
      bounces: 0,
      complaints: 0,
    };
    expect(render()?.textContent).toBe("SPAM COMPLAINTS00.00%");
    expect(render(ChannelType.Sms)).toBeUndefined();
  });
});
