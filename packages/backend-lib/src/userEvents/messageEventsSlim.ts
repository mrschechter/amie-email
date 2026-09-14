// Version 1: shared by fresh bootstrap and the one-shot existing-box migration.
// Keep projection and filter identical for live inserts and historical backfills.
export const MESSAGE_EVENTS_SLIM_FILTER = `event_type = 'track' AND
  (event IN ('DFInternalMessageSent', 'DFSubscriptionChange')
    OR startsWith(event, 'DFEmail') OR startsWith(event, 'DFSms'))`;

export const MESSAGE_EVENTS_SLIM_COLUMNS = `workspace_id, user_or_anonymous_id,
  user_id, processing_time, event_time, event, message_id, resolved_id,
  journey_id, node_id, template_id, broadcast_id, run_id, channel, address,
  hidden, action, bounce_type`;

export const MESSAGE_EVENTS_SLIM_SELECT = `SELECT
  workspace_id, user_or_anonymous_id, user_id, processing_time, event_time, event, message_id,
  if(JSONExtractString(properties, 'messageId') != '', JSONExtractString(properties, 'messageId'), message_id) AS resolved_id,
  JSONExtractString(properties, 'journeyId') AS journey_id,
  JSONExtractString(properties, 'nodeId') AS node_id,
  JSONExtractString(properties, 'templateId') AS template_id,
  JSONExtractString(properties, 'broadcastId') AS broadcast_id,
  JSONExtractString(properties, 'runId') AS run_id,
  JSONExtractString(properties, 'variant', 'type') AS channel,
  coalesce(nullIf(JSONExtractString(properties, 'email'), ''), nullIf(JSONExtractString(properties, 'variant', 'to'), ''), '') AS address,
  hidden,
  JSONExtractString(properties, 'action') AS action,
  coalesce(nullIf(JSONExtractString(properties, 'bounceType'), ''), JSONExtractString(properties, 'bounce', 'bounceType')) AS bounce_type
FROM dittofeed.user_events_v2`;

export const CREATE_MESSAGE_EVENTS_SLIM_TABLE_QUERY = `
  CREATE TABLE IF NOT EXISTS dittofeed.message_events_slim (
    workspace_id String,
    user_or_anonymous_id String,
    user_id String,
    processing_time DateTime64(3),
    event_time DateTime64(3),
    event LowCardinality(String),
    message_id String,
    resolved_id String,
    journey_id String,
    node_id String,
    template_id String,
    broadcast_id String,
    run_id String,
    channel LowCardinality(String),
    address String,
    hidden Bool,
    action String,
    bounce_type String
  )
  ENGINE = MergeTree()
  ORDER BY (workspace_id, event_time, resolved_id, event, message_id);
`;

export const CREATE_MESSAGE_EVENTS_SLIM_MV_QUERY = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS dittofeed.message_events_slim_mv
  TO dittofeed.message_events_slim
  AS ${MESSAGE_EVENTS_SLIM_SELECT}
  WHERE ${MESSAGE_EVENTS_SLIM_FILTER};
`;
