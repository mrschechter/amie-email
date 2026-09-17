import {
  AnalyticsMetrics,
  AnalyticsResponse,
} from "isomorphic-lib/src/analytics";

import styles from "./analytics.module.css";
import DeltaChip from "./deltaChip";

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export function KpiCard({
  label,
  value,
  delta,
  values,
  detail,
  lowerIsBetter,
  warning,
  tooltip,
}: {
  label: string;
  value: string;
  delta?: number | null;
  values: number[];
  detail?: string;
  lowerIsBetter?: boolean;
  warning?: boolean;
  tooltip?: string;
}) {
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const points = values
    .map(
      (v, i) =>
        `${(i * 240) / Math.max(1, values.length - 1)},${30 - ((v - min) / (max - min)) * 28}`,
    )
    .join(" ");
  return (
    <div className={styles.card} title={tooltip}>
      <div className={styles.cardLabel}>{label}</div>
      <div
        className={styles.value}
        style={warning ? { color: "#B42318" } : undefined}
      >
        {value}
      </div>
      {delta !== undefined && (
        <DeltaChip delta={delta} lowerIsBetter={lowerIsBetter} />
      )}
      {detail && <div className={styles.muted}>{detail}</div>}
      <svg
        className={styles.spark}
        viewBox="0 0 240 32"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}, daily trend`}
      >
        <polyline
          points={points}
          fill="none"
          stroke="#2D7A7A"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}
export function KpiStrip({ data }: { data: AnalyticsResponse }) {
  const cards: {
    key: keyof AnalyticsMetrics;
    label: string;
    percent?: boolean;
    currency?: boolean;
    detail?: string;
    lowerIsBetter?: boolean;
  }[] = [
    { key: "sends", label: "Sends" },
    { key: "deliveredRate", label: "Delivered rate", percent: true },
    {
      key: "openRate",
      label: "Open rate",
      percent: true,
      detail: "Apple MPP can inflate opens",
    },
    {
      key: "clickRate",
      label: "Click rate (CTR)",
      percent: true,
      detail: `CTOR ${(data.summary.ctor * 100).toFixed(1)}%`,
    },
    {
      key: "unsubRate",
      label: "Unsubscribe rate",
      percent: true,
      lowerIsBetter: true,
    },
    {
      key: "bounceRate",
      label: "Bounce rate",
      percent: true,
      lowerIsBetter: true,
    },
    {
      key: "complaintRate",
      label: "SPAM COMPLAINTS",
      percent: true,
      lowerIsBetter: true,
      detail: `${(data.summary.complaintRate * 100).toFixed(2)}%`,
    },
    {
      key: "attributedRevenueCents",
      label: "Attributed revenue",
      currency: true,
    },
    {
      key: "attributedOrders",
      label: "Attributed orders",
      detail: `RPM ${money(data.summary.rpm)}`,
    },
  ];
  const formatValue = (value: number, currency = false) =>
    currency ? money(value) : value.toLocaleString();
  return (
    <div className={styles.cards}>
      {cards.map((card) => {
        let value = formatValue(data.summary[card.key], card.currency);
        if (card.key === "complaintRate") {
          value = data.summary.complaint.toLocaleString();
        } else if (card.percent) {
          value = `${(data.summary[card.key] * 100).toFixed(1)}%`;
        }
        const trendKey = card.key === "complaintRate" ? "complaint" : card.key;
        return (
          <KpiCard
            key={card.key}
            label={card.label}
            value={value}
            delta={data.previous ? data.deltas[trendKey] : undefined}
            values={data.daily.map((day) => day[trendKey])}
            detail={card.detail}
            lowerIsBetter={card.lowerIsBetter}
            warning={
              card.key === "complaintRate" &&
              data.summary.complaintRate >= 0.001
            }
            tooltip={
              card.key === "complaintRate"
                ? "Complaints ÷ delivered, from SES feedback notifications"
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
