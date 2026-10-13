/** @jest-environment jsdom */
import { LinkClickGroup } from "isomorphic-lib/src/linkClicks";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import LinksClicked from "./linksClicked";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
it("renders normalized URLs, full hover values, metrics, kinds, and the historical-data note", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const group: LinkClickGroup = {
    broadcastId: "broadcast",
    journeyId: "",
    templateId: "",
    name: "Fall broadcast",
    uniqueClickers: 2,
    clicksWithoutLink: 1,
    incomplete: true,
    rows: [
      {
        link: "https://example.com/offer?token=private&utm_campaign=fall&utm_content=cta",
        linkKind: "content",
        uniqueClickers: 1,
        totalClicks: 3,
        clickerRate: 0.5,
      },
    ],
  };
  act(() =>
    root.render(
      <LinksClicked
        data={{
          linkClicks: [group],
          linkDataStartsAt: "2026-10-13T00:00:00.000Z",
        }}
      />,
    ),
  );
  expect(container.textContent).toContain("Links clicked");
  expect(container.textContent).toContain("Fall broadcast");
  expect(container.textContent).toContain("Link-level data starts 2026-10-13");
  expect(container.textContent).toContain(
    "1 clicks in this period have no link URL",
  );
  expect(container.textContent).toContain("50.0%");
  expect(container.textContent).not.toContain("token=private");
  expect(container.querySelector("span[title]")?.getAttribute("title")).toBe(
    group.rows[0]?.link,
  );
  expect(container.querySelector("span[title]")?.textContent).toBe(
    "https://example.com/offer?utm_campaign=fall&utm_content=cta",
  );
  act(() =>
    root.render(
      <LinksClicked
        data={{
          linkClicks: [
            { ...group, incomplete: false, clicksWithoutLink: 0, rows: [] },
          ],
        }}
      />,
    ),
  );
  expect(container.textContent).not.toContain("Link-level data starts");
  expect(container.textContent).toContain("No link-level clicks in this range");
  act(() => root.unmount());
});
