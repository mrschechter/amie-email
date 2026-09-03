import { WorkflowClient } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";

import logger from "../../logger";
import { enqueueRecompute } from "./lifecycle";

jest.mock("../../config", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    computedPropertiesTaskQueue: "computed-properties-test",
    computePropertiesWorkflowTaskTimeout: "10 seconds",
    defaultUserEventsTableVersion: "v2",
  })),
}));
jest.mock("../../logger", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  })),
}));

const mockWarn = jest.fn();
// The logger mock only implements methods exercised by this unit.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
jest.mocked(logger).mockReturnValue({
  error: jest.fn(),
  info: jest.fn(),
  warn: mockWarn,
} as unknown as ReturnType<typeof logger>);

describe("enqueueRecompute", () => {
  const signal = jest.fn();
  const start = jest.fn();
  const getHandle = jest.fn(() => ({ signal }));
  // The client mock only implements methods exercised by enqueueRecompute.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const client = { getHandle, start } as unknown as WorkflowClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falls back to per-workspace workflows when the global queue is missing", async () => {
    signal.mockRejectedValue(
      new WorkflowNotFoundError(
        "workflow not found",
        "compute-properties-queue-workflow",
        undefined,
      ),
    );
    start.mockResolvedValue(undefined);

    await expect(
      enqueueRecompute({
        items: [{ id: "workspace-1" }, { id: "workspace-2" }],
        client,
      }),
    ).resolves.toBeUndefined();

    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        workflowId: "compute-properties-workflow-workspace-1",
      }),
    );
    expect(start).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        workflowId: "compute-properties-workflow-workspace-2",
      }),
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "compute_properties_global_queue_missing",
        workspaceCount: 2,
      }),
      expect.any(String),
    );
  });

  it("rethrows errors other than WorkflowNotFoundError", async () => {
    const error = new Error("signal failed");
    signal.mockRejectedValue(error);

    await expect(
      enqueueRecompute({ items: [{ id: "workspace-1" }], client }),
    ).rejects.toBe(error);

    expect(start).not.toHaveBeenCalled();
  });
});
