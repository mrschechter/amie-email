import {
  AnalyticsMetrics,
  AnalyticsRow,
  RevenueTotals,
} from "isomorphic-lib/src/analytics";

import type { RevenueFact } from "./revenueAttribution";

export const countKeys = [
  "sends",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complaint",
  "unsubscribed",
  "rawOpened",
  "rawClicked",
  "smsFailed",
  "attributedOrders",
  "attributedRevenueCents",
] as const;
export const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;
export function metrics(
  counts: Partial<AnalyticsMetrics> = {},
): AnalyticsMetrics {
  const c = {
    sends: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complaint: 0,
    unsubscribed: 0,
    rawOpened: 0,
    rawClicked: 0,
    smsFailed: 0,
    attributedOrders: 0,
    attributedRevenueCents: 0,
    ...counts,
  };
  return {
    ...c,
    deliveredRate: rate(c.delivered, c.sends),
    openRate: rate(c.opened, c.delivered),
    clickRate: rate(c.clicked, c.delivered),
    ctor: rate(c.clicked, c.opened),
    unsubRate: rate(c.unsubscribed, c.delivered),
    bounceRate: rate(c.bounced, c.sends),
    complaintRate: rate(c.complaint, c.delivered || c.sends),
    bounceComplaintRate: rate(c.bounced + c.complaint, c.sends),
    rpm: rate(c.attributedRevenueCents * 1000, c.sends),
  };
}
export function emptyRow(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    ...metrics(),
    id: "",
    name: "",
    sourceType: "",
    sourceId: "",
    journeyId: "",
    nodeId: "",
    templateId: "",
    broadcastId: "",
    day: "",
    lastSend: "",
    ...overrides,
  };
}
export function sumMetrics(rows: AnalyticsMetrics[]): AnalyticsMetrics {
  const counts = metrics();
  rows.forEach((row) =>
    countKeys.forEach((key) => {
      counts[key] += Number(row[key]);
    }),
  );
  return metrics(counts);
}
export function compareDeltas(
  current: AnalyticsMetrics,
  previous: AnalyticsMetrics,
): Record<string, number | null> {
  const prior: Record<string, number> = previous;
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => {
      const before = prior[key] ?? 0;
      if (before === 0) return [key, value === 0 ? 0 : null];
      return [key, (value - before) / Math.abs(before)];
    }),
  );
}
export function rollup(
  rows: AnalyticsRow[],
  key: (row: AnalyticsRow) => string,
): AnalyticsRow[] {
  const groups = new Map<string, AnalyticsRow[]>();
  rows.forEach((row) => {
    const id = key(row);
    if (id) groups.set(id, [...(groups.get(id) ?? []), row]);
  });
  return Array.from(groups, ([id, items]) =>
    emptyRow({
      ...items[0],
      ...sumMetrics(items),
      id,
      sentAt:
        items
          .map((item) => item.sentAt ?? "")
          .filter(Boolean)
          .sort()[0] ?? "",
      nodeId: "",
      templateId: "",
      day: "",
      lastSend: items.reduce(
        (last, item) => (item.lastSend > last ? item.lastSend : last),
        "",
      ),
    }),
  );
}
export const aggregateByJourney = (rows: AnalyticsRow[]) =>
  rollup(
    rows.filter((row) => !row.broadcastId),
    (row) => row.journeyId,
  );
export function revenueTotals(facts: RevenueFact[]): RevenueTotals {
  const result: RevenueTotals = {
    totalOrders: 0,
    totalRevenueCents: 0,
    attributedOrders: 0,
    attributedRevenueCents: 0,
    newOrders: 0,
    newRevenueCents: 0,
    renewalOrders: 0,
    renewalRevenueCents: 0,
    unknownOrders: 0,
    unknownRevenueCents: 0,
    unattributedOrders: 0,
    unattributedRevenueCents: 0,
  };
  facts.forEach((fact) => {
    result.totalOrders += fact.orders;
    result.totalRevenueCents += fact.revenueCents;
    if (!fact.attributed) {
      result.unattributedOrders += fact.orders;
      result.unattributedRevenueCents += fact.revenueCents;
      return;
    }
    result.attributedOrders += fact.orders;
    result.attributedRevenueCents += fact.revenueCents;
    const kind =
      fact.kind === "new" || fact.kind === "renewal" ? fact.kind : "unknown";
    result[`${kind}Orders`] += fact.orders;
    result[`${kind}RevenueCents`] += fact.revenueCents;
  });
  return result;
}
