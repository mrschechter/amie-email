import {
  Box,
  Card,
  CardContent,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { keepPreviousData } from "@tanstack/react-query";
import { subDays } from "date-fns";
import { RevenueAttributionFilters } from "isomorphic-lib/src/types";
import { useMemo, useState } from "react";

import { useRevenueSummaryQuery } from "../lib/useRevenueAttribution";
import { DateRangeSelector } from "./dateRangeSelector";
import { formatUsd } from "./revenueByEmailTable";

const detailTimeOptions = [
  {
    type: "minutes" as const,
    id: "last-7-days",
    minutes: 7 * 1440,
    label: "Last 7 days",
  },
  {
    type: "minutes" as const,
    id: "last-14-days",
    minutes: 14 * 1440,
    label: "Last 14 days",
  },
  {
    type: "minutes" as const,
    id: "last-30-days",
    minutes: 30 * 1440,
    label: "Last 30 days",
  },
  { type: "custom" as const, id: "custom" as const, label: "Custom range" },
];

export function RevenueItemSummary({
  filters,
}: {
  filters: RevenueAttributionFilters;
}) {
  const referenceDate = useMemo(() => new Date(), []);
  const [range, setRange] = useState({
    startDate: subDays(referenceDate, 30),
    endDate: referenceDate,
    selectedTimeOption: "last-30-days",
  });
  const query = useRevenueSummaryQuery(
    {
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
      filters,
    },
    { placeholderData: keepPreviousData },
  );
  const summary = query.data?.summary;
  const metrics = [
    {
      label: "Attributed revenue",
      value: summary ? formatUsd(summary.attributedRevenueCents) : "—",
    },
    {
      label: "Attributed orders",
      value: summary?.attributedOrders.toLocaleString() ?? "—",
    },
    {
      label: "Revenue / 1k sends",
      value: summary ? formatUsd(summary.revenuePerThousandSendsCents) : "—",
    },
    {
      label: "Average order value",
      value: summary ? formatUsd(summary.averageOrderValueCents) : "—",
    },
  ];

  return (
    <Box sx={{ width: "100%" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography fontWeight={500}>Revenue</Typography>
          <Typography variant="body2" color="text.secondary">
            Last-touch orders from a recent email or SMS click
          </Typography>
        </Box>
        <DateRangeSelector
          value={range}
          referenceDate={referenceDate}
          timeOptions={detailTimeOptions}
          onChange={setRange}
        />
      </Stack>
      <Stack direction="row" spacing={1.75} sx={{ width: "100%" }}>
        {metrics.map((metric) => (
          <Card key={metric.label} variant="outlined" sx={{ flex: 1 }}>
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Typography variant="overline">{metric.label}</Typography>
              {query.isLoading ? (
                <Skeleton width={80} height={34} />
              ) : (
                <Typography
                  sx={{
                    color: "secondary.800",
                    fontSize: 22,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    mt: 0.5,
                  }}
                >
                  {metric.value}
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {summary
          ? `${summary.attributedNewOrders.toLocaleString()} new · ${summary.attributedRenewalOrders.toLocaleString()} renewal orders`
          : "New and renewal order totals will appear here."}
      </Typography>
    </Box>
  );
}
