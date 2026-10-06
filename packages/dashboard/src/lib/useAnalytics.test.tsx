/** @jest-environment jsdom */
import { Value } from "@sinclair/typebox/value";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import { AnalyticsResponse } from "isomorphic-lib/src/analytics";
import { CompletionStatus } from "isomorphic-lib/src/types";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";

import { useAnalytics, useRevenueOrders } from "./useAnalytics";

let mockReady: boolean;

jest.mock("axios");
jest.mock("next/router", () => ({ useRouter: () => ({ isReady: mockReady }) }));
jest.mock("./appStore", () => ({
  useAppStorePick: () => ({
    workspace: {
      type: CompletionStatus.Successful,
      value: { id: "workspace" },
    },
  }),
}));
jest.mock("./authModeProvider", () => ({
  useAuthHeaders: () => ({}),
  useBaseApiUrl: () => "/api",
}));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
const params = {
  startDate: "2026-09-01",
  endDate: "2026-09-23",
  compare: true,
};
let root: Root;
let client: QueryClient;
beforeEach(() => {
  root = createRoot(document.createElement("div"));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mockReady = true;
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
async function render(children: React.ReactNode) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    );
  });
}
it("waits for URL hydration and reuses structurally equal keys on rerender and fresh remount", async () => {
  jest
    .mocked(axios.get)
    .mockResolvedValue({ data: Value.Create(AnalyticsResponse) });
  function Report() {
    useAnalytics("overview", { ...params });
    return null;
  }
  mockReady = false;
  await render(<Report />);
  expect(axios.get).not.toHaveBeenCalled();
  mockReady = true;
  await render(
    <>
      <Report />
      <Report />
    </>,
  );
  expect(axios.get).toHaveBeenCalledTimes(1);
  await render(<Report />);
  expect(axios.get).toHaveBeenCalledTimes(1);
  const query = client.getQueryCache().getAll()[0];
  expect(query?.options).toMatchObject({
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
});
it("reuses first-page orders from the report, fetches subsequent pages, and scopes a changed range", async () => {
  jest
    .mocked(axios.get)
    .mockResolvedValue({ data: { orders: [], hasMore: false } });
  const report = {
    ...Value.Create(AnalyticsResponse),
    orders: [],
    ordersHasMore: true,
  };
  function Orders({
    offset,
    startDate = params.startDate,
  }: {
    offset: number;
    startDate?: string;
  }) {
    const result = useRevenueOrders(
      { ...params, startDate },
      offset,
      report,
      Date.now(),
    );
    return <span>{String(result.data?.hasMore)}</span>;
  }
  await render(<Orders offset={0} />);
  expect(axios.get).not.toHaveBeenCalled();
  await render(<Orders offset={100} />);
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenLastCalledWith(
    "/api/analysis/revenue/orders",
    expect.objectContaining({
      params: { ...params, offset: 100, workspaceId: "workspace" },
    }),
  );
  await render(<Orders offset={0} />);
  expect(axios.get).toHaveBeenCalledTimes(1);
  await render(<Orders offset={100} startDate="2026-09-02" />);
  expect(axios.get).toHaveBeenCalledTimes(2);
});
