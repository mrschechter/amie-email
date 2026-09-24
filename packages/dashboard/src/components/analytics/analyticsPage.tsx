import { AnalyticsResponse } from "isomorphic-lib/src/analytics";
import Link from "next/link";
import { useState } from "react";

import {
  analyticsError,
  AnalyticsParams,
  useAnalytics,
  useAnalyticsRange,
  useRevenueOrders,
} from "../../lib/useAnalytics";
import { useDownloadRevenueAttributionMutation } from "../../lib/useRevenueAttribution";
import styles from "./analytics.module.css";
import AnalyticsLayout, {
  CalculationDrawer,
  RangeControls,
  tabs,
} from "./analyticsLayout";
import { KpiStrip, money } from "./kpiCard";
import MetricTimeSeries from "./metricTimeSeries";
import PerformanceTable from "./performanceTable";
import useMetricSelection from "./useMetricSelection";

export function QueryState({
  loading,
  error,
}: {
  loading: boolean;
  error: unknown;
}) {
  return (
    <>
      {loading && (
        <div role="status" aria-label="Loading analytics">
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      )}
      {!!error && (
        <div className={styles.error} role="alert">
          {analyticsError(error)}
        </div>
      )}
    </>
  );
}
function RevenueScreen({
  data,
  params,
  updatedAt,
}: {
  data: AnalyticsResponse;
  params: AnalyticsParams;
  updatedAt: number;
}) {
  const [group, setGroup] = useState<"flows" | "broadcasts" | "templates">(
    "flows",
  );
  const [offset, setOffset] = useState(0);
  const orders = useRevenueOrders(params, offset, data, updatedAt);
  const download = useDownloadRevenueAttributionMutation();
  const totals = data.revenue;
  if (!totals) return null;
  const cards = [
    ["Total orders / revenue", totals.totalOrders, totals.totalRevenueCents],
    ["Attributed", totals.attributedOrders, totals.attributedRevenueCents],
    ["Attributed · new", totals.newOrders, totals.newRevenueCents],
    ["Attributed · renewal", totals.renewalOrders, totals.renewalRevenueCents],
    [
      "Attributed · unknown kind",
      totals.unknownOrders,
      totals.unknownRevenueCents,
    ],
    [
      "Unattributed",
      totals.unattributedOrders,
      totals.unattributedRevenueCents,
    ],
  ] as const;
  const sourceName = (order: {
    broadcastId: string;
    journeyId: string;
    templateId: string;
    messageId: string;
  }) => {
    if (!order.messageId) return "Unattributed";
    return (
      data.broadcasts.find((b) => b.id === order.broadcastId)?.name ??
      data.flows.find((f) => f.id === order.journeyId)?.name ??
      data.rows.find((t) => t.templateId === order.templateId)?.name ??
      "Direct message"
    );
  };
  return (
    <>
      <p>
        Last-touch, click-based, {data.windowDays}-day window; opens ignored
      </p>
      <div className={styles.cards}>
        {cards.map(([label, count, revenue]) => (
          <div key={label} className={styles.card}>
            <div className={styles.cardLabel}>{label}</div>
            <div className={styles.value}>{money(revenue)}</div>
            <div>{count.toLocaleString()} orders</div>
          </div>
        ))}
      </div>
      <div className={styles.toolbar}>
        <h2>Revenue by source</h2>
        <select
          aria-label="Revenue source grouping"
          value={group}
          onChange={(e) => {
            const { value } = e.target;
            if (
              value === "flows" ||
              value === "broadcasts" ||
              value === "templates"
            )
              setGroup(value);
          }}
        >
          <option value="flows">Flows</option>
          <option value="broadcasts">Broadcasts</option>
          <option value="templates">Templates</option>
        </select>
      </div>
      <PerformanceTable
        rows={
          {
            flows: data.flows,
            broadcasts: data.broadcasts,
            templates: data.rows,
          }[group]
        }
        mode="mini"
      />
      <div className={styles.toolbar}>
        <h2>Orders</h2>
        <button
          type="button"
          className={styles.primary}
          disabled={download.isPending}
          onClick={() => download.mutate({ ...params, exportKind: "orders" })}
        >
          {download.isPending ? "Exporting…" : "Download all orders CSV"}
        </button>
      </div>
      <QueryState
        loading={orders.isLoading}
        error={orders.error ?? download.error}
      />
      {orders.data && (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {[
                    "Order",
                    "Date (UTC)",
                    "Amount",
                    "Kind",
                    "Attributed to",
                    "Minutes since click",
                  ].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.data.orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.empty}>
                      No orders in this range.
                    </td>
                  </tr>
                )}
                {orders.data.orders.map((order) => (
                  <tr key={order.orderId}>
                    <td>
                      <Link href={`/users/${encodeURIComponent(order.userId)}`}>
                        {order.orderId}
                      </Link>
                    </td>
                    <td>{order.date}</td>
                    <td>{money(order.amountCents)}</td>
                    <td>{order.kind}</td>
                    <td>
                      {order.broadcastId || order.journeyId ? (
                        <Link
                          href={{
                            pathname: order.broadcastId
                              ? `/broadcasts/${order.broadcastId}`
                              : `/journeys/${order.journeyId}`,
                            query: {
                              tab: "performance",
                              startDate: params.startDate,
                              endDate: params.endDate,
                              compare: String(params.compare !== false),
                            },
                          }}
                        >
                          {sourceName(order)}
                        </Link>
                      ) : (
                        sourceName(order)
                      )}
                    </td>
                    <td>
                      {order.minutesSinceClick === null
                        ? "—"
                        : order.minutesSinceClick.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.toolbar}>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </button>
            <span>
              Orders {offset + 1}–{offset + orders.data.orders.length}
            </span>
            <button
              type="button"
              disabled={!orders.data.hasMore}
              onClick={() => setOffset(offset + 100)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </>
  );
}
export default function AnalyticsPage({ tab }: { tab: (typeof tabs)[number] }) {
  const range = useAnalyticsRange();
  const selection = useMetricSelection();
  const [windowDays, setWindowDays] = useState<5 | 7 | 14 | undefined>();
  const params = { ...range.params, ...(windowDays && { windowDays }) };
  const query = useAnalytics(
    tab === "revenue" ? "revenue/report" : tab,
    params,
  );
  const { data } = query;
  return (
    <AnalyticsLayout tab={tab}>
      <RangeControls {...range} />
      <div className={styles.toolbar}>
        {tab === "overview" && (
          <CalculationDrawer windowDays={data?.windowDays ?? 5} />
        )}
        {tab === "revenue" && (
          <label htmlFor="analytics-window">
            Attribution window{" "}
            <select
              id="analytics-window"
              value={windowDays ?? data?.windowDays ?? ""}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value === 5 || value === 7 || value === 14)
                  setWindowDays(value);
              }}
            >
              <option value="" disabled>
                Configured default
              </option>
              {[5, 7, 14].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
            <span className={styles.muted}>Applies to this view only</span>
          </label>
        )}
      </div>
      <QueryState loading={query.isLoading} error={query.error} />
      {data && (
        <>
          {tab === "overview" && (
            <>
              <KpiStrip data={data} {...selection} />
              <MetricTimeSeries rows={data.daily} {...selection} />
              <div className={styles.split}>
                <div>
                  <h2>
                    <Link
                      href={{
                        pathname: "/analysis/flows",
                        query: {
                          ...range.params,
                          compare: String(range.params.compare),
                        },
                      }}
                    >
                      Top flows →
                    </Link>
                  </h2>
                  <PerformanceTable rows={data.flows} mode="mini" compact />
                </div>
                <div>
                  <h2>
                    <Link
                      href={{
                        pathname: "/analysis/broadcasts",
                        query: {
                          ...range.params,
                          compare: String(range.params.compare),
                        },
                      }}
                    >
                      Top broadcasts →
                    </Link>
                  </h2>
                  <PerformanceTable
                    rows={data.broadcasts.filter(
                      (row) => row.sends > 0 || row.attributedOrders > 0,
                    )}
                    mode="mini"
                    compact
                  />
                </div>
              </div>
            </>
          )}
          {(tab === "flows" || tab === "broadcasts" || tab === "emails") && (
            <>
              <h2>
                {
                  {
                    flows: "Flow performance",
                    broadcasts: "Broadcast performance",
                    emails: "Email performance",
                  }[tab]
                }
              </h2>
              <PerformanceTable
                rows={data.rows}
                mode={tab}
                sources={data.sources}
              />
            </>
          )}
          {tab === "revenue" && (
            <RevenueScreen
              key={JSON.stringify(params)}
              data={data}
              params={params}
              updatedAt={query.dataUpdatedAt}
            />
          )}
          {tab === "deliverability" && (
            <>
              <MetricTimeSeries rows={data.daily} deliverability />
              <h2>By recipient domain</h2>
              <PerformanceTable rows={data.rows} mode="domain" />
              <h2>Hard bounces and complaints</h2>
              <p className={styles.muted}>
                Only explicitly classified hard bounces are listed. Older events
                may omit the classification. Most recent 1,000 address/event
                combinations.
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Event</th>
                      <th>Last event (UTC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.addresses.length === 0 && (
                      <tr>
                        <td colSpan={3} className={styles.empty}>
                          No classified hard bounces or complaints in this
                          range.
                        </td>
                      </tr>
                    )}
                    {data.addresses.map((row) => (
                      <tr key={`${row.userId}:${row.address}:${row.event}`}>
                        <td>
                          <Link
                            href={`/users/${encodeURIComponent(row.userId)}`}
                          >
                            {row.address}
                          </Link>
                        </td>
                        <td>
                          {row.event === "DFEmailBounced"
                            ? "Hard bounce"
                            : "Complaint"}
                        </td>
                        <td>{row.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </AnalyticsLayout>
  );
}
