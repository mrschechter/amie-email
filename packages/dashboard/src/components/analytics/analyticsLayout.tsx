import { DAY_MS } from "isomorphic-lib/src/analytics";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useRef } from "react";

import { AnalyticsParams, useAnalyticsRange } from "../../lib/useAnalytics";
import DashboardContent from "../dashboardContent";
import styles from "./analytics.module.css";

export const tabs = [
  "overview",
  "flows",
  "broadcasts",
  "emails",
  "revenue",
  "deliverability",
] as const;
export function RangeControls({
  params,
  setRange,
}: {
  params: AnalyticsParams;
  setRange: (params: Partial<AnalyticsParams>) => void;
}) {
  const endValue = Number.isFinite(Date.parse(params.endDate))
    ? new Date(Date.parse(params.endDate) - 1).toISOString().slice(0, 10)
    : "";
  return (
    <div className={styles.toolbar}>
      <label htmlFor="analytics-range">
        Range{" "}
        <select
          id="analytics-range"
          aria-label="Date range preset"
          value="custom"
          onChange={(e) => {
            if (e.target.value === "custom") return;
            const end = new Date();
            end.setUTCHours(0, 0, 0, 0);
            end.setUTCDate(end.getUTCDate() + 1);
            setRange({
              startDate: new Date(
                end.getTime() - Number(e.target.value) * DAY_MS,
              ).toISOString(),
              endDate: end.toISOString(),
            });
          }}
        >
          <option value="custom">
            {Date.parse(params.endDate) - Date.parse(params.startDate) ===
            30 * DAY_MS
              ? "Last 30 days / custom"
              : "Custom range"}
          </option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </label>
      <label htmlFor="analytics-from">
        From{" "}
        <input
          id="analytics-from"
          type="date"
          value={params.startDate.slice(0, 10)}
          onChange={(e) => {
            if (e.target.value)
              setRange({ startDate: `${e.target.value}T00:00:00.000Z` });
          }}
        />
      </label>
      <label htmlFor="analytics-through">
        Through{" "}
        <input
          id="analytics-through"
          type="date"
          value={endValue}
          onChange={(e) => {
            if (e.target.value)
              setRange({
                endDate: new Date(
                  Date.parse(`${e.target.value}T00:00:00.000Z`) + DAY_MS,
                ).toISOString(),
              });
          }}
        />
      </label>
      <label htmlFor="analytics-compare">
        <input
          id="analytics-compare"
          type="checkbox"
          checked={params.compare !== false}
          onChange={(e) => setRange({ compare: e.target.checked })}
        />
        Compare previous period
      </label>
      <span className={styles.muted}>UTC · up to 400 days</span>
    </div>
  );
}
export function CalculationDrawer({ windowDays }: { windowDays: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()}>
        How these are calculated
      </button>
      <dialog
        ref={dialog}
        className={styles.drawer}
        aria-labelledby="calculation-title"
      >
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
        <h2 id="calculation-title">How these are calculated</h2>
        <dl>
          <dt>Delivered %</dt>
          <dd>Delivered / sent.</dd>
          <dt>Open %</dt>
          <dd>
            Unique opened / delivered. Apple Mail Privacy Protection (MPP)
            inflates opens.
          </dd>
          <dt>Click % (CTR)</dt>
          <dd>
            Unique clicked / delivered. CTOR = unique clicked / unique opened.
          </dd>
          <dt>Unsub %</dt>
          <dd>Unsubscribed / delivered.</dd>
          <dt>Bounce %</dt>
          <dd>
            Bounced / sent. Complaint % = complaints / sent. The combined card
            uses (bounced + complaints) / sent.
          </dd>
          <dt>Attributed revenue</dt>
          <dd>
            Last click within the {windowDays}-day window before order_paid; one
            order → one message. Opens are ignored. Clicks can precede the
            reporting range. Revenue is reported on the order date, in USD,
            without currency conversion.
          </dd>
          <dt>RPM</dt>
          <dd>Attributed revenue / sends × 1000.</dd>
          <dt>Counts and dates</dt>
          <dd>
            Events are counted in the selected UTC range, including the start
            and excluding the end. Opens and clicks count each message once
            across the period; raw repeat counts are also retained. Daily points
            count each message once per day and may sum higher than the
            period&apos;s unique counts. Delivery is counted from delivery
            events; opens and clicks do not imply a delivery. Zero denominators
            produce 0%.
          </dd>
          <dt>Compare</dt>
          <dd>
            The previous period is the immediately preceding window of equal
            length. Deltas are relative changes, not percentage-point changes. A
            nonzero value after zero is labeled “New”.
          </dd>
          <dt>Flows and funnel</dt>
          <dd>
            Flows aggregate every message node. Entered, message steps, and
            completed count recorded node-processing events within the range.
            These are activity counts, not a conversion cohort; branches and
            re-entry can change the proportions.
          </dd>
          <dt>Broadcast audience</dt>
          <dd>
            Audience size is the current stored segment membership. A historical
            audience snapshot is not available. Sent at is the recorded trigger
            time when available.
          </dd>
          <dt>Unsubscribes and recipient domains</dt>
          <dd>
            Unsubscribe events without message metadata remain in overall counts
            and cannot be assigned to a flow or template. Domains come from the
            recorded recipient address; unrecognized or missing email domains
            appear as “other”. SMS failures are retained as counts and are not
            email bounces.
          </dd>
          <dt>Hard-bounce addresses</dt>
          <dd>
            Only explicitly classified hard or permanent bounces appear in the
            address list. Older events may omit the classification; all recorded
            bounces still count in the bounce rate. The list shows the 1,000
            most recent address/event combinations.
          </dd>
        </dl>
      </dialog>
    </>
  );
}
export default function AnalyticsLayout({
  tab,
  children,
}: {
  tab: (typeof tabs)[number];
  children: ReactNode;
}) {
  const router = useRouter();
  const query = Object.fromEntries(
    Object.entries(router.query).filter(([key]) =>
      ["startDate", "endDate", "compare"].includes(key),
    ),
  );
  return (
    <DashboardContent>
      <main className={styles.root}>
        <h1>Analytics</h1>
        <div className={styles.muted}>
          Amie Send · understand every flow, broadcast, and email
        </div>
        <nav className={styles.tabs} aria-label="Analytics tabs">
          {tabs.map((item) => (
            <Link
              key={item}
              href={{ pathname: `/analysis/${item}`, query }}
              aria-current={item === tab ? "page" : undefined}
            >
              {item[0]?.toUpperCase()}
              {item.slice(1)}
            </Link>
          ))}
        </nav>
        {children}
      </main>
    </DashboardContent>
  );
}
export function AnalyticsRangeControls() {
  const range = useAnalyticsRange();
  return <RangeControls {...range} />;
}
