import { patched, proxyActivities } from "@temporalio/workflow";

import type * as activities from "./temporal/activities";

const { emitGlobalSignals, processScheduledInboundUnsubscribes } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "5 minutes",
  });

export const GLOBAL_CRON_ID = "global-cron-workflow";

export async function globalCronWorkflow() {
  if (patched("mailto-unsubscribe-processor")) {
    await Promise.all([
      emitGlobalSignals(),
      processScheduledInboundUnsubscribes(),
    ]);
  } else {
    await emitGlobalSignals();
  }
}
