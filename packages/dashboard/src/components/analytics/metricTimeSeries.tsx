import { AnalyticsMetrics, AnalyticsRow } from "isomorphic-lib/src/analytics";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import styles from "./analytics.module.css";

const metrics: { key: keyof AnalyticsMetrics; label: string; scale: number }[] =
  [
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
export default function MetricTimeSeries({
  rows,
  deliverability = false,
}: {
  rows: AnalyticsRow[];
  deliverability?: boolean;
}) {
  const [selected, setSelected] = useState("sends");
  const metric = metrics.find((m) => m.key === selected) ?? metrics[0];
  if (!metric) return null;
  const data = rows.map((row) => ({
    day: row.day,
    value: row[metric.key] * metric.scale,
    bounced: row.bounced,
    complaint: row.complaint,
    unsubscribed: row.unsubscribed,
  }));
  return (
    <section className={styles.card} aria-label="Daily performance chart">
      <div className={styles.toolbar}>
        <h3>
          {deliverability ? "Deliverability by day" : "Daily performance"}
        </h3>
        {!deliverability && (
          <label htmlFor="analytics-metric">
            Metric{" "}
            <select
              id="analytics-metric"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={styles.muted}>UTC · activity on each day</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid stroke="#F0E9E0" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#8A8178", fontSize: 11 }} />
          <YAxis tick={{ fill: "#8A8178", fontSize: 11 }} />
          <Tooltip contentStyle={{ borderColor: "#E3DAD1", borderRadius: 8 }} />
          {deliverability ? (
            <>
              <Line
                dataKey="bounced"
                name="Bounces"
                stroke="#B76E79"
                dot={false}
              />
              <Line
                dataKey="complaint"
                name="Complaints"
                stroke="#8A8178"
                dot={false}
              />
              <Line
                dataKey="unsubscribed"
                name="Unsubscribes"
                stroke="#2D7A7A"
                dot={false}
              />
            </>
          ) : (
            <Line
              dataKey="value"
              name={metric.label}
              stroke="#2D7A7A"
              dot={false}
              strokeWidth={2}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
