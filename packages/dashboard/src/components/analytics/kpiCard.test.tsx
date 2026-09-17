/** @jest-environment jsdom */
import { AnalyticsResponse } from "isomorphic-lib/src/analytics";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { KpiStrip } from "./kpiCard";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it("separates bounce and spam complaint cards with count, rate, and threshold hint", () => {
  const data: AnalyticsResponse = {
    windowDays: 7,
    startDate: "2026-09-01",
    endDate: "2026-09-17",
    summary: {
      sends: 2000,
      delivered: 1000,
      opened: 100,
      clicked: 20,
      bounced: 5,
      complaint: 1,
      unsubscribed: 0,
      rawOpened: 100,
      rawClicked: 20,
      smsFailed: 0,
      attributedOrders: 0,
      attributedRevenueCents: 0,
      deliveredRate: 0.5,
      openRate: 0.1,
      clickRate: 0.02,
      ctor: 0.2,
      unsubRate: 0,
      bounceRate: 0.0025,
      complaintRate: 0.001,
      bounceComplaintRate: 0.003,
      rpm: 0,
    },
    deltas: {},
    rows: [],
    daily: [],
    flows: [],
    broadcasts: [],
    sources: [],
    funnel: [],
    addresses: [],
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<KpiStrip data={data} />));
    const card = container.querySelector<HTMLElement>(
      '[title="Complaints ÷ delivered, from SES feedback notifications"]',
    );
    expect(card?.textContent).toBe("SPAM COMPLAINTS10.10%");
    expect(card?.previousElementSibling?.textContent).toContain("Bounce rate");
    expect(container.textContent).not.toContain("Bounce + complaint");
    expect(card?.children[1]?.getAttribute("style")).toContain(
      "rgb(180, 35, 24)",
    );
    data.summary.complaintRate = 0.0005;
    act(() => root.render(<KpiStrip data={data} />));
    expect(card?.textContent).toBe("SPAM COMPLAINTS10.05%");
    expect(card?.children[1]?.getAttribute("style")).not.toContain("color");
  } finally {
    act(() => root.unmount());
  }
});
