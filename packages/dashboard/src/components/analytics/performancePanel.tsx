import {
  analyticsError,
  useAnalytics,
  useAnalyticsRange,
} from "../../lib/useAnalytics";
import {
  DEFAULT_DELIVERIES_TABLE_V2_PROPS,
  DeliveriesTableV2,
} from "../deliveriesTableV2";
import styles from "./analytics.module.css";
import { CalculationDrawer, RangeControls } from "./analyticsLayout";
import { QueryState } from "./analyticsPage";
import { KpiStrip } from "./kpiCard";
import MetricTimeSeries from "./metricTimeSeries";
import PerformanceTable, { StatusPill } from "./performanceTable";

export default function PerformancePanel({
  kind,
  id,
}: {
  kind: "flows" | "broadcasts";
  id: string;
}) {
  const range = useAnalyticsRange();
  const query = useAnalytics(`${kind}/${id}`, range.params);
  const { data } = query;
  const resource = (kind === "flows" ? data?.flows : data?.broadcasts)?.find(
    (r) => r.id === id,
  );
  return (
    <section className={styles.root}>
      <h1>{resource?.name ?? "Performance"}</h1>
      <div className={styles.toolbar}>
        <span>Performance</span>
        {resource?.status && <StatusPill status={resource.status} />}
        <CalculationDrawer windowDays={data?.windowDays ?? 5} />
      </div>
      <RangeControls {...range} />
      <QueryState loading={query.isLoading} error={query.error} />
      {data && (
        <>
          <KpiStrip data={data} />
          <h2>{kind === "flows" ? "Message steps" : "Templates"}</h2>
          <PerformanceTable
            rows={data.rows}
            mode={kind === "flows" ? "messages" : "emails"}
            sources={data.sources}
          />
          {kind === "flows" && (
            <>
              <h2>Step funnel</h2>
              <p className={styles.muted}>
                Node activity in this period. Branches and re-entry mean these
                counts are not a conversion cohort.
              </p>
              <div className={styles.card}>
                {data.funnel.length === 0 ? (
                  <p>No journey node activity in this range.</p>
                ) : (
                  <ol className={styles.funnel}>
                    {data.funnel.map((step) => (
                      <li key={step.id}>
                        <span>{step.name}</span>
                        <div className={styles.bar}>
                          <span
                            style={{
                              width: `${(100 * step.count) / Math.max(1, ...data.funnel.map((s) => s.count))}%`,
                            }}
                          />
                        </div>
                        <strong>{step.count.toLocaleString()}</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
          <h2>Daily performance</h2>
          <MetricTimeSeries rows={data.daily} />
          <h2>Recent deliveries</h2>
          <DeliveriesTableV2
            {...DEFAULT_DELIVERIES_TABLE_V2_PROPS}
            key={`${range.params.startDate}:${range.params.endDate}`}
            journeyId={kind === "flows" ? id : undefined}
            broadcastId={kind === "broadcasts" ? id : undefined}
            initialDateRange={{
              startDate: range.params.startDate,
              endDate: range.params.endDate,
            }}
          />
        </>
      )}
      {!data && !query.isLoading && !query.error && (
        <p>
          {analyticsError(new Error("Select a workspace to view performance."))}
        </p>
      )}
    </section>
  );
}
