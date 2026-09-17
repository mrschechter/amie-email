import {
  Box,
  Card,
  CardContent,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { keepPreviousData } from "@tanstack/react-query";
import { ChannelType, SummaryMetric } from "isomorphic-lib/src/types";
import React, { useMemo } from "react";

import { useAnalysisSummaryQuery } from "../../lib/useAnalysisSummaryQuery";
import { useRevenueSummaryQuery } from "../../lib/useRevenueAttribution";
import { formatUsd } from "../revenueByEmailTable";
import {
  AnalysisFilterKey,
  AnalysisFiltersState,
  FilterType,
} from "./analysisChartFilters";

interface AnalysisSummaryPanelProps {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  filtersState: AnalysisFiltersState;
  displayMode: "absolute" | "percentage";
}

interface MetricCardProps {
  title: string;
  value: number | string;
  isLoading?: boolean;
  isPercentage?: boolean;
  subtitle?: string;
  warning?: boolean;
  tooltip?: string;
}

function formatMetricValue(value: number | string, isPercentage: boolean) {
  if (isPercentage && typeof value === "number") {
    return `${value.toFixed(1)}%`;
  }
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  return value;
}

function MetricCard({
  title,
  value,
  isLoading = false,
  isPercentage = false,
  subtitle,
  warning = false,
  tooltip,
}: MetricCardProps) {
  return (
    <Tooltip title={tooltip ?? ""}>
      <Card
        variant="outlined"
        sx={{
          minWidth: 140,
          flex: 1,
          boxShadow: 2,
          textAlign: "left",
        }}
      >
        <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
          <Typography variant="overline" display="block">
            {title}
          </Typography>
          {isLoading ? (
            <Skeleton variant="text" width={72} height={36} />
          ) : (
            <Typography
              component="div"
              sx={{
                color: warning ? "error.main" : "secondary.800",
                fontSize: "25px",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                lineHeight: 1.2,
                mt: 0.75,
              }}
            >
              {formatMetricValue(value, isPercentage)}
            </Typography>
          )}
          {subtitle && !isLoading && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Tooltip>
  );
}

export function AnalysisSummaryPanel({
  dateRange,
  filtersState,
  displayMode,
}: AnalysisSummaryPanelProps) {
  // Helper to extract keys from a filter (handles both MultiSelect and Value types)
  const getFilterKeys = (
    filterKey: AnalysisFilterKey,
  ): string[] | undefined => {
    const filter = filtersState.filters.get(filterKey);
    if (!filter) return undefined;
    if (filter.type === FilterType.MultiSelect) {
      return Array.from(filter.value.keys());
    }
    // For Value filters, return the value as a single-item array
    return filter.value ? [filter.value] : undefined;
  };

  // Check if channel filter is already applied
  const hasChannelFilter = filtersState.filters.has("channels");
  const channelKeys = getFilterKeys("channels");
  const selectedChannel: ChannelType =
    hasChannelFilter && channelKeys?.[0]
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        (channelKeys[0] as ChannelType)
      : ChannelType.Email;

  // Build filters object from filter state
  const filters = useMemo(() => {
    const getKeys = (filterKey: AnalysisFilterKey): string[] | undefined => {
      const filter = filtersState.filters.get(filterKey);
      if (!filter) return undefined;
      if (filter.type === FilterType.MultiSelect) {
        return Array.from(filter.value.keys());
      }
      return filter.value ? [filter.value] : undefined;
    };

    const journeyIds = getKeys("journeyIds");
    const broadcastIds = getKeys("broadcastIds");
    const channels = getKeys("channels");
    const providers = getKeys("providers");
    const messageStates = getKeys("messageStates");
    const templateIds = getKeys("templateIds");

    // Only return filters object if at least one filter is set
    if (
      !journeyIds &&
      !broadcastIds &&
      !channels &&
      !providers &&
      !messageStates &&
      !templateIds
    ) {
      return undefined;
    }

    return {
      ...(journeyIds && { journeyIds }),
      ...(broadcastIds && { broadcastIds }),
      ...(channels && { channels }),
      ...(providers && { providers }),
      ...(messageStates && { messageStates }),
      ...(templateIds && { templateIds }),
    };
  }, [filtersState]);

  const summaryQuery = useAnalysisSummaryQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      filters: {
        ...filters,
        channel: selectedChannel,
      },
    },
    {
      placeholderData: keepPreviousData,
    },
  );
  const revenueFilters = useMemo(() => {
    if (!filters) return undefined;
    const filtered = {
      journeyIds: filters.journeyIds,
      broadcastIds: filters.broadcastIds,
      templateIds: filters.templateIds,
    };
    return filtered.journeyIds || filtered.broadcastIds || filtered.templateIds
      ? filtered
      : undefined;
  }, [filters]);
  const revenueQuery = useRevenueSummaryQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(revenueFilters && { filters: revenueFilters }),
    },
    { placeholderData: keepPreviousData },
  );
  const revenue = revenueQuery.data?.summary;
  const revenueCards = (
    <>
      <MetricCard
        title="ATTRIBUTED REVENUE"
        value={revenue ? formatUsd(revenue.attributedRevenueCents) : "$0.00"}
        subtitle={
          revenue
            ? `${formatUsd(revenue.attributedNewRevenueCents)} new · ${formatUsd(revenue.attributedRenewalRevenueCents)} renewal`
            : undefined
        }
        isLoading={revenueQuery.isLoading}
      />
      <MetricCard
        title="ATTRIBUTED ORDERS"
        value={revenue?.attributedOrders ?? 0}
        subtitle={
          revenue
            ? `${revenue.attributedNewOrders.toLocaleString()} new · ${revenue.attributedRenewalOrders.toLocaleString()} renewal`
            : undefined
        }
        isLoading={revenueQuery.isLoading}
      />
    </>
  );
  const unattributedLine = !revenueFilters && (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
      Orders without a recent email click: {revenue?.unattributedOrders ?? 0} /{" "}
      {formatUsd(revenue?.unattributedRevenueCents ?? 0)}
    </Typography>
  );

  // Calculate percentage values when in percentage mode
  const summary = useMemo(() => {
    const rawSummary: SummaryMetric = summaryQuery.data?.summary ?? {
      sent: 0,
      deliveries: 0,
      opens: 0,
      clicks: 0,
      bounces: 0,
      complaints: 0,
    };

    if (displayMode === "percentage" && rawSummary.sent > 0) {
      return {
        sent: 100, // Sent is always 100% in percentage mode
        deliveries: (rawSummary.deliveries / rawSummary.sent) * 100,
        opens: (rawSummary.opens / rawSummary.sent) * 100,
        clicks: (rawSummary.clicks / rawSummary.sent) * 100,
        bounces: (rawSummary.bounces / rawSummary.sent) * 100,
      };
    }
    return rawSummary;
  }, [summaryQuery.data?.summary, displayMode]);

  const complaints = summaryQuery.data?.summary.complaints ?? 0;
  const delivered = summaryQuery.data?.summary.deliveries ?? 0;
  const denominator =
    delivered > 0 ? delivered : summaryQuery.data?.summary.sent ?? 0;
  const complaintRate = denominator > 0 ? complaints / denominator : 0;

  return (
    <Box sx={{ py: 1, width: "100%" }}>
      <Stack direction="row" gap={1.75} flexWrap="wrap" justifyContent="center">
        <MetricCard
          title="SENT"
          value={summary.sent}
          isLoading={summaryQuery.isLoading}
          isPercentage={displayMode === "percentage"}
        />
        <MetricCard
          title="DELIVERED"
          value={summary.deliveries}
          isLoading={summaryQuery.isLoading}
          isPercentage={displayMode === "percentage"}
        />
        {selectedChannel === ChannelType.Email && (
          <MetricCard
            title="OPENED"
            value={summary.opens}
            isLoading={summaryQuery.isLoading}
            isPercentage={displayMode === "percentage"}
          />
        )}
        {selectedChannel === ChannelType.Email && (
          <MetricCard
            title="CLICKED"
            value={summary.clicks}
            isLoading={summaryQuery.isLoading}
            isPercentage={displayMode === "percentage"}
          />
        )}
        <MetricCard
          title={selectedChannel === ChannelType.Email ? "BOUNCED" : "FAILED"}
          value={summary.bounces}
          isLoading={summaryQuery.isLoading}
          isPercentage={displayMode === "percentage"}
        />
        {selectedChannel === ChannelType.Email && (
          <MetricCard
            title="SPAM COMPLAINTS"
            value={complaints}
            subtitle={`${(complaintRate * 100).toFixed(2)}%`}
            warning={complaintRate >= 0.001}
            tooltip="Complaints ÷ delivered, from SES feedback notifications"
            isLoading={summaryQuery.isLoading}
          />
        )}
        {revenueCards}
      </Stack>
      {unattributedLine}
    </Box>
  );
}
