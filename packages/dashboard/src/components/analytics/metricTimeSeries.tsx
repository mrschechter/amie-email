import { AnalyticsMetrics, AnalyticsRow } from "isomorphic-lib/src/analytics";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import styles from "./analytics.module.css";
import { chartMetric, chartMetrics } from "./chartMetrics";

const colors = [
  "#2D7A7A",
  "#5F7350",
  "#966239",
  "#7564A0",
  "#B76E79",
  "#426B9A",
  "#B42318",
  "#896B25",
  "#58636D",
  "#A04A76",
  "#467D65",
];
const unit = (scale: number) => {
  if (scale === 100) return "rate";
  return scale === 0.01 ? "currency" : "count";
};
const format = (scale: number, value: number) => {
  if (scale === 100) return `${value.toLocaleString()}%`;
  if (scale === 0.01) return `$${value.toLocaleString()}`;
  return Math.round(value).toLocaleString();
};
export default function MetricTimeSeries({
  rows,
  deliverability = false,
  selectedMetric,
  onSelectMetric,
}: {
  rows: AnalyticsRow[];
  deliverability?: boolean;
  selectedMetric?: keyof AnalyticsMetrics;
  onSelectMetric?: (metric?: keyof AnalyticsMetrics) => void;
}) {
  const selected = chartMetric(selectedMetric);
  let visible = selected ? [selected] : chartMetrics;
  if (deliverability)
    visible = [
      { key: "bounced" as const, label: "Bounces", scale: 1 },
      { key: "complaint" as const, label: "Complaints", scale: 1 },
      { key: "unsubscribed" as const, label: "Unsubscribes", scale: 1 },
    ];
  const axes = [
    ...new Map(
      visible.map((metric) => [unit(metric.scale), metric.scale]),
    ).entries(),
  ];
  const data = rows.map((row) => ({
    day: row.day,
    ...Object.fromEntries(
      visible.map((metric) => [metric.key, row[metric.key] * metric.scale]),
    ),
  }));
  return (
    <section className={styles.card} aria-label="Daily performance chart">
      <div className={styles.toolbar}>
        <h3>
          {deliverability ? "Deliverability by day" : "Daily performance"}
        </h3>
        {!deliverability && onSelectMetric && (
          <>
            <label htmlFor="analytics-metric">
              Metric{" "}
              <select
                id="analytics-metric"
                value={selected?.key ?? ""}
                onChange={(e) =>
                  onSelectMetric(chartMetric(e.target.value)?.key)
                }
              >
                <option value="">All metrics</option>
                {chartMetrics.map((metric) => (
                  <option key={metric.key} value={metric.key}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <button type="button" onClick={() => onSelectMetric(undefined)}>
                Show all
              </button>
            )}
          </>
        )}
        <span className={styles.muted}>UTC · activity on each day</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid stroke="#F0E9E0" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#8A8178", fontSize: 11 }} />
          {axes.map(([axis, scale], index) => (
            <YAxis
              key={axis}
              yAxisId={axis}
              orientation={index === 0 ? "left" : "right"}
              domain={[0, "auto"]}
              allowDecimals={axis !== "count"}
              tickFormatter={(value: number) => format(scale, value)}
              tick={{ fill: "#8A8178", fontSize: 11 }}
            />
          ))}
          <Tooltip contentStyle={{ borderColor: "#E3DAD1", borderRadius: 8 }} />
          <Legend />
          {visible.map((metric, index) => (
            <Line
              key={metric.key}
              dataKey={metric.key}
              yAxisId={unit(metric.scale)}
              name={metric.label}
              stroke={
                colors[chartMetrics.findIndex((m) => m.key === metric.key)] ??
                colors[index]
              }
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
