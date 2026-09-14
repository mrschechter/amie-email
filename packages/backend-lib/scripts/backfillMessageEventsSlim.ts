import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { createClickhouseClient } from "../src/clickhouse";
import logger from "../src/logger";
import {
  buildMessageEventsSlimBackfillQuery,
  messageEventsSlimBackfillChunks,
} from "../src/messageEventsSlimBackfill";
import {
  CREATE_MESSAGE_EVENTS_SLIM_MV_QUERY,
  CREATE_MESSAGE_EVENTS_SLIM_TABLE_QUERY,
} from "../src/userEvents/messageEventsSlim";

async function backfillMessageEventsSlim() {
  const args = await yargs(hideBin(process.argv))
    .options({
      from: {
        type: "string",
        demandOption: true,
        describe: "Inclusive processing_time (ISO UTC)",
      },
      to: {
        type: "string",
        describe:
          "Exclusive processing_time (ISO UTC); defaults to now after MV creation",
      },
      "workspace-id": { type: "string" },
      "interval-minutes": { type: "number", default: 60 },
      "dry-run": { type: "boolean", default: false },
    })
    .strict()
    .parse();
  const previewEnd = args.to ?? new Date().toISOString();
  const previewChunks = messageEventsSlimBackfillChunks({
    startDate: args.from,
    endDate: previewEnd,
    intervalMinutes: args["interval-minutes"],
  });
  if (Date.parse(previewEnd) > Date.now()) {
    throw new Error(
      "--to must be a historical cutoff, before this run starts.",
    );
  }
  const ddl = [
    CREATE_MESSAGE_EVENTS_SLIM_TABLE_QUERY,
    CREATE_MESSAGE_EVENTS_SLIM_MV_QUERY,
  ];
  if (args["dry-run"]) {
    logger().info(
      {
        ddl,
        chunks: previewChunks,
        sample: buildMessageEventsSlimBackfillQuery({
          startDate: args.from,
          endDate: previewEnd,
          workspaceId: args["workspace-id"],
        }),
      },
      "Dry run: no database changes",
    );
    return;
  }
  const client = createClickhouseClient();
  try {
    // Existing installations use the same IF NOT EXISTS DDL as bootstrap.
    for (const query of ddl) {
      // eslint-disable-next-line no-await-in-loop
      await client.command({
        query,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
    }
    // Capture only after the view exists so installation cannot leave a gap.
    const endDate = args.to ?? new Date().toISOString();
    logger().info(
      { from: args.from, to: endDate },
      "Message events backfill range",
    );
    const chunks = messageEventsSlimBackfillChunks({
      startDate: args.from,
      endDate,
      intervalMinutes: args["interval-minutes"],
    });
    for (const chunk of chunks) {
      // Single writer; await every insert before testing presence in the next chunk.
      // eslint-disable-next-line no-await-in-loop
      const result = await client.command({
        ...buildMessageEventsSlimBackfillQuery({
          ...chunk,
          workspaceId: args["workspace-id"],
        }),
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      logger().info(
        { ...chunk, writtenRows: result.summary?.written_rows },
        "Backfilled message events",
      );
    }
  } finally {
    await client.close();
  }
}

backfillMessageEventsSlim().catch((err: unknown) => {
  logger().error(
    { err },
    "Message events slim migration/backfill failed; rerun the same range to resume",
  );
  process.exitCode = 1;
});
