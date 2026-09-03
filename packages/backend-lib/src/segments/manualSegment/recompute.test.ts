import { WorkflowClient } from "@temporalio/client";
import { FeatureNamesEnum } from "isomorphic-lib/src/types";

import {
  enqueueRecompute,
  signalComputePropertiesEarly,
  startComputePropertiesWorkflow,
} from "../../computedProperties/computePropertiesWorkflow/lifecycle";
import { getFeature } from "../../features";
import { enqueueManualSegmentRecompute } from "./recompute";

jest.mock(
  "../../computedProperties/computePropertiesWorkflow/lifecycle",
  () => ({
    enqueueRecompute: jest.fn(),
    signalComputePropertiesEarly: jest.fn(),
    startComputePropertiesWorkflow: jest.fn(),
  }),
);
jest.mock("../../features", () => ({
  getFeature: jest.fn(),
}));

const mockEnqueueRecompute = jest.mocked(enqueueRecompute);
const mockGetFeature = jest.mocked(getFeature);
const mockSignalComputePropertiesEarly = jest.mocked(
  signalComputePropertiesEarly,
);
const mockStartComputePropertiesWorkflow = jest.mocked(
  startComputePropertiesWorkflow,
);

describe("enqueueManualSegmentRecompute", () => {
  // The dispatcher only passes the client through to mocked lifecycle helpers.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const client = {} as WorkflowClient;
  const workspaceId = "workspace-1";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts the per-workspace workflow when global compute properties is off", async () => {
    mockGetFeature.mockResolvedValue(false);

    await expect(
      enqueueManualSegmentRecompute({ workspaceId, client }),
    ).resolves.toBeUndefined();

    expect(mockGetFeature).toHaveBeenCalledWith({
      workspaceId,
      name: FeatureNamesEnum.ComputePropertiesGlobal,
    });
    expect(mockStartComputePropertiesWorkflow).toHaveBeenCalledWith({
      workspaceId,
      client,
    });
    expect(mockSignalComputePropertiesEarly).toHaveBeenCalledWith({
      workspaceId,
      client,
    });
    expect(mockEnqueueRecompute).not.toHaveBeenCalled();
  });

  it("signals the global queue when global compute properties is on", async () => {
    mockGetFeature.mockResolvedValue(true);

    await expect(
      enqueueManualSegmentRecompute({ workspaceId, client }),
    ).resolves.toBeUndefined();

    expect(mockEnqueueRecompute).toHaveBeenCalledWith({
      items: [{ id: workspaceId }],
      client,
    });
    expect(mockStartComputePropertiesWorkflow).not.toHaveBeenCalled();
    expect(mockSignalComputePropertiesEarly).not.toHaveBeenCalled();
  });
});
