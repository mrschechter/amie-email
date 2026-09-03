import { WorkflowClient } from "@temporalio/client";
import { FeatureNamesEnum } from "isomorphic-lib/src/types";

import {
  enqueueRecompute,
  signalComputePropertiesEarly,
  startComputePropertiesWorkflow,
} from "../../computedProperties/computePropertiesWorkflow/lifecycle";
import { getFeature } from "../../features";

export async function enqueueManualSegmentRecompute({
  workspaceId,
  client,
}: {
  workspaceId: string;
  client: WorkflowClient;
}): Promise<void> {
  const usesGlobalComputeProperties = await getFeature({
    workspaceId,
    name: FeatureNamesEnum.ComputePropertiesGlobal,
  });

  if (usesGlobalComputeProperties) {
    await enqueueRecompute({
      items: [{ id: workspaceId }],
      client,
    });
    return;
  }

  await startComputePropertiesWorkflow({ workspaceId, client });
  await signalComputePropertiesEarly({ workspaceId, client });
}
