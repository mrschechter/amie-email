import { Static, Type } from "@sinclair/typebox";

export const AnalyticsRequest = Type.Object({
  workspaceId: Type.String(),
  startDate: Type.String({ format: "date-time" }),
  endDate: Type.String({ format: "date-time" }),
  compare: Type.Optional(Type.Boolean()),
  windowDays: Type.Optional(
    Type.Union([Type.Literal(5), Type.Literal(7), Type.Literal(14)]),
  ),
});
export type AnalyticsRequest = Static<typeof AnalyticsRequest>;
export const AnalyticsMetrics = Type.Object({
  sends: Type.Number(),
  delivered: Type.Number(),
  opened: Type.Number(),
  clicked: Type.Number(),
  bounced: Type.Number(),
  complaint: Type.Number(),
  unsubscribed: Type.Number(),
  rawOpened: Type.Number(),
  rawClicked: Type.Number(),
  smsFailed: Type.Number(),
  attributedOrders: Type.Number(),
  attributedRevenueCents: Type.Number(),
  deliveredRate: Type.Number(),
  openRate: Type.Number(),
  clickRate: Type.Number(),
  ctor: Type.Number(),
  unsubRate: Type.Number(),
  bounceRate: Type.Number(),
  complaintRate: Type.Number(),
  bounceComplaintRate: Type.Number(),
  rpm: Type.Number(),
});
export type AnalyticsMetrics = Static<typeof AnalyticsMetrics>;
export const AnalyticsRow = Type.Intersect([
  AnalyticsMetrics,
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    sourceType: Type.String(),
    sourceId: Type.String(),
    journeyId: Type.String(),
    nodeId: Type.String(),
    templateId: Type.String(),
    broadcastId: Type.String(),
    templateName: Type.Optional(Type.String()),
    href: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    entered: Type.Optional(Type.Number()),
    completed: Type.Optional(Type.Number()),
    audienceSize: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    sentAt: Type.Optional(Type.String()),
    lastSend: Type.String(),
    day: Type.String(),
  }),
]);
export type AnalyticsRow = Static<typeof AnalyticsRow>;
export const RevenueOrder = Type.Object({
  orderId: Type.String(),
  userId: Type.String(),
  date: Type.String(),
  amountCents: Type.Number(),
  kind: Type.String(),
  journeyId: Type.String(),
  broadcastId: Type.String(),
  templateId: Type.String(),
  nodeId: Type.String(),
  messageId: Type.String(),
  minutesSinceClick: Type.Union([Type.Number(), Type.Null()]),
});
export type RevenueOrder = Static<typeof RevenueOrder>;
export const RevenueTotals = Type.Object({
  totalOrders: Type.Number(),
  totalRevenueCents: Type.Number(),
  attributedOrders: Type.Number(),
  attributedRevenueCents: Type.Number(),
  newOrders: Type.Number(),
  newRevenueCents: Type.Number(),
  renewalOrders: Type.Number(),
  renewalRevenueCents: Type.Number(),
  unknownOrders: Type.Number(),
  unknownRevenueCents: Type.Number(),
  unattributedOrders: Type.Number(),
  unattributedRevenueCents: Type.Number(),
});
export type RevenueTotals = Static<typeof RevenueTotals>;
export const AnalyticsResponse = Type.Object({
  windowDays: Type.Number(),
  startDate: Type.String(),
  endDate: Type.String(),
  summary: AnalyticsMetrics,
  previous: Type.Optional(AnalyticsMetrics),
  deltas: Type.Record(Type.String(), Type.Union([Type.Number(), Type.Null()])),
  rows: Type.Array(AnalyticsRow),
  daily: Type.Array(AnalyticsRow),
  flows: Type.Array(AnalyticsRow),
  broadcasts: Type.Array(AnalyticsRow),
  sources: Type.Array(AnalyticsRow),
  funnel: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      count: Type.Number(),
    }),
  ),
  revenue: Type.Optional(RevenueTotals),
  orders: Type.Optional(Type.Array(RevenueOrder)),
  ordersHasMore: Type.Optional(Type.Boolean()),
  addresses: Type.Array(
    Type.Object({
      userId: Type.String(),
      address: Type.String(),
      event: Type.String(),
      date: Type.String(),
    }),
  ),
});
export type AnalyticsResponse = Static<typeof AnalyticsResponse>;

export const DAY_MS = 86400000;
// All analytics periods are half-open [start, end), including the previous period.
export function validateAnalyticsRange(
  startDate: string,
  endDate: string,
): void {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 400 * DAY_MS
  ) {
    throw Object.assign(
      new Error("Choose a valid date range of at most 400 days."),
      { statusCode: 400 },
    );
  }
}
export function previousPeriod(startDate: string, endDate: string) {
  validateAnalyticsRange(startDate, endDate);
  return {
    startDate: new Date(
      2 * Date.parse(startDate) - Date.parse(endDate),
    ).toISOString(),
    endDate: startDate,
  };
}
