import {
  useMutation,
  UseMutationResult,
  useQuery,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import axios, { AxiosError } from "axios";
import FileSaver from "file-saver";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  CompletionStatus,
  DownloadRevenueAttributionRequest,
  GetRevenueBreakdownRequest,
  GetRevenueBreakdownResponse,
  GetRevenueSummaryRequest,
  GetRevenueSummaryResponse,
} from "isomorphic-lib/src/types";

import { useAppStorePick } from "./appStore";
import { useAuthHeaders, useBaseApiUrl } from "./authModeProvider";

export function useRevenueSummaryQuery(
  params: Omit<GetRevenueSummaryRequest, "workspaceId">,
  options?: Omit<
    UseQueryOptions<GetRevenueSummaryResponse>,
    "queryKey" | "queryFn"
  >,
): UseQueryResult<GetRevenueSummaryResponse> {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();
  if (workspace.type !== CompletionStatus.Successful) {
    throw new Error("Workspace not available for revenue summary query");
  }
  const workspaceId = workspace.value.id;
  return useQuery<GetRevenueSummaryResponse>({
    queryKey: ["revenueSummary", { ...params, workspaceId }],
    queryFn: async () => {
      const response = await axios.get(
        `${baseApiUrl}/analysis/revenue/summary`,
        {
          params: { ...params, workspaceId },
          headers: authHeaders,
        },
      );
      return unwrap(
        schemaValidateWithErr(response.data, GetRevenueSummaryResponse),
      );
    },
    ...options,
  });
}

export function useRevenueBreakdownQuery(
  params: Omit<GetRevenueBreakdownRequest, "workspaceId">,
  options?: Omit<
    UseQueryOptions<GetRevenueBreakdownResponse>,
    "queryKey" | "queryFn"
  >,
): UseQueryResult<GetRevenueBreakdownResponse> {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();
  if (workspace.type !== CompletionStatus.Successful) {
    throw new Error("Workspace not available for revenue breakdown query");
  }
  const workspaceId = workspace.value.id;
  return useQuery<GetRevenueBreakdownResponse>({
    queryKey: ["revenueBreakdown", { ...params, workspaceId }],
    queryFn: async () => {
      const response = await axios.get(
        `${baseApiUrl}/analysis/revenue/breakdown`,
        {
          params: { ...params, workspaceId },
          headers: authHeaders,
        },
      );
      return unwrap(
        schemaValidateWithErr(response.data, GetRevenueBreakdownResponse),
      );
    },
    ...options,
  });
}

type RevenueDownloadParams = Omit<
  DownloadRevenueAttributionRequest,
  "workspaceId"
>;

export function useDownloadRevenueAttributionMutation(): UseMutationResult<
  undefined,
  AxiosError,
  RevenueDownloadParams
> {
  const { workspace } = useAppStorePick(["workspace"]);
  const authHeaders = useAuthHeaders();
  const baseApiUrl = useBaseApiUrl();
  return useMutation<undefined, AxiosError, RevenueDownloadParams>({
    mutationFn: async (params) => {
      if (workspace.type !== CompletionStatus.Successful) {
        throw new Error("Workspace not available for revenue download");
      }
      const response = await axios.get(
        `${baseApiUrl}/analysis/revenue/download`,
        {
          params: { ...params, workspaceId: workspace.value.id },
          headers: authHeaders,
          responseType: "blob",
        },
      );
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const disposition = response.headers["content-disposition"] as
        | string
        | undefined;
      const match = disposition?.match(
        /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
      );
      const fileName =
        match?.[1]?.replace(/['"]/g, "") ?? "revenue-attribution.csv";
      FileSaver.saveAs(
        new Blob([response.data], { type: "text/csv" }),
        fileName,
      );
      return undefined;
    },
  });
}
