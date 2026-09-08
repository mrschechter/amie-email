import { AnalyticsRow } from "isomorphic-lib/src/analytics";
import Link from "next/link";
import { useRouter } from "next/router";
import { Fragment, ReactNode, useMemo, useState } from "react";

import styles from "./analytics.module.css";
import { money } from "./kpiCard";
import RateCell from "./rateCell";

type Mode =
  | "flows"
  | "broadcasts"
  | "emails"
  | "messages"
  | "domain"
  | "mini"
  | "sources";
interface Column {
  key: keyof AnalyticsRow;
  label: string;
  render?: (row: AnalyticsRow) => ReactNode;
  left?: boolean;
}
export function StatusPill({ status }: { status: string }) {
  let colors = ["#F1EAE1", "#8A8178", "#BBB1A6"];
  if (["Running", "Completed", "Sent"].includes(status))
    colors = ["#EFF3EA", "#5F7350", "#9CAF88"];
  if (["Paused", "Failed"].includes(status))
    colors = ["#F7E9EA", "#9A5762", "#B76E79"];
  return (
    <span
      className={styles.pill}
      style={{ background: colors[0], color: colors[1] }}
    >
      <span className={styles.dot} style={{ background: colors[2] }} />
      {status}
    </span>
  );
}
function dateLabel(value: string | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}
export default function PerformanceTable({
  rows,
  mode,
  sources = [],
  compact = false,
}: {
  rows: AnalyticsRow[];
  mode: Mode;
  sources?: AnalyticsRow[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<keyof AnalyticsRow>(
    "attributedRevenueCents",
  );
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const withRange = (href: string) => {
    const [pathname, query] = href.split("?");
    const params = new URLSearchParams(query);
    ["startDate", "endDate", "compare"].forEach((key) => {
      const value = router.query[key];
      if (typeof value === "string") params.set(key, value);
    });
    return `${pathname}?${params.toString()}`;
  };
  const columns: Column[] = [
    {
      key: "name",
      label: {
        domain: "Recipient domain",
        messages: "Step name",
        flows: "Name",
        broadcasts: "Name",
        emails: "Name",
        mini: "Name",
        sources: "Name",
      }[mode],
      left: true,
      render: (row) =>
        row.href ? (
          <Link href={withRange(row.href)}>{row.name}</Link>
        ) : (
          row.name
        ),
    },
  ];
  if (mode === "flows" || mode === "broadcasts")
    columns.push({
      key: "status",
      label: "Status",
      left: true,
      render: (row) => <StatusPill status={row.status ?? "Draft"} />,
    });
  if (mode === "flows")
    columns.push(
      { key: "entered", label: "Entered" },
      { key: "completed", label: "Completed" },
    );
  if (mode === "broadcasts")
    columns.push(
      {
        key: "audienceSize",
        label: "Audience size",
        render: (r) =>
          r.audienceSize === null ? "—" : r.audienceSize?.toLocaleString(),
      },
      {
        key: "sentAt",
        label: "Sent at",
        render: (row) => dateLabel(row.sentAt),
      },
    );
  if (mode === "messages" || mode === "sources")
    columns.push({ key: "templateName", label: "Template", left: true });
  columns.push({ key: "sends", label: "Sends" });
  const rateColumn = (
    key: keyof AnalyticsRow,
    label: string,
    numerator: keyof AnalyticsRow,
    denominator: "sends" | "delivered",
  ) => ({
    key,
    label,
    render: (row: AnalyticsRow) => (
      <RateCell count={Number(row[numerator])} denominator={row[denominator]} />
    ),
  });
  if (mode !== "mini")
    columns.push(
      rateColumn("deliveredRate", "Delivered %", "delivered", "sends"),
      rateColumn("openRate", "Open %", "opened", "delivered"),
      rateColumn("clickRate", "Click %", "clicked", "delivered"),
      rateColumn("unsubRate", "Unsub %", "unsubscribed", "delivered"),
    );
  if (mode === "domain")
    columns.push(
      rateColumn("bounceRate", "Bounce %", "bounced", "sends"),
      rateColumn("complaintRate", "Complaint %", "complaint", "sends"),
    );
  else
    columns.push(
      { key: "attributedOrders", label: "Orders" },
      {
        key: "attributedRevenueCents",
        label: "Attributed revenue",
        render: (row) => money(row.attributedRevenueCents),
      },
      { key: "rpm", label: "RPM", render: (row) => money(row.rpm) },
    );
  if (mode === "flows")
    columns.push({
      key: "lastSend",
      label: "Last send",
      render: (row) => dateLabel(row.lastSend),
    });
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.name.toLowerCase().includes(search.toLowerCase()) &&
            (!status || row.status === status),
        )
        .sort((a, b) => {
          const left = a[sort] ?? "";
          const right = b[sort] ?? "";
          const order =
            typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left).localeCompare(String(right));
          return ascending ? order : -order;
        }),
    [rows, search, status, sort, ascending],
  );
  const sortDirection = ascending ? "ascending" : "descending";
  const sortArrow = ascending ? " ↑" : " ↓";
  const renderCell = (column: Column, row: AnalyticsRow) => {
    if (column.render) return column.render(row);
    const value = row[column.key];
    return typeof value === "number"
      ? value.toLocaleString()
      : String(value ?? "—");
  };
  const pageSize = compact ? 5 : 25;
  const pageIndex = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
  );
  const visible = filtered.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize,
  );
  return (
    <>
      {rows.length > 0 && rows.every((row) => row.sends === 0) && (
        <p className={styles.muted}>No sends in this range.</p>
      )}
      {!compact && (
        <div className={styles.toolbar}>
          <input
            aria-label="Search performance"
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          {(mode === "flows" || mode === "broadcasts") && (
            <select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              {[...new Set(rows.map((r) => r.status ?? "Draft"))]
                .sort()
                .map((s) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          )}
          <span className={styles.muted}>
            {filtered.length} {mode === "messages" ? "steps" : "sources"}
          </span>
        </div>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.left ? styles.left : undefined}
                  aria-sort={sort === column.key ? sortDirection : "none"}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort(column.key);
                      setAscending(sort === column.key ? !ascending : false);
                    }}
                  >
                    {column.label}
                    {sort === column.key ? sortArrow : ""}
                  </button>
                </th>
              ))}
              {mode === "emails" && <th>Used in</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (mode === "emails" ? 1 : 0)}
                  className={styles.empty}
                >
                  {search || status
                    ? "No sources match these filters."
                    : "No sends in this range."}
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={row.href ? styles.rowLink : undefined}
                  onClick={(e) => {
                    if (
                      row.href &&
                      !(
                        e.target instanceof Element &&
                        e.target.closest("a,button")
                      )
                    )
                      void router.push(withRange(row.href));
                  }}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.left ? styles.left : undefined}
                    >
                      {renderCell(column, row)}
                    </td>
                  ))}
                  {mode === "emails" && (
                    <td>
                      <button
                        type="button"
                        aria-expanded={expanded === row.id}
                        onClick={() =>
                          setExpanded(expanded === row.id ? null : row.id)
                        }
                      >
                        {expanded === row.id ? "Hide sources" : "Show sources"}
                      </button>
                    </td>
                  )}
                </tr>
                {mode === "emails" && expanded === row.id && (
                  <tr>
                    <td colSpan={columns.length + 1}>
                      <PerformanceTable
                        rows={sources.filter(
                          (source) => source.templateId === row.id,
                        )}
                        mode="sources"
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && filtered.length > pageSize && (
        <div className={styles.toolbar}>
          <button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => setPage(pageIndex - 1)}
          >
            Previous
          </button>
          <span>
            Page {pageIndex + 1} of {Math.ceil(filtered.length / pageSize)}
          </span>
          <button
            type="button"
            disabled={(pageIndex + 1) * pageSize >= filtered.length}
            onClick={() => setPage(pageIndex + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
