import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  AnalyticsRequest,
  AnalyticsResponse,
  DAY_MS,
  RevenueOrder,
} from "isomorphic-lib/src/analytics";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { CompletionStatus } from "isomorphic-lib/src/types";
import { useRouter } from "next/router";
import { useEffect, useMemo } from "react";

import { useAppStorePick } from "./appStore";
import { useAuthHeaders, useBaseApiUrl } from "./authModeProvider";

export type AnalyticsParams = Omit<AnalyticsRequest, "workspaceId">;
export function defaultAnalyticsRange() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    startDate: new Date(end.getTime() - 30 * DAY_MS).toISOString(),
    endDate: end.toISOString(),
    compare: true,
  };
}
export function useAnalyticsRange() {
  const router = useRouter();
  const defaults = useMemo(defaultAnalyticsRange, []);
  const startDate =
    typeof router.query.startDate === "string"
      ? router.query.startDate
      : defaults.startDate;
  const endDate =
    typeof router.query.endDate === "string"
      ? router.query.endDate
      : defaults.endDate;
  const compare = router.query.compare !== "false";
  useEffect(() => {
    if (
      router.isReady &&
      (!router.query.startDate ||
        !router.query.endDate ||
        !router.query.compare)
    ) {
      void router.replace(
        {
          pathname: router.pathname,
          query: {
            ...router.query,
            startDate,
            endDate,
            compare: String(compare),
          },
        },
        undefined,
        { shallow: true },
      );
    }
  }, [router, startDate, endDate, compare]);
  return {
    params: { startDate, endDate, compare },
    setRange: (range: Partial<AnalyticsParams>) => {
      void router.push(
        {
          pathname: router.pathname,
          query: {
            ...router.query,
            startDate,
            endDate,
            compare: String(compare),
            ...range,
          },
        },
        undefined,
        { shallow: true },
      );
    },
  };
}
export function useAnalytics(view: string, params: AnalyticsParams) {
  const { workspace } = useAppStorePick(["workspace"]);
  const headers = useAuthHeaders();
  const base = useBaseApiUrl();
  const workspaceId =
    workspace.type === CompletionStatus.Successful
      ? workspace.value.id
      : undefined;
  return useQuery({
    queryKey: ["analyticsV1", view, workspaceId, params],
    enabled: !!workspaceId,
    staleTime: 60000,
    queryFn: async () => {
      const response = await axios.get(`${base}/analysis/${view}`, {
        headers,
        params: { ...params, workspaceId },
      });
      return unwrap(schemaValidateWithErr(response.data, AnalyticsResponse));
    },
  });
}
export function useRevenueOrders(params: AnalyticsParams, offset: number) {
  const { workspace } = useAppStorePick(["workspace"]);
  const headers = useAuthHeaders();
  const base = useBaseApiUrl();
  const workspaceId =
    workspace.type === CompletionStatus.Successful
      ? workspace.value.id
      : undefined;
  return useQuery({
    queryKey: ["analyticsOrders", workspaceId, params, offset],
    enabled: !!workspaceId,
    queryFn: async () =>
      (
        await axios.get<{ orders: RevenueOrder[]; hasMore: boolean }>(
          `${base}/analysis/revenue/orders`,
          { headers, params: { ...params, workspaceId, offset } },
        )
      ).data,
  });
}
export function analyticsError(error: unknown): string {
  if (axios.isAxiosError<{ message?: string }>(error))
    return error.response?.data.message ?? error.message;
  return error instanceof Error
    ? error.message
    : "Analytics could not be loaded.";
}
