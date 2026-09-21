import { patched, proxyActivities } from "@temporalio/workflow";

import { globalCronWorkflow } from "./globalCronWorkflow";

jest.mock("@temporalio/workflow", () => ({
  patched: jest.fn(),
  proxyActivities: jest.fn().mockReturnValue({
    emitGlobalSignals: jest.fn().mockResolvedValue(undefined),
    processScheduledInboundUnsubscribes: jest.fn().mockResolvedValue(undefined),
  }),
}));

const activities = proxyActivities<{
  emitGlobalSignals: () => Promise<void>;
  processScheduledInboundUnsubscribes: () => Promise<void>;
}>({ startToCloseTimeout: "5 minutes" });

it("runs inbound processing alongside existing signals on new cron executions", async () => {
  jest.mocked(patched).mockReturnValue(true);
  await globalCronWorkflow();
  expect(patched).toHaveBeenCalledWith("mailto-unsubscribe-processor");
  expect(activities.emitGlobalSignals).toHaveBeenCalledTimes(1);
  expect(activities.processScheduledInboundUnsubscribes).toHaveBeenCalledTimes(
    1,
  );
});

it("preserves the activity sequence for older workflow histories", async () => {
  jest.mocked(patched).mockReturnValue(false);
  await globalCronWorkflow();
  expect(activities.emitGlobalSignals).toHaveBeenCalledTimes(1);
  expect(activities.processScheduledInboundUnsubscribes).not.toHaveBeenCalled();
});
