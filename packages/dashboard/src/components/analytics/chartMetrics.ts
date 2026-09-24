import { AnalyticsMetrics } from "isomorphic-lib/src/analytics";

export const chartMetrics: {
  key: keyof AnalyticsMetrics;
  label: string;
  scale: number;
}[] = [
  { key: "sends", label: "Sends", scale: 1 },
  { key: "deliveredRate", label: "Delivered %", scale: 100 },
  { key: "openRate", label: "Open %", scale: 100 },
  { key: "clickRate", label: "Click % (CTR)", scale: 100 },
  { key: "ctor", label: "CTOR %", scale: 100 },
  { key: "unsubRate", label: "Unsubscribe %", scale: 100 },
  { key: "bounceRate", label: "Bounce %", scale: 100 },
  { key: "complaintRate", label: "Complaint %", scale: 100 },
  {
    key: "attributedRevenueCents",
    label: "Attributed revenue (USD)",
    scale: 0.01,
  },
  { key: "attributedOrders", label: "Attributed orders", scale: 1 },
  { key: "rpm", label: "RPM (USD)", scale: 0.01 },
];

export function chartMetric(value: unknown) {
  return chartMetrics.find((metric) => metric.key === value);
}
