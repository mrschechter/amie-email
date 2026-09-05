import { writeToString } from "@fast-csv/format";
import {
  GetRevenueBreakdownRequest,
  GetRevenueBreakdownResponse,
  GetRevenueSummaryRequest,
  GetRevenueSummaryResponse,
  RevenueAttributionFilters,
  RevenueBreakdownGroupBy,
  RevenueBreakdownRow,
} from "isomorphic-lib/src/types";

import { ClickHouseQueryBuilder, query as chQuery } from "./clickhouse";
import config from "./config";
import logger from "./logger";
import { getResources } from "./resources";
import { InternalEventType } from "./types";

const ORDER_PAID_EVENT = "order_paid";
const SMS_CLICKED_EVENT = "DFSmsClicked";

type NumericValue = number | string;

function toNumber(value: NumericValue | undefined): number {
  if (value === undefined) return 0;
  return typeof value === "string" ? Number(value) : value;
}

function revenueQuerySettings() {
  const backendConfig = config();
  return {
    date_time_output_format: "iso",
    function_json_value_return_type_allow_complex: 1,
    join_algorithm: "full_sorting_merge",
    max_memory_usage: backendConfig.clickhouseMaxMemoryUsage,
  } as const;
}

function buildAttributionCtes({
  qb,
  workspaceId,
  startDate,
  endDate,
}: {
  qb: ClickHouseQueryBuilder;
  workspaceId: string;
  startDate: string;
  endDate: string;
}): string {
  const workspaceIdParam = qb.addQueryValue(workspaceId, "String");
  const startDateParam = qb.addQueryValue(startDate, "String");
  const endDateParam = qb.addQueryValue(endDate, "String");
  const windowDaysParam = qb.addQueryValue(
    config().amieAttributionWindowDays,
    "Int32",
  );

  const touchEvents = [InternalEventType.EmailClicked, SMS_CLICKED_EVENT];
  if (config().amieAttributionIncludeOpens) {
    touchEvents.push(InternalEventType.EmailOpened);
  }
  const touchEventsParam = qb.addQueryValue(touchEvents, "Array(String)");

  return `
    raw_orders AS (
      SELECT
        JSON_VALUE(properties, '$.orderId') AS raw_order_id,
        multiIf(
          raw_order_id = '', message_id,
          match(raw_order_id, '^gid://shopify/Order/[0-9]+$'),
            extract(raw_order_id, '([0-9]+)$'),
          raw_order_id
        ) AS order_id,
        user_id,
        coalesce(
          parseDateTime64BestEffortOrNull(JSONExtractString(properties, 'paidAt'), 3, 'UTC'),
          event_time
        ) AS order_time,
        if(
          JSONHas(properties, 'amountCents'),
          toInt64OrZero(JSON_VALUE(properties, '$.amountCents')),
          toInt64(round(toFloat64OrZero(JSON_VALUE(properties, '$.total')) * 100))
        ) AS amount_cents,
        if(
          JSONExtractString(properties, 'kind') != '',
          JSONExtractString(properties, 'kind'),
          multiIf(
            JSON_VALUE(properties, '$.isFirstOrder') = 'true', 'new',
            JSON_VALUE(properties, '$.isFirstOrder') = 'false', 'renewal',
            'unknown'
          )
        ) AS order_kind,
        processing_time
      FROM user_events_v2
      WHERE
        workspace_id = ${workspaceIdParam}
        AND event_type = 'track'
        AND event = '${ORDER_PAID_EVENT}'
        AND user_id != ''
        AND hidden = false
        AND processing_time >= parseDateTime64BestEffort(${startDateParam}, 3, 'UTC')
        AND processing_time <= parseDateTime64BestEffort(${endDateParam}, 3, 'UTC')
        AND event_time >= parseDateTime64BestEffort(${startDateParam}, 3, 'UTC')
        AND event_time <= parseDateTime64BestEffort(${endDateParam}, 3, 'UTC')
    ),
    deduplicated_orders AS (
      SELECT
        order_id,
        argMax(user_id, processing_time) AS user_id,
        argMax(order_time, processing_time) AS order_time,
        argMax(amount_cents, processing_time) AS amount_cents,
        argMax(order_kind, processing_time) AS order_kind
      FROM raw_orders
      GROUP BY order_id
    ),
    orders AS (
      SELECT *
      FROM deduplicated_orders
      WHERE
        order_time >= parseDateTime64BestEffort(${startDateParam}, 3, 'UTC')
        AND order_time <= parseDateTime64BestEffort(${endDateParam}, 3, 'UTC')
    ),
    touches AS (
      SELECT
        user_id,
        event_time AS touch_time,
        template_id,
        broadcast_id,
        journey_id,
        JSONExtractString(properties, 'nodeId') AS journey_node_id,
        if(origin_message_id = '', message_id, origin_message_id) AS attributed_message_id
      FROM internal_events
      WHERE
        workspace_id = ${workspaceIdParam}
        AND event IN ${touchEventsParam}
        AND user_id != ''
        AND hidden = false
        AND processing_time >= subtractDays(
          parseDateTime64BestEffort(${startDateParam}, 3, 'UTC'),
          ${windowDaysParam}
        )
        AND processing_time <= parseDateTime64BestEffort(${endDateParam}, 3, 'UTC')
        AND event_time >= subtractDays(
          parseDateTime64BestEffort(${startDateParam}, 3, 'UTC'),
          ${windowDaysParam}
        )
        AND event_time <= parseDateTime64BestEffort(${endDateParam}, 3, 'UTC')
    ),
    attributed_orders AS (
      SELECT
        o.order_id,
        o.user_id,
        o.order_time,
        o.amount_cents,
        o.order_kind,
        if(
          c.touch_time >= subtractDays(o.order_time, ${windowDaysParam}),
          c.touch_time,
          toDateTime64(0, 3, 'UTC')
        ) AS touch_time,
        if(c.touch_time >= subtractDays(o.order_time, ${windowDaysParam}), c.template_id, '') AS template_id,
        if(c.touch_time >= subtractDays(o.order_time, ${windowDaysParam}), c.broadcast_id, '') AS broadcast_id,
        if(c.touch_time >= subtractDays(o.order_time, ${windowDaysParam}), c.journey_id, '') AS journey_id,
        if(c.touch_time >= subtractDays(o.order_time, ${windowDaysParam}), c.journey_node_id, '') AS journey_node_id,
        if(c.touch_time >= subtractDays(o.order_time, ${windowDaysParam}), c.attributed_message_id, '') AS attributed_message_id
      FROM (SELECT * FROM orders ORDER BY user_id, order_time) AS o
      ASOF LEFT JOIN (
        SELECT * FROM touches ORDER BY user_id, touch_time
      ) AS c
        ON o.user_id = c.user_id AND o.order_time >= c.touch_time
    )`;
}

function buildAttributionFilter({
  qb,
  filters,
  alias,
}: {
  qb: ClickHouseQueryBuilder;
  filters?: RevenueAttributionFilters;
  alias: string;
}): string {
  if (!filters) return "";
  const conditions: string[] = [];
  if (filters.broadcastIds?.length) {
    conditions.push(
      `${alias}.broadcast_id IN ${qb.addQueryValue(filters.broadcastIds, "Array(String)")}`,
    );
  }
  if (filters.journeyIds?.length) {
    conditions.push(
      `${alias}.journey_id IN ${qb.addQueryValue(filters.journeyIds, "Array(String)")}`,
    );
  }
  if (filters.templateIds?.length) {
    conditions.push(
      `${alias}.template_id IN ${qb.addQueryValue(filters.templateIds, "Array(String)")}`,
    );
  }
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function buildInternalEventFilter({
  qb,
  filters,
  alias,
}: {
  qb: ClickHouseQueryBuilder;
  filters?: RevenueAttributionFilters;
  alias: string;
}): string {
  if (!filters) return "";
  const conditions: string[] = [];
  if (filters.broadcastIds?.length) {
    conditions.push(
      `${alias}.broadcast_id IN ${qb.addQueryValue(filters.broadcastIds, "Array(String)")}`,
    );
  }
  if (filters.journeyIds?.length) {
    conditions.push(
      `${alias}.journey_id IN ${qb.addQueryValue(filters.journeyIds, "Array(String)")}`,
    );
  }
  if (filters.templateIds?.length) {
    conditions.push(
      `${alias}.template_id IN ${qb.addQueryValue(filters.templateIds, "Array(String)")}`,
    );
  }
  return conditions.length ? `AND ${conditions.join(" AND ")}` : "";
}

export async function getRevenueSummary({
  workspaceId,
  startDate,
  endDate,
  filters,
}: GetRevenueSummaryRequest): Promise<GetRevenueSummaryResponse> {
  const qb = new ClickHouseQueryBuilder();
  const attributionCtes = buildAttributionCtes({
    qb,
    workspaceId,
    startDate,
    endDate,
  });
  const attributionFilter = buildAttributionFilter({
    qb,
    filters,
    alias: "ao",
  });
  const eventFilter = buildInternalEventFilter({
    qb,
    filters,
    alias: "ie",
  });
  const workspaceIdParam = qb.addQueryValue(workspaceId, "String");
  const startDateParam = qb.addQueryValue(startDate, "String");
  const endDateParam = qb.addQueryValue(endDate, "String");

  const query = `
    WITH
    ${attributionCtes},
    filtered_orders AS (
      SELECT * FROM attributed_orders AS ao
      ${attributionFilter}
    ),
    sent_count AS (
      SELECT uniqExact(message_id) AS sends
      FROM internal_events AS ie
      WHERE
        ie.workspace_id = ${workspaceIdParam}
        AND ie.event = '${InternalEventType.MessageSent}'
        AND ie.hidden = false
        AND ie.processing_time >= parseDateTimeBestEffort(${startDateParam}, 'UTC')
        AND ie.processing_time <= parseDateTimeBestEffort(${endDateParam}, 'UTC')
        ${eventFilter}
    )
    SELECT
      any(sent_count.sends) AS sends,
      count() AS total_orders,
      sum(amount_cents) AS total_revenue_cents,
      countIf(attributed_message_id != '') AS attributed_orders,
      sumIf(amount_cents, attributed_message_id != '') AS attributed_revenue_cents,
      countIf(attributed_message_id != '' AND order_kind = 'new') AS attributed_new_orders,
      sumIf(amount_cents, attributed_message_id != '' AND order_kind = 'new') AS attributed_new_revenue_cents,
      countIf(attributed_message_id != '' AND order_kind = 'renewal') AS attributed_renewal_orders,
      sumIf(amount_cents, attributed_message_id != '' AND order_kind = 'renewal') AS attributed_renewal_revenue_cents,
      countIf(attributed_message_id != '' AND order_kind NOT IN ('new', 'renewal')) AS attributed_unknown_orders,
      sumIf(amount_cents, attributed_message_id != '' AND order_kind NOT IN ('new', 'renewal')) AS attributed_unknown_revenue_cents,
      countIf(attributed_message_id = '') AS unattributed_orders,
      sumIf(amount_cents, attributed_message_id = '') AS unattributed_revenue_cents
    FROM filtered_orders
    CROSS JOIN sent_count
  `;

  logger().debug(
    { workspaceId, startDate, endDate, filters },
    "Executing revenue summary query",
  );
  const result = await chQuery({
    query,
    query_params: qb.getQueries(),
    format: "JSONEachRow",
    clickhouse_settings: revenueQuerySettings(),
  });
  const rows = await result.json<{
    sends: NumericValue;
    total_orders: NumericValue;
    total_revenue_cents: NumericValue;
    attributed_orders: NumericValue;
    attributed_revenue_cents: NumericValue;
    attributed_new_orders: NumericValue;
    attributed_new_revenue_cents: NumericValue;
    attributed_renewal_orders: NumericValue;
    attributed_renewal_revenue_cents: NumericValue;
    attributed_unknown_orders: NumericValue;
    attributed_unknown_revenue_cents: NumericValue;
    unattributed_orders: NumericValue;
    unattributed_revenue_cents: NumericValue;
  }>();
  const row = rows[0];
  const sends = toNumber(row?.sends);
  const attributedOrders = toNumber(row?.attributed_orders);
  const attributedRevenueCents = toNumber(row?.attributed_revenue_cents);

  return {
    summary: {
      currency: "USD",
      attributionTouch: config().amieAttributionIncludeOpens
        ? "click_or_open"
        : "click",
      sends,
      totalOrders: toNumber(row?.total_orders),
      totalRevenueCents: toNumber(row?.total_revenue_cents),
      attributedOrders,
      attributedRevenueCents,
      attributedNewOrders: toNumber(row?.attributed_new_orders),
      attributedNewRevenueCents: toNumber(row?.attributed_new_revenue_cents),
      attributedRenewalOrders: toNumber(row?.attributed_renewal_orders),
      attributedRenewalRevenueCents: toNumber(
        row?.attributed_renewal_revenue_cents,
      ),
      attributedUnknownOrders: toNumber(row?.attributed_unknown_orders),
      attributedUnknownRevenueCents: toNumber(
        row?.attributed_unknown_revenue_cents,
      ),
      unattributedOrders: toNumber(row?.unattributed_orders),
      unattributedRevenueCents: toNumber(row?.unattributed_revenue_cents),
      revenuePerThousandSendsCents:
        sends > 0 ? (attributedRevenueCents * 1000) / sends : 0,
      averageOrderValueCents:
        attributedOrders > 0 ? attributedRevenueCents / attributedOrders : 0,
    },
  };
}

interface DimensionSql {
  activity: string;
  attribution: string;
  requiredActivityDimension: string;
  requiredAttributionDimension: string;
}

function dimensionSql(groupBy: RevenueBreakdownGroupBy): DimensionSql {
  switch (groupBy) {
    case "broadcast":
      return {
        activity:
          "'broadcast' AS source_type, ie.broadcast_id AS source_id, '' AS journey_node_id, '' AS template_id",
        attribution:
          "'broadcast' AS source_type, ao.broadcast_id AS source_id, '' AS journey_node_id, '' AS template_id",
        requiredActivityDimension: "ie.broadcast_id != ''",
        requiredAttributionDimension: "ao.broadcast_id != ''",
      };
    case "journey":
      return {
        activity:
          "'journey' AS source_type, ie.journey_id AS source_id, JSONExtractString(ie.properties, 'nodeId') AS journey_node_id, '' AS template_id",
        attribution:
          "'journey' AS source_type, ao.journey_id AS source_id, ao.journey_node_id AS journey_node_id, '' AS template_id",
        requiredActivityDimension: "ie.journey_id != ''",
        requiredAttributionDimension: "ao.journey_id != ''",
      };
    case "template":
      return {
        activity:
          "'template' AS source_type, '' AS source_id, '' AS journey_node_id, ie.template_id AS template_id",
        attribution:
          "'template' AS source_type, '' AS source_id, '' AS journey_node_id, ao.template_id AS template_id",
        requiredActivityDimension: "ie.template_id != ''",
        requiredAttributionDimension: "ao.template_id != ''",
      };
    case "email":
      return {
        activity: `
          multiIf(ie.broadcast_id != '', 'broadcast', ie.journey_id != '', 'journey', 'message') AS source_type,
          multiIf(ie.broadcast_id != '', ie.broadcast_id, ie.journey_id != '', ie.journey_id, if(ie.origin_message_id = '', ie.message_id, ie.origin_message_id)) AS source_id,
          JSONExtractString(ie.properties, 'nodeId') AS journey_node_id,
          ie.template_id AS template_id`,
        attribution: `
          multiIf(ao.broadcast_id != '', 'broadcast', ao.journey_id != '', 'journey', 'message') AS source_type,
          multiIf(ao.broadcast_id != '', ao.broadcast_id, ao.journey_id != '', ao.journey_id, ao.attributed_message_id) AS source_id,
          ao.journey_node_id AS journey_node_id,
          ao.template_id AS template_id`,
        requiredActivityDimension: "1 = 1",
        requiredAttributionDimension: "1 = 1",
      };
  }
  throw new Error("Unsupported revenue breakdown grouping");
}

export async function getRevenueBreakdown({
  workspaceId,
  startDate,
  endDate,
  groupBy,
  filters,
}: GetRevenueBreakdownRequest): Promise<GetRevenueBreakdownResponse> {
  const qb = new ClickHouseQueryBuilder();
  const attributionCtes = buildAttributionCtes({
    qb,
    workspaceId,
    startDate,
    endDate,
  });
  const attributionFilter = buildAttributionFilter({
    qb,
    filters,
    alias: "ao",
  });
  const eventFilter = buildInternalEventFilter({
    qb,
    filters,
    alias: "ie",
  });
  const workspaceIdParam = qb.addQueryValue(workspaceId, "String");
  const startDateParam = qb.addQueryValue(startDate, "String");
  const endDateParam = qb.addQueryValue(endDate, "String");
  const dimensions = dimensionSql(groupBy);

  const query = `
    WITH
    ${attributionCtes},
    activity AS (
      SELECT
        ${dimensions.activity},
        uniqExactIf(ie.message_id, ie.event = '${InternalEventType.MessageSent}') AS sends,
        uniqExactIf(
          if(ie.origin_message_id = '', ie.message_id, ie.origin_message_id),
          ie.event IN ('${InternalEventType.EmailClicked}', '${SMS_CLICKED_EVENT}')
        ) AS clicks,
        0 AS attributed_orders,
        0 AS attributed_new_orders,
        0 AS attributed_renewal_orders,
        0 AS attributed_unknown_orders,
        toInt64(0) AS attributed_revenue_cents
      FROM internal_events AS ie
      WHERE
        ie.workspace_id = ${workspaceIdParam}
        AND ie.event IN (
          '${InternalEventType.MessageSent}',
          '${InternalEventType.EmailClicked}',
          '${SMS_CLICKED_EVENT}'
        )
        AND ie.hidden = false
        AND ie.processing_time >= parseDateTimeBestEffort(${startDateParam}, 'UTC')
        AND ie.processing_time <= parseDateTimeBestEffort(${endDateParam}, 'UTC')
        AND ${dimensions.requiredActivityDimension}
        ${eventFilter}
      GROUP BY source_type, source_id, journey_node_id, template_id
    ),
    revenue AS (
      SELECT
        ${dimensions.attribution},
        0 AS sends,
        0 AS clicks,
        count() AS attributed_orders,
        countIf(ao.order_kind = 'new') AS attributed_new_orders,
        countIf(ao.order_kind = 'renewal') AS attributed_renewal_orders,
        countIf(ao.order_kind NOT IN ('new', 'renewal')) AS attributed_unknown_orders,
        sum(ao.amount_cents) AS attributed_revenue_cents
      FROM attributed_orders AS ao
      ${attributionFilter}
      ${attributionFilter ? "AND" : "WHERE"} ao.attributed_message_id != ''
        AND ${dimensions.requiredAttributionDimension}
      GROUP BY source_type, source_id, journey_node_id, template_id
    )
    SELECT
      source_type,
      source_id,
      journey_node_id,
      template_id,
      sum(sends) AS sends,
      sum(clicks) AS clicks,
      sum(attributed_orders) AS attributed_orders,
      sum(attributed_new_orders) AS attributed_new_orders,
      sum(attributed_renewal_orders) AS attributed_renewal_orders,
      sum(attributed_unknown_orders) AS attributed_unknown_orders,
      sum(attributed_revenue_cents) AS attributed_revenue_cents
    FROM (
      SELECT * FROM activity
      UNION ALL
      SELECT * FROM revenue
    )
    GROUP BY source_type, source_id, journey_node_id, template_id
    ORDER BY attributed_revenue_cents DESC, attributed_orders DESC, sends DESC
  `;

  logger().debug(
    { workspaceId, startDate, endDate, groupBy, filters },
    "Executing revenue breakdown query",
  );
  const result = await chQuery({
    query,
    query_params: qb.getQueries(),
    format: "JSONEachRow",
    clickhouse_settings: revenueQuerySettings(),
  });
  const rows = await result.json<{
    source_type: string;
    source_id: string;
    journey_node_id: string;
    template_id: string;
    sends: NumericValue;
    clicks: NumericValue;
    attributed_orders: NumericValue;
    attributed_new_orders: NumericValue;
    attributed_renewal_orders: NumericValue;
    attributed_unknown_orders: NumericValue;
    attributed_revenue_cents: NumericValue;
  }>();

  return {
    currency: "USD",
    rows: rows.map((row): RevenueBreakdownRow => {
      const sends = toNumber(row.sends);
      const attributedOrders = toNumber(row.attributed_orders);
      const attributedRevenueCents = toNumber(row.attributed_revenue_cents);
      return {
        sourceType: row.source_type,
        sourceId: row.source_id,
        journeyNodeId: row.journey_node_id,
        templateId: row.template_id,
        sends,
        clicks: toNumber(row.clicks),
        attributedOrders,
        attributedNewOrders: toNumber(row.attributed_new_orders),
        attributedRenewalOrders: toNumber(row.attributed_renewal_orders),
        attributedUnknownOrders: toNumber(row.attributed_unknown_orders),
        attributedRevenueCents,
        revenuePerThousandSendsCents:
          sends > 0 ? (attributedRevenueCents * 1000) / sends : 0,
        averageOrderValueCents:
          attributedOrders > 0 ? attributedRevenueCents / attributedOrders : 0,
      };
    }),
  };
}

export async function buildRevenueAttributionFile(
  request: Omit<GetRevenueBreakdownRequest, "groupBy">,
): Promise<{ fileName: string; fileContent: string }> {
  const [breakdown, resources] = await Promise.all([
    getRevenueBreakdown({ ...request, groupBy: "email" }),
    getResources({
      workspaceId: request.workspaceId,
      journeys: true,
      broadcasts: true,
      messageTemplates: true,
    }),
  ]);
  const journeyNames = new Map(
    resources.journeys?.map((journey) => [journey.id, journey.name]) ?? [],
  );
  const broadcastNames = new Map(
    resources.broadcasts?.map((broadcast) => [broadcast.id, broadcast.name]) ??
      [],
  );
  const templateNames = new Map(
    resources.messageTemplates?.map((template) => [
      template.id,
      template.name,
    ]) ?? [],
  );
  const resolveSourceName = (row: RevenueBreakdownRow): string => {
    if (row.sourceType === "broadcast") {
      return broadcastNames.get(row.sourceId) ?? row.sourceId;
    }
    if (row.sourceType === "journey") {
      return journeyNames.get(row.sourceId) ?? row.sourceId;
    }
    return row.sourceId;
  };
  const csvRows = breakdown.rows.map((row) => ({
    "Broadcast / journey": resolveSourceName(row),
    "Source type": row.sourceType,
    "Journey node ID": row.journeyNodeId,
    Template: templateNames.get(row.templateId) ?? row.templateId,
    Sends: row.sends,
    Clicks: row.clicks,
    "Attributed orders": row.attributedOrders,
    "New orders": row.attributedNewOrders,
    "Renewal orders": row.attributedRenewalOrders,
    "Unknown orders": row.attributedUnknownOrders,
    "Attributed revenue (USD)": (row.attributedRevenueCents / 100).toFixed(2),
    "Revenue per 1k sends (USD)": (
      row.revenuePerThousandSendsCents / 100
    ).toFixed(2),
    "Average order value (USD)": (row.averageOrderValueCents / 100).toFixed(2),
  }));
  const fileContent = await writeToString(csvRows, { headers: true });
  const date = new Date().toISOString().slice(0, 10);
  return {
    fileName: `revenue-attribution-${date}.csv`,
    fileContent,
  };
}
