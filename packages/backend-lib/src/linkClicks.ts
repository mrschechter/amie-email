import {
  AnalyticsRequest,
  validateAnalyticsRange,
} from "isomorphic-lib/src/analytics";
import { classifyLink, LinkClickGroup } from "isomorphic-lib/src/linkClicks";

import { ClickHouseQueryBuilder, query } from "./clickhouse";

export interface LinkClickSource {
  broadcastId?: string;
  journeyId?: string;
}

/** Bind all values, including the V1 broadcast-to-journey mapping. */
export function buildLinkClicksQuery(
  request: AnalyticsRequest,
  broadcastJourneys: { id: string; journeyId: string | null }[],
  source: LinkClickSource = {},
) {
  validateAnalyticsRange(request.startDate, request.endDate);
  const qb = new ClickHouseQueryBuilder();
  const workspace = qb.addQueryValue(request.workspaceId, "String");
  const start = qb.addQueryValue(request.startDate, "String");
  const end = qb.addQueryValue(request.endDate, "String");
  const mapped = broadcastJourneys.filter((b) => b.journeyId);
  const journeyIds = qb.addQueryValue(
    mapped.map((b) => b.journeyId ?? ""),
    "Array(String)",
  );
  const broadcastIds = qb.addQueryValue(
    mapped.map((b) => b.id),
    "Array(String)",
  );
  let scope = "(broadcastId != '' OR journeyId != '')";
  if (source.broadcastId) {
    scope = `broadcastId = ${qb.addQueryValue(source.broadcastId, "String")}`;
  } else if (source.journeyId) {
    scope = `broadcastId = '' AND journeyId = ${qb.addQueryValue(source.journeyId, "String")}`;
  }
  return {
    query: `WITH raw AS (
      SELECT user_id, message_id, event_time,
        JSONExtractString(properties, 'link') AS link,
        JSONExtractString(properties, 'journeyId') AS rawJourneyId,
        JSONExtractString(properties, 'broadcastId') AS rawBroadcastId,
        JSONExtractString(properties, 'templateId') AS rawTemplateId
      FROM dittofeed.user_events_v2
      PREWHERE workspace_id = ${workspace}
        AND event_time >= parseDateTime64BestEffort(${start}, 3, 'UTC')
        AND event_time < parseDateTime64BestEffort(${end}, 3, 'UTC')
      WHERE event_type = 'track' AND event = 'DFEmailClicked' AND hidden = false
      LIMIT 1 BY message_id, event_time, user_id, link
    ), normalized AS (
      SELECT user_id, link,
        if(rawBroadcastId != '', rawBroadcastId,
          arrayElement(${broadcastIds}, indexOf(${journeyIds}, rawJourneyId))) AS broadcastId,
        if(broadcastId = '', rawJourneyId, '') AS journeyId,
        if(broadcastId = '', rawTemplateId, '') AS templateId
      FROM raw
    ), clicks AS (
      SELECT * FROM normalized WHERE ${scope}
    ), totals AS (
      SELECT broadcastId, journeyId, templateId,
        uniqExactIf(user_id, user_id != '') AS allUniqueClickers,
        countIf(link = '') AS clicksWithoutLink
      FROM clicks GROUP BY broadcastId, journeyId, templateId
    )
    SELECT c.broadcastId AS broadcastId, c.journeyId AS journeyId, c.templateId AS templateId,
      c.link AS link, uniqExactIf(c.user_id, c.user_id != '') AS uniqueClickers,
      count() AS totalClicks, t.allUniqueClickers AS allUniqueClickers,
      t.clicksWithoutLink AS clicksWithoutLink
    FROM clicks c INNER JOIN totals t
      ON c.broadcastId = t.broadcastId AND c.journeyId = t.journeyId AND c.templateId = t.templateId
    GROUP BY c.broadcastId, c.journeyId, c.templateId, c.link, t.allUniqueClickers, t.clicksWithoutLink
    ORDER BY uniqueClickers DESC, totalClicks DESC, link ASC`,
    query_params: qb.getQueries(),
  };
}

interface LinkClickResult {
  broadcastId: string;
  journeyId: string;
  templateId: string;
  link: string;
  uniqueClickers: string | number;
  totalClicks: string | number;
  allUniqueClickers: string | number;
  clicksWithoutLink: string | number;
}

export async function getLinkClicks(
  request: AnalyticsRequest,
  broadcasts: {
    id: string;
    name: string;
    journeyId: string | null;
    createdAt: Date;
    triggeredAt: Date | null;
  }[],
  journeys: { id: string; name: string; createdAt: Date }[],
  templates: { id: string; name: string }[],
  dataStartsAt: string,
  source: LinkClickSource = {},
): Promise<LinkClickGroup[]> {
  const result = await query({
    ...buildLinkClicksQuery(request, broadcasts, source),
    format: "JSONEachRow",
  });
  const groups = new Map<string, LinkClickGroup>();
  const key = (row: {
    broadcastId: string;
    journeyId: string;
    templateId: string;
  }) => JSON.stringify([row.broadcastId, row.journeyId, row.templateId]);
  const createGroup = (
    broadcastId: string,
    journeyId = "",
    templateId = "",
  ): LinkClickGroup => {
    const broadcast = broadcasts.find((b) => b.id === broadcastId);
    const journey = journeys.find((j) => j.id === journeyId);
    const template = templates.find((t) => t.id === templateId);
    const date =
      broadcast?.triggeredAt ?? broadcast?.createdAt ?? journey?.createdAt;
    return {
      broadcastId,
      journeyId,
      templateId,
      name:
        broadcast?.name ??
        `${journey?.name ?? journeyId} · ${template?.name ?? (templateId || "Unknown template")}`,
      uniqueClickers: 0,
      clicksWithoutLink: 0,
      incomplete: !!date && date.getTime() < Date.parse(dataStartsAt),
      rows: [],
    };
  };
  // Include broadcasts without any link data so historical reports explain the gap.
  for (const b of broadcasts) {
    if (
      !source.journeyId &&
      (!source.broadcastId || b.id === source.broadcastId)
    ) {
      const group = createGroup(b.id);
      groups.set(key(group), group);
    }
  }
  for (const row of await result.json<LinkClickResult>()) {
    const groupKey = key(row);
    const group =
      groups.get(groupKey) ??
      createGroup(row.broadcastId, row.journeyId, row.templateId);
    group.uniqueClickers = Number(row.allUniqueClickers);
    group.clicksWithoutLink = Number(row.clicksWithoutLink);
    group.incomplete ||= group.clicksWithoutLink > 0;
    if (row.link) {
      group.rows.push({
        link: row.link,
        linkKind: classifyLink(row.link),
        uniqueClickers: Number(row.uniqueClickers),
        totalClicks: Number(row.totalClicks),
        clickerRate: group.uniqueClickers
          ? Number(row.uniqueClickers) / group.uniqueClickers
          : 0,
      });
    }
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}
