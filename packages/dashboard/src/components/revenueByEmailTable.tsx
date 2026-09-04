import { DownloadForOffline } from "@mui/icons-material";
import {
  Box,
  Button,
  Paper,
  Skeleton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from "@mui/material";
import { keepPreviousData } from "@tanstack/react-query";
import {
  RevenueAttributionFilters,
  RevenueBreakdownRow,
} from "isomorphic-lib/src/types";
import { useCallback, useMemo, useState } from "react";

import { useResourcesQuery } from "../lib/useResourcesQuery";
import {
  useDownloadRevenueAttributionMutation,
  useRevenueBreakdownQuery,
} from "../lib/useRevenueAttribution";

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type SortKey =
  | "source"
  | "template"
  | "sends"
  | "clicks"
  | "orders"
  | "revenue"
  | "revenuePerThousand";

interface RevenueByEmailTableProps {
  dateRange: { startDate: string; endDate: string };
  filters?: RevenueAttributionFilters;
}

export function RevenueByEmailTable({
  dateRange,
  filters,
}: RevenueByEmailTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [ascending, setAscending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const breakdown = useRevenueBreakdownQuery(
    { ...dateRange, groupBy: "email", ...(filters && { filters }) },
    { placeholderData: keepPreviousData },
  );
  const resources = useResourcesQuery(
    { journeys: true, broadcasts: true, messageTemplates: true },
    { staleTime: 5 * 60 * 1000 },
  );
  const download = useDownloadRevenueAttributionMutation();

  const names = useMemo(
    () => ({
      journeys: new Map(
        resources.data?.journeys?.map((item) => [item.id, item.name]) ?? [],
      ),
      broadcasts: new Map(
        resources.data?.broadcasts?.map((item) => [item.id, item.name]) ?? [],
      ),
      templates: new Map(
        resources.data?.messageTemplates?.map((item) => [item.id, item.name]) ??
          [],
      ),
    }),
    [resources.data],
  );

  const sourceName = useCallback(
    (row: RevenueBreakdownRow) => {
      if (row.sourceType === "broadcast") {
        return names.broadcasts.get(row.sourceId) ?? row.sourceId;
      }
      if (row.sourceType === "journey") {
        return names.journeys.get(row.sourceId) ?? row.sourceId;
      }
      return row.sourceId || "Direct message";
    },
    [names],
  );

  const sortedRows = useMemo(() => {
    const rows = [...(breakdown.data?.rows ?? [])];
    const value = (row: RevenueBreakdownRow): string | number => {
      switch (sortKey) {
        case "source":
          return sourceName(row);
        case "template":
          return names.templates.get(row.templateId) ?? row.templateId;
        case "sends":
          return row.sends;
        case "clicks":
          return row.clicks;
        case "orders":
          return row.attributedOrders;
        case "revenue":
          return row.attributedRevenueCents;
        case "revenuePerThousand":
          return row.revenuePerThousandSendsCents;
      }
    };
    return rows.sort((left, right) => {
      const a = value(left);
      const b = value(right);
      const comparison =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
      return ascending ? comparison : -comparison;
    });
  }, [ascending, breakdown.data?.rows, names, sortKey, sourceName]);

  const sort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setAscending((value) => !value);
    } else {
      setSortKey(nextKey);
      setAscending(nextKey === "source" || nextKey === "template");
    }
  };

  const header = (label: string, key: SortKey, align: "left" | "right") => (
    <TableCell align={align}>
      <TableSortLabel
        active={sortKey === key}
        direction={ascending ? "asc" : "desc"}
        onClick={() => sort(key)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.25,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box>
          <Typography fontWeight={500}>Revenue by email</Typography>
          <Typography variant="body2" color="text.secondary">
            Last-click attribution within the configured window · new and
            renewal orders
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<DownloadForOffline />}
          disabled={download.isPending}
          onClick={() =>
            download.mutate(
              { ...dateRange, ...(filters && { filters }) },
              {
                onSuccess: () => setNotice("Downloaded revenue CSV."),
                onError: () => setNotice("Revenue CSV download failed."),
              },
            )
          }
        >
          Download CSV
        </Button>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {header("Broadcast / journey", "source", "left")}
              {header("Template", "template", "left")}
              {header("Sends", "sends", "right")}
              {header("Clicks", "clicks", "right")}
              {header("Orders", "orders", "right")}
              {header("Revenue", "revenue", "right")}
              {header("Revenue / 1k sends", "revenuePerThousand", "right")}
            </TableRow>
          </TableHead>
          <TableBody>
            {breakdown.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton height={80} />
                </TableCell>
              </TableRow>
            )}
            {!breakdown.isLoading && sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  No messages or attributed orders in this date range.
                </TableCell>
              </TableRow>
            )}
            {!breakdown.isLoading &&
              sortedRows.length > 0 &&
              sortedRows.map((row) => (
                <TableRow
                  key={`${row.sourceType}:${row.sourceId}:${row.journeyNodeId}:${row.templateId}`}
                  hover
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {sourceName(row)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.sourceType}
                      {row.journeyNodeId ? ` · node ${row.journeyNodeId}` : ""}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {names.templates.get(row.templateId) ??
                      (row.templateId.length > 0 ? row.templateId : "—")}
                  </TableCell>
                  <TableCell align="right">
                    {row.sends.toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    {row.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {row.attributedOrders.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.attributedNewOrders} new ·{" "}
                      {row.attributedRenewalOrders} renewal
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {formatUsd(row.attributedRevenueCents)}
                  </TableCell>
                  <TableCell align="right">
                    {formatUsd(row.revenuePerThousandSendsCents)}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar
        open={notice !== null}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        message={notice}
      />
    </Paper>
  );
}
