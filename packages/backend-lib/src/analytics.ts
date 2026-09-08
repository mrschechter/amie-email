import { and, count, eq } from "drizzle-orm";
import {
  AnalyticsRequest,
  AnalyticsResponse,
  AnalyticsRow,
  DAY_MS,
  previousPeriod,
  validateAnalyticsRange,
} from "isomorphic-lib/src/analytics";
import { findDirectChildren, getNodeId } from "isomorphic-lib/src/journeys";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { JourneyDefinition, JourneyNodeType } from "isomorphic-lib/src/types";
import NodeCache from "node-cache";

import {
  aggregateByJourney,
  compareDeltas,
  countKeys,
  emptyRow,
  metrics,
  revenueTotals,
  rollup,
  sumMetrics,
} from "./analyticsHelpers";
import { ClickHouseQueryBuilder, query as chQuery } from "./clickhouse";
import config from "./config";
import { db } from "./db";
import * as schema from "./db/schema";
import { getJourneysStats } from "./journeys";
import {
  getRevenueFacts,
  getRevenueOrders,
  RevenueFact,
} from "./revenueAttribution";

export type AnalyticsView =
  | "overview"
  | "flows"
  | "broadcasts"
  | "emails"
  | "deliverability"
  | "revenue";
type QueryGroup = "message" | "day" | "domain";
const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 60,
  maxKeys: 500,
  useClones: false,
});
const pending = new Map<string, Promise<AnalyticsResponse>>();
const eventConditions = {
  sends: "event IN ('DFInternalMessageSent', 'DFEmailSent', 'DFSmsSent')",
  delivered: "event IN ('DFEmailDelivered', 'DFSmsDelivered')",
  opened: "event = 'DFEmailOpened'",
  clicked: "event IN ('DFEmailClicked', 'DFSmsClicked')",
  bounced: "event = 'DFEmailBounced'",
  complaint: "event IN ('DFEmailMarkedSpam', 'DFEmailComplaint')",
  unsubscribed:
    "(event = 'DFEmailUnsubscribed' OR (event = 'DFSubscriptionChange' AND JSONExtractString(properties, 'action') = 'Unsubscribe'))",
  smsFailed: "event = 'DFSmsFailed'",
};

/** Only fixed SQL identifiers are interpolated; all caller values are bound. */
export function buildAnalyticsQuery(
  request: AnalyticsRequest,
  groupBy: QueryGroup = "message",
) {
  validateAnalyticsRange(request.startDate, request.endDate);
  const qb = new ClickHouseQueryBuilder();
  const workspace = qb.addQueryValue(request.workspaceId, "String");
  const start = qb.addQueryValue(request.startDate, "String");
  const end = qb.addQueryValue(request.endDate, "String");
  const query = `WITH events AS (
    SELECT *, if(JSONExtractString(properties, 'messageId') != '', JSONExtractString(properties, 'messageId'), message_id) AS resolved_id
    FROM dittofeed.user_events_v2
    WHERE workspace_id = ${workspace} AND event_type = 'track' AND hidden = false
      AND event_time >= parseDateTime64BestEffort(${start}, 3, 'UTC')
      AND event_time < parseDateTime64BestEffort(${end}, 3, 'UTC')
      AND (event IN ('DFInternalMessageSent', 'DFSubscriptionChange') OR startsWith(event, 'DFEmail') OR startsWith(event, 'DFSms'))
      AND JSONExtractString(properties, 'variant', 'type') NOT IN ('MobilePush', 'Webhook')
  ), dimensions AS (
    SELECT resolved_id,
      ${["journeyId", "nodeId", "templateId", "broadcastId"].map((key) => `argMaxIf(JSONExtractString(properties, '${key}'), event_time, JSONExtractString(properties, '${key}') != '') AS ${key}`).join(",\n      ")},
      argMaxIf(coalesce(nullIf(JSONExtractString(properties, 'email'), ''), nullIf(JSONExtractString(properties, 'variant', 'to'), ''), ''), event_time,
        JSONExtractString(properties, 'email') != '' OR JSONExtractString(properties, 'variant', 'to') != '') AS address,
      argMaxIf(JSONExtractString(properties, 'variant', 'type'), event_time, JSONExtractString(properties, 'variant', 'type') != '') AS channel
    FROM events GROUP BY resolved_id
  ), messages AS (
    SELECT e.resolved_id, ${groupBy === "day" ? "toString(toDate(e.event_time, 'UTC'))" : "''"} AS day,
      d.journeyId AS journeyId, d.nodeId AS nodeId, d.templateId AS templateId, d.broadcastId AS broadcastId,
      if(lowerUTF8(arrayElement(splitByChar('@', d.address), -1)) IN ('gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com'), lowerUTF8(arrayElement(splitByChar('@', d.address), -1)), 'other') AS domain,
      ${Object.entries(eventConditions)
        .map(
          ([key, condition]) => `toUInt64(countIf(${condition}) > 0) AS ${key}`,
        )
        .join(",\n      ")},
      countIf(${eventConditions.opened}) AS rawOpened, countIf(${eventConditions.clicked}) AS rawClicked,
      if(countIf(${eventConditions.sends}) = 0, '', formatDateTime(maxIf(event_time, ${eventConditions.sends}), '%Y-%m-%dT%H:%i:%SZ', 'UTC')) AS lastSend,
      if(countIf(${eventConditions.sends}) = 0, '', formatDateTime(minIf(event_time, ${eventConditions.sends}), '%Y-%m-%dT%H:%i:%SZ', 'UTC')) AS sentAt
    FROM events e INNER JOIN dimensions d ON e.resolved_id = d.resolved_id
    ${groupBy === "domain" ? "WHERE d.channel NOT IN ('Sms', 'MobilePush', 'Webhook') AND NOT startsWith(e.event, 'DFSms')" : ""}
    GROUP BY e.resolved_id, day, journeyId, nodeId, templateId, broadcastId, domain
  )
  SELECT ${groupBy === "domain" ? "domain AS id, '' AS journeyId, '' AS nodeId, '' AS templateId, '' AS broadcastId, '' AS day" : "journeyId, nodeId, templateId, broadcastId, day"},
    ${[...Object.keys(eventConditions), "rawOpened", "rawClicked"].map((key) => `sum(${key}) AS ${key}`).join(", ")}, max(lastSend) AS lastSend, minIf(sentAt, sentAt != '') AS sentAt
  FROM messages GROUP BY ${groupBy === "domain" ? "domain" : "journeyId, nodeId, templateId, broadcastId, day"}`;
  return { query, query_params: qb.getQueries() };
}

export function buildDeliverabilityAddressesQuery(request: AnalyticsRequest) {
  validateAnalyticsRange(request.startDate, request.endDate);
  const qb = new ClickHouseQueryBuilder();
  return {
    query: `SELECT user_id AS userId,
      coalesce(nullIf(JSONExtractString(properties, 'email'), ''), nullIf(JSONExtractString(properties, 'variant', 'to'), ''), user_id) AS address,
      event, toString(max(event_time)) AS date
      FROM dittofeed.user_events_v2
      WHERE workspace_id = ${qb.addQueryValue(request.workspaceId, "String")} AND event_type = 'track' AND hidden = false
        AND event_time >= parseDateTime64BestEffort(${qb.addQueryValue(request.startDate, "String")}, 3, 'UTC')
        AND event_time < parseDateTime64BestEffort(${qb.addQueryValue(request.endDate, "String")}, 3, 'UTC')
        AND (event IN ('DFEmailMarkedSpam', 'DFEmailComplaint') OR
          (event = 'DFEmailBounced' AND lowerUTF8(coalesce(nullIf(JSONExtractString(properties, 'bounceType'), ''), JSONExtractString(properties, 'bounce', 'bounceType'))) IN ('permanent', 'hard', 'hardbounce')))
      GROUP BY userId, address, event ORDER BY date DESC, userId LIMIT 1000`,
    query_params: qb.getQueries(),
  };
}
async function queryRows(
  request: AnalyticsRequest,
  group: QueryGroup,
): Promise<AnalyticsRow[]> {
  const result = await chQuery({
    ...buildAnalyticsQuery(request, group),
    format: "JSONEachRow",
  });
  return (await result.json<Partial<AnalyticsRow>>()).map((row) => {
    const value = emptyRow(row);
    countKeys.forEach((key) => {
      value[key] = Number(value[key]);
    });
    return { ...value, ...metrics(value) };
  });
}
const factKey = (row: {
  journeyId: string;
  broadcastId: string;
  nodeId: string;
  templateId: string;
}) =>
  JSON.stringify([row.journeyId, row.broadcastId, row.nodeId, row.templateId]);
export function mergeRevenue(
  rows: AnalyticsRow[],
  facts: RevenueFact[],
  daily = false,
): AnalyticsRow[] {
  const key = (row: Parameters<typeof factKey>[0] & { day: string }) =>
    `${factKey(row)}:${daily ? row.day : ""}`;
  const joined = new Map(rows.map((row) => [key(row), { ...row }]));
  facts
    .filter((f) => f.attributed)
    .forEach((fact) => {
      const id = key(fact);
      const row = joined.get(id) ?? emptyRow({ ...fact, id });
      row.attributedOrders += fact.orders;
      row.attributedRevenueCents += fact.revenueCents;
      joined.set(id, row);
    });
  return Array.from(joined.values(), (row) => ({
    ...row,
    ...metrics(row),
    id: key(row),
  }));
}
function dailySeries(
  rows: AnalyticsRow[],
  request: AnalyticsRequest,
): AnalyticsRow[] {
  const byDay = new Map(rollup(rows, (r) => r.day).map((row) => [row.id, row]));
  const days: AnalyticsRow[] = [];
  for (
    let day = Date.parse(`${request.startDate.slice(0, 10)}T00:00:00.000Z`);
    day < Date.parse(request.endDate);
    day += DAY_MS
  ) {
    const id = new Date(day).toISOString().slice(0, 10);
    days.push(emptyRow({ ...byDay.get(id), id, day: id, name: id }));
  }
  return days;
}

async function loadAnalytics(
  request: AnalyticsRequest,
  view: AnalyticsView,
  id?: string,
): Promise<AnalyticsResponse> {
  const windowDays = request.windowDays ?? config().amieAttributionWindowDays;
  if (windowDays !== 5 && windowDays !== 7 && windowDays !== 14)
    throw new Error("Configured attribution window must be 5, 7, or 14 days.");
  const resolved: AnalyticsRequest = { ...request, windowDays };
  const [
    rawRows,
    rawDaily,
    rawFacts,
    journeys,
    broadcasts,
    templates,
    audience,
  ] = await Promise.all([
    queryRows(resolved, "message"),
    queryRows(resolved, "day"),
    getRevenueFacts(resolved),
    db().query.journey.findMany({
      where: eq(schema.journey.workspaceId, request.workspaceId),
    }),
    db().query.broadcast.findMany({
      where: eq(schema.broadcast.workspaceId, request.workspaceId),
    }),
    db().query.messageTemplate.findMany({
      where: eq(schema.messageTemplate.workspaceId, request.workspaceId),
      columns: { id: true, name: true },
    }),
    db()
      .select({ segmentId: schema.segmentAssignment.segmentId, size: count() })
      .from(schema.segmentAssignment)
      .where(
        and(
          eq(schema.segmentAssignment.workspaceId, request.workspaceId),
          eq(schema.segmentAssignment.inSegment, true),
        ),
      )
      .groupBy(schema.segmentAssignment.segmentId),
  ]);
  if (
    id &&
    !(view === "flows" ? journeys : broadcasts).some((item) => item.id === id)
  )
    throw Object.assign(new Error("Performance source not found."), {
      statusCode: 404,
    });
  const broadcastByJourney = new Map(
    broadcasts.filter((b) => b.journeyId).map((b) => [b.journeyId, b.id]),
  );
  const normalize = <T extends { journeyId: string; broadcastId: string }>(
    row: T,
  ): T => ({
    ...row,
    broadcastId:
      row.broadcastId || (broadcastByJourney.get(row.journeyId) ?? ""),
  });
  const accepts = (row: { journeyId: string; broadcastId: string }) =>
    !id ||
    (view === "flows"
      ? row.journeyId === id && !row.broadcastId
      : row.broadcastId === id);
  const facts = rawFacts.map(normalize).filter(accepts);
  const rows = mergeRevenue(rawRows.map(normalize).filter(accepts), facts);
  const daily = dailySeries(
    mergeRevenue(rawDaily.map(normalize).filter(accepts), facts, true),
    request,
  );
  const nameByTemplate = new Map(templates.map((t) => [t.id, t.name]));
  const sourceRows = rows.map((row) => {
    const source = row.broadcastId
      ? broadcasts.find((b) => b.id === row.broadcastId)
      : journeys.find((j) => j.id === row.journeyId);
    const sourceType = row.journeyId ? "journey" : "message";
    const href = row.journeyId
      ? `/journeys/${row.journeyId}?tab=performance`
      : undefined;
    return {
      ...row,
      sourceId: row.broadcastId || row.journeyId,
      sourceType: row.broadcastId ? "broadcast" : sourceType,
      name: source?.name ?? "Direct message",
      templateName: nameByTemplate.get(row.templateId) ?? row.templateId,
      href: row.broadcastId
        ? `/broadcasts/${row.broadcastId}?tab=performance`
        : href,
    };
  });
  const stats =
    view === "flows" || view === "overview"
      ? await getJourneysStats({
          workspaceId: request.workspaceId,
          journeyIds: id
            ? [id]
            : journeys.filter((j) => j.status !== "Broadcast").map((j) => j.id),
          startDate: request.startDate,
          endDate: request.endDate,
          includeMessageStats: false,
        })
      : [];
  const flowMetrics = new Map(
    aggregateByJourney(rows).map((row) => [row.id, row]),
  );
  const flows = journeys
    .filter(
      (j) =>
        j.status !== "Broadcast" &&
        !broadcastByJourney.has(j.id) &&
        (!id || j.id === id),
    )
    .map((j) => {
      const processed =
        stats.find((s) => s.journeyId === j.id)?.processedCounts ?? {};
      return emptyRow({
        ...flowMetrics.get(j.id),
        id: j.id,
        name: j.name,
        journeyId: j.id,
        sourceType: "journey",
        sourceId: j.id,
        status: j.status === "NotStarted" ? "Draft" : j.status,
        entered: (processed.EntryNode ?? 0) + (processed.EventEntryNode ?? 0),
        completed: processed.ExitNode ?? 0,
        href: `/journeys/${j.id}?tab=performance`,
      });
    });
  const broadcastMetrics = new Map(
    rollup(rows, (row) => row.broadcastId).map((row) => [row.id, row]),
  );
  const broadcastRows = broadcasts
    .filter((b) => !id || b.id === id)
    .map((b) =>
      emptyRow({
        ...broadcastMetrics.get(b.id),
        id: b.id,
        name: b.name,
        broadcastId: b.id,
        sourceType: "broadcast",
        sourceId: b.id,
        status:
          b.version === "V2"
            ? b.statusV2 ?? "Draft"
            : b.status?.replace("NotStarted", "Draft") ?? "Draft",
        audienceSize: b.segmentId
          ? audience.find((a) => a.segmentId === b.segmentId)?.size ?? 0
          : null,
        sentAt:
          b.triggeredAt?.toISOString() ??
          broadcastMetrics.get(b.id)?.sentAt ??
          "",
        href:
          b.version === "V2"
            ? `/broadcasts/v2?id=${b.id}&tab=performance`
            : `/broadcasts/${b.id}?tab=performance`,
      }),
    );
  const templateMetrics = new Map(
    rollup(sourceRows, (row) => row.templateId).map((row) => [row.id, row]),
  );
  const relevantTemplates = templates.filter(
    (template) =>
      !id ||
      templateMetrics.has(template.id) ||
      broadcasts.some(
        (b) => b.id === id && b.messageTemplateId === template.id,
      ),
  );
  const emails = relevantTemplates.map((template) =>
    emptyRow({
      ...templateMetrics.get(template.id),
      id: template.id,
      templateId: template.id,
      name: template.name,
      sourceType: "template",
      sourceId: template.id,
      href: undefined,
    }),
  );
  const response: AnalyticsResponse = {
    windowDays,
    startDate: request.startDate,
    endDate: request.endDate,
    summary: sumMetrics(rows),
    deltas: {},
    rows: {
      flows,
      broadcasts: broadcastRows,
      overview: emails,
      emails,
      deliverability: emails,
      revenue: emails,
    }[view],
    daily,
    flows,
    broadcasts: broadcastRows,
    sources: rollup(sourceRows, (row) =>
      JSON.stringify([row.sourceType, row.sourceId, row.templateId]),
    ).map((row) => {
      const original = sourceRows.find(
        (source) =>
          JSON.stringify([
            source.sourceType,
            source.sourceId,
            source.templateId,
          ]) === row.id,
      );
      return { ...row, templateId: original?.templateId ?? "" };
    }),
    funnel: [],
    addresses: [],
  };
  if (id) {
    response.rows =
      view === "flows"
        ? rollup(sourceRows, (row) => row.nodeId).map((row) => ({
            ...row,
            nodeId: row.id,
            name: row.id,
            templateName: [
              ...new Set(
                sourceRows
                  .filter((r) => r.nodeId === row.id)
                  .map((r) => r.templateName),
              ),
            ].join(", "),
            href: undefined,
          }))
        : emails;
    if (view === "flows") {
      const journey = journeys.find((j) => j.id === id);
      const definition = schemaValidateWithErr(
        journey?.definition,
        JourneyDefinition,
      );
      if (definition.isOk()) {
        const processed =
          stats.find((s) => s.journeyId === id)?.processedCounts ?? {};
        const orderedIds: string[] = [];
        const queue = [getNodeId(definition.value.entryNode)];
        const visited = new Set<string>();
        while (queue.length) {
          const nodeId = queue.shift();
          if (!nodeId || visited.has(nodeId)) continue;
          visited.add(nodeId);
          orderedIds.push(nodeId);
          queue.push(...findDirectChildren(nodeId, definition.value));
        }
        const nodes = definition.value.nodes
          .filter((n) => n.type === JourneyNodeType.MessageNode)
          .sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
        const historicalRows = response.rows.filter(
          (row) => !nodes.some((node) => node.id === row.nodeId),
        );
        response.rows = nodes.map((node) => {
          const found = response.rows.find((row) => row.nodeId === node.id);
          return emptyRow({
            ...found,
            id: node.id,
            nodeId: node.id,
            journeyId: id,
            name: node.name ?? node.id,
            templateId: node.variant.templateId,
            templateName:
              found?.templateName ??
              nameByTemplate.get(node.variant.templateId) ??
              node.variant.templateId,
          });
        });
        response.rows.push(...historicalRows);
        response.funnel = [
          {
            id: getNodeId(definition.value.entryNode),
            name: "Entered",
            count: processed[getNodeId(definition.value.entryNode)] ?? 0,
          },
          ...nodes.map((n) => ({
            id: n.id,
            name: n.name ?? n.id,
            count: processed[n.id] ?? 0,
          })),
          {
            id: "ExitNode",
            name: "Completed / exit",
            count: processed.ExitNode ?? 0,
          },
        ];
      }
    }
  }
  if (view === "revenue") {
    response.revenue = revenueTotals(facts);
    const orders = await getRevenueOrders(resolved, 101);
    response.orders = orders.slice(0, 100);
    response.ordersHasMore = orders.length > 100;
  }
  if (view === "deliverability") {
    const [domains, addresses] = await Promise.all([
      queryRows(resolved, "domain"),
      chQuery({
        ...buildDeliverabilityAddressesQuery(resolved),
        format: "JSONEachRow",
      }),
    ]);
    response.rows = [
      "gmail.com",
      "yahoo.com",
      "icloud.com",
      "outlook.com",
      "other",
    ].map((domain) =>
      emptyRow({
        ...domains.find((d) => d.id === domain),
        id: domain,
        name: domain,
      }),
    );
    response.addresses =
      await addresses.json<AnalyticsResponse["addresses"][number]>();
  }
  if (request.compare !== false) {
    const before = {
      ...resolved,
      ...previousPeriod(request.startDate, request.endDate),
      compare: false,
    };
    const [previousRows, previousFacts] = await Promise.all([
      queryRows(before, "message"),
      getRevenueFacts(before),
    ]);
    response.previous = sumMetrics(
      mergeRevenue(
        previousRows.map(normalize).filter(accepts),
        previousFacts.map(normalize).filter(accepts),
      ),
    );
    response.deltas = compareDeltas(response.summary, response.previous);
  }
  return response;
}
export async function getAnalytics(
  request: AnalyticsRequest,
  view: AnalyticsView,
  id?: string,
): Promise<AnalyticsResponse> {
  validateAnalyticsRange(request.startDate, request.endDate);
  const key = JSON.stringify([
    request.workspaceId,
    request.startDate,
    request.endDate,
    view,
    id,
    request.compare !== false,
    request.windowDays ?? config().amieAttributionWindowDays,
  ]);
  const cached = cache.get<AnalyticsResponse>(key);
  if (cached) return cached;
  const active = pending.get(key);
  if (active) return active;
  const promise = loadAnalytics(
    {
      ...request,
      startDate: new Date(request.startDate).toISOString(),
      endDate: new Date(request.endDate).toISOString(),
    },
    view,
    id,
  )
    .then((result) => {
      if (cache.keys().length >= 500) cache.del(cache.keys()[0] ?? "");
      cache.set(key, result);
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
