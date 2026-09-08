import { ColumnDef } from "@tanstack/react-table";
import { AnalyticsRow } from "isomorphic-lib/src/analytics";

import { money } from "./kpiCard";
import RateCell from "./rateCell";

export function performanceColumns<T extends { id: string }>(
  rows?: AnalyticsRow[],
): ColumnDef<T>[] {
  const byId = new Map(rows?.map((row) => [row.id, row]));
  return [
    {
      id: "analyticsOpen",
      header: "Open % (30d)",
      accessorFn: (row) => byId.get(row.id)?.openRate,
      cell: ({ row }) => {
        const data = byId.get(row.original.id);
        return data ? (
          <RateCell count={data.opened} denominator={data.delivered} />
        ) : (
          <span
            title={
              rows
                ? "No sends in this range"
                : "Performance data has not loaded"
            }
          >
            —
          </span>
        );
      },
    },
    {
      id: "analyticsClick",
      header: "Click % (30d)",
      accessorFn: (row) => byId.get(row.id)?.clickRate,
      cell: ({ row }) => {
        const data = byId.get(row.original.id);
        return data ? (
          <RateCell count={data.clicked} denominator={data.delivered} />
        ) : (
          "—"
        );
      },
    },
    {
      id: "analyticsRevenue",
      header: "Attributed revenue (30d)",
      accessorFn: (row) => byId.get(row.id)?.attributedRevenueCents,
      cell: ({ row }) => {
        const data = byId.get(row.original.id);
        return data ? money(data.attributedRevenueCents) : "—";
      },
    },
  ];
}
