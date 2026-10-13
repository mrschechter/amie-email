import { AnalyticsResponse } from "isomorphic-lib/src/analytics";
import { displayLink } from "isomorphic-lib/src/linkClicks";

import styles from "./analytics.module.css";

export default function LinksClicked({
  data,
}: {
  data: Pick<AnalyticsResponse, "linkClicks" | "linkDataStartsAt">;
}) {
  if (!data.linkClicks) return null;
  return (
    <section>
      <h2>Links clicked</h2>
      <p className={styles.muted}>
        Unique clickers are people who clicked any link in this broadcast or
        journey template during the selected period, including links without a
        recorded URL. A person can click more than one link, so percentages may
        add up to more than 100%. Service links are labeled separately.
      </p>
      {data.linkClicks.length === 0 && <p>No link clicks in this range.</p>}
      {data.linkClicks.map((group) => (
        <details
          key={JSON.stringify([
            group.broadcastId,
            group.journeyId,
            group.templateId,
          ])}
          style={{ margin: "4px 0", borderTop: "1px solid rgba(0,0,0,0.08)" }}
        >
          <summary
            style={{ cursor: "pointer", padding: "8px 0", fontWeight: 600 }}
          >
            {group.name}
            <span className={styles.muted} style={{ fontWeight: 400 }}>
              {" "}
              · {group.rows.length.toLocaleString()} link
              {group.rows.length === 1 ? "" : "s"}
              {` · ${group.uniqueClickers.toLocaleString()} ${group.uniqueClickers === 1 ? "person" : "people"} clicked`}
            </span>
          </summary>
          {group.incomplete && (
            <p className={styles.muted}>
              Link-level data starts {data.linkDataStartsAt?.slice(0, 10)}.{" "}
              Older clicks cannot be recovered.
              {group.clicksWithoutLink > 0 &&
                ` ${group.clicksWithoutLink.toLocaleString()} clicks in this period have no link URL.`}
            </p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Link URL</th>
                  <th>Unique clickers</th>
                  <th>Total clicks</th>
                  <th>% of unique clickers</th>
                  <th>Link kind</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className={styles.empty}>
                      No link-level clicks in this range.
                    </td>
                  </tr>
                )}
                {group.rows.map((row) => (
                  <tr key={row.link}>
                    <td>
                      <span
                        title={row.link}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {displayLink(row.link)}
                      </span>
                    </td>
                    <td>{row.uniqueClickers.toLocaleString()}</td>
                    <td>{row.totalClicks.toLocaleString()}</td>
                    <td>{(row.clickerRate * 100).toFixed(1)}%</td>
                    <td>{row.linkKind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}
