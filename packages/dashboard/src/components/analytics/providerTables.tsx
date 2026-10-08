import { AnalyticsResponse } from "isomorphic-lib/src/analytics";

import PerformanceTable from "./performanceTable";

export default function ProviderTables({ data }: { data: AnalyticsResponse }) {
  return (
    <>
      <h2>By provider</h2>
      <PerformanceTable rows={data.providers} mode="provider" />
      <h2>Top domains</h2>
      <p>
        Top 15 recipient domains by sends. Remaining and missing domains appear
        as “other”. Unknown bounce types are included in total bounces.
      </p>
      <PerformanceTable rows={data.domains} mode="domain" />
    </>
  );
}
