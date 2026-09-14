import { ClickHouseQueryBuilder } from "./clickhouse";
import {
  MESSAGE_EVENTS_SLIM_COLUMNS,
  MESSAGE_EVENTS_SLIM_FILTER,
  MESSAGE_EVENTS_SLIM_SELECT,
} from "./userEvents/messageEventsSlim";

export function buildMessageEventsSlimBackfillQuery({
  startDate,
  endDate,
  workspaceId,
}: {
  startDate: string;
  endDate: string;
  workspaceId?: string;
}) {
  const qb = new ClickHouseQueryBuilder();
  const start = qb.addQueryValue(startDate, "String");
  const end = qb.addQueryValue(endDate, "String");
  const workspace = workspaceId
    ? `workspace_id = ${qb.addQueryValue(workspaceId, "String")}`
    : "";
  return {
    query: `INSERT INTO dittofeed.message_events_slim (${MESSAGE_EVENTS_SLIM_COLUMNS})
      ${MESSAGE_EVENTS_SLIM_SELECT}
      PREWHERE ${workspace ? `${workspace} AND` : ""}
        processing_time >= parseDateTime64BestEffort(${start}, 3, 'UTC')
        AND processing_time < parseDateTime64BestEffort(${end}, 3, 'UTC')
      WHERE ${MESSAGE_EVENTS_SLIM_FILTER}
        AND (workspace_id, message_id, event, event_time) NOT IN (
          SELECT workspace_id, message_id, event, event_time
          FROM dittofeed.message_events_slim
          ${workspaceId ? `WHERE ${workspace}` : ""}
        )
      ORDER BY processing_time DESC
      LIMIT 1 BY workspace_id, message_id, event, event_time`,
    query_params: qb.getQueries(),
  };
}

export function messageEventsSlimBackfillChunks({
  startDate,
  endDate,
  intervalMinutes,
}: {
  startDate: string;
  endDate: string;
  intervalMinutes: number;
}): { startDate: string; endDate: string }[] {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  const interval = intervalMinutes * 60_000;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    !Number.isSafeInteger(interval) ||
    interval < 1
  ) {
    throw new Error(
      "Backfill needs a valid increasing range and positive interval.",
    );
  }
  const chunks = [];
  for (let time = start; time < end; time += interval) {
    chunks.push({
      startDate: new Date(time).toISOString(),
      endDate: new Date(Math.min(time + interval, end)).toISOString(),
    });
  }
  return chunks;
}
