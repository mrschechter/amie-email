import { AnalyticsMetrics } from "isomorphic-lib/src/analytics";
import { useRouter } from "next/router";

import { chartMetric } from "./chartMetrics";

export default function useMetricSelection() {
  const router = useRouter();
  const selectedMetric = chartMetric(router.query.metric)?.key;
  const onSelectMetric = (metric?: keyof AnalyticsMetrics) => {
    const query = { ...router.query };
    if (metric) query.metric = metric;
    else delete query.metric;
    void router.push({ pathname: router.pathname, query }, undefined, {
      shallow: true,
      scroll: false,
    });
  };
  return { selectedMetric, onSelectMetric };
}
