import NodeCache from "node-cache";

import config from "../config";
import { db } from "../db";
import { triggerEventEntryJourneysFactory } from "../journeys";
import logger from "../logger";
import { getMeter } from "../openTelemetry";
import { JourneyDefinition, JourneyNodeType } from "../types";
import { journeyEntryBreakerFactory } from "./entryBreaker";

jest.mock("../config", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    journeyEntryBreakerMaxPerWindow: 500,
    journeyEntryBreakerWindowSeconds: 3600,
  })),
}));
jest.mock("../db", () => ({
  db: jest.fn(() => {
    throw new Error("Unit tests must not access Postgres");
  }),
}));
jest.mock("../logger", () => {
  const log = { warn: jest.fn(), error: jest.fn() };
  return { __esModule: true, default: () => log };
});
jest.mock("../openTelemetry", () => {
  const counter = { add: jest.fn() };
  const meter = { createCounter: jest.fn(() => counter) };
  return { getMeter: () => meter };
});
// Isolate the trigger factory from external clients and workflow modules.
jest.mock("../clickhouse", () => ({}));
jest.mock(
  "../computedProperties/computePropertiesWorkflow/lifecycle",
  () => ({}),
);
jest.mock("./userWorkflow", () => ({}));
jest.mock("./userWorkflow/lifecycle", () => ({}));
jest.mock("../restartUserJourneyWorkflow/lifecycle", () => ({}));
jest.mock("../segments", () => ({}));
jest.mock("../temporal/activity", () => ({}));
jest.mock("../temporal/workflows", () => ({}));

const params = {
  workspaceId: "workspace",
  journeyId: "journey",
  journeyName: "Test journey",
  userId: "user",
};

describe("journey entry breaker", () => {
  let cache: NodeCache;
  let now: number;
  let countRecentEntriesImpl: jest.Mock<Promise<number>, [unknown]>;
  let admit: ReturnType<typeof journeyEntryBreakerFactory>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    now = Date.UTC(2026, 8, 21);
    jest.setSystemTime(now);
    jest.mocked(config).mockReturnValue({
      ...config(),
      journeyEntryBreakerMaxPerWindow: 500,
      journeyEntryBreakerWindowSeconds: 3600,
    });
    cache = new NodeCache({ stdTTL: 15, checkperiod: 0 });
    countRecentEntriesImpl = jest
      .fn<Promise<number>, [unknown]>()
      .mockResolvedValue(10);
    admit = journeyEntryBreakerFactory({
      countRecentEntriesImpl,
      nowImpl: () => now,
      cache,
    });
  });

  afterEach(() => {
    expect(db).not.toHaveBeenCalled();
    cache.close();
    jest.useRealTimers();
  });

  it("admits below the limit and queries only once within the TTL", async () => {
    expect(await admit(params)).toBe(true);
    now += 10_000;
    expect(await admit(params)).toBe(true);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(1);
    expect(countRecentEntriesImpl).toHaveBeenCalledWith({
      journeyId: params.journeyId,
      since: new Date(Date.UTC(2026, 8, 21) - 3_600_000),
    });
  });

  it("reserves admitted starts within the TTL", async () => {
    countRecentEntriesImpl.mockResolvedValue(499);
    expect(await admit(params)).toBe(true);
    expect(await admit({ ...params, userId: "second-user" })).toBe(false);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(1);
  });

  it("shares a refresh and reservations across concurrent admissions", async () => {
    countRecentEntriesImpl.mockResolvedValue(499);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        admit({ ...params, userId: `user-${i}` }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(1);
  });

  it("admits without querying when disabled", async () => {
    jest.mocked(config).mockReturnValue({
      ...config(),
      journeyEntryBreakerMaxPerWindow: 0,
    });
    expect(await admit(params)).toBe(true);
    expect(countRecentEntriesImpl).not.toHaveBeenCalled();
  });

  it("preserves reservations made while refresh callers are resuming", async () => {
    countRecentEntriesImpl.mockResolvedValue(499);
    const first = admit(params);
    // Let the query populate the cache before the first admit resumes.
    await Promise.resolve();
    const second = admit({ ...params, userId: "second-user" });
    const results = await Promise.all([first, second]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(1);
  });

  it("warns and admits when the query fails, then permits a fresh query", async () => {
    const err = new Error("Postgres unavailable");
    countRecentEntriesImpl.mockRejectedValueOnce(err);
    expect(await admit(params)).toBe(true);
    expect(logger().warn).toHaveBeenCalledWith(
      { ...params, err },
      "journey_entry_breaker_count_failed",
    );
    expect(await admit(params)).toBe(true);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(2);
  });

  it("admits again with a fresh count after the TTL rolls", async () => {
    countRecentEntriesImpl.mockResolvedValueOnce(500).mockResolvedValue(10);
    expect(await admit(params)).toBe(false);
    now += 15_000;
    expect(await admit(params)).toBe(true);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(2);
    expect(countRecentEntriesImpl).toHaveBeenLastCalledWith({
      journeyId: params.journeyId,
      since: new Date(now - 3_600_000),
    });
  });

  it("does not extend the refresh TTL when reserving admissions", async () => {
    expect(await admit(params)).toBe(true);
    now += 14_000;
    jest.setSystemTime(now);
    expect(await admit(params)).toBe(true);
    now += 1_001;
    jest.setSystemTime(now);
    expect(cache.has(params.journeyId)).toBe(false);
    expect(await admit(params)).toBe(true);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(2);
  });

  it("rate-limits error logs per journey but counts every refusal", async () => {
    countRecentEntriesImpl.mockResolvedValue(500);
    expect(await admit(params)).toBe(false);
    expect(await admit({ ...params, userId: "second-user" })).toBe(false);
    now += 59_999;
    expect(await admit(params)).toBe(false);
    expect(logger().error).toHaveBeenCalledTimes(1);
    expect(logger().error).toHaveBeenCalledWith(
      { ...params, count: 500, max: 500, windowSeconds: 3600 },
      "journey_entry_breaker_tripped",
    );
    now += 1;
    expect(await admit(params)).toBe(false);
    expect(logger().error).toHaveBeenCalledTimes(2);
    const add = jest.spyOn(
      getMeter().createCounter("journey_entry_breaker_refused"),
      "add",
    );
    expect(add).toHaveBeenCalledTimes(4);
    expect(add).toHaveBeenLastCalledWith(1, {
      workspaceId: params.workspaceId,
      journeyId: params.journeyId,
      journeyName: params.journeyName,
    });
  });

  it("keeps counts and refusal logs independent for each journey", async () => {
    countRecentEntriesImpl.mockResolvedValueOnce(500).mockResolvedValueOnce(0);
    expect(await admit(params)).toBe(false);
    expect(await admit({ ...params, journeyId: "other-journey" })).toBe(true);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(2);
    expect(logger().error).toHaveBeenCalledTimes(1);
  });

  it("admits when the configured limit is raised", async () => {
    countRecentEntriesImpl.mockResolvedValue(500);
    expect(await admit(params)).toBe(false);
    jest.mocked(config).mockReturnValue({
      ...config(),
      journeyEntryBreakerMaxPerWindow: 501,
    });
    expect(await admit(params)).toBe(true);
    expect(countRecentEntriesImpl).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "starts a matched event journey only when admitted (%s)",
    async (admitted) => {
      const definition: JourneyDefinition = {
        entryNode: {
          type: JourneyNodeType.EventEntryNode,
          event: "test_event",
          child: JourneyNodeType.ExitNode,
        },
        nodes: [],
        exitNode: { type: JourneyNodeType.ExitNode },
      };
      cache.set(params.workspaceId, [
        {
          journeyId: params.journeyId,
          journeyName: params.journeyName,
          event: "test_event",
          definition,
        },
      ]);
      const startKeyedJourneyImpl = jest.fn().mockResolvedValue(undefined);
      const entryBreakerImpl = jest.fn().mockResolvedValue(admitted);
      const trigger = triggerEventEntryJourneysFactory({
        journeyCache: cache,
        startKeyedJourneyImpl,
        entryBreakerImpl,
      });
      const event = { event: "test_event", messageId: "message" };
      await trigger({
        workspaceId: params.workspaceId,
        userId: params.userId,
        event,
      });
      expect(entryBreakerImpl).toHaveBeenCalledWith(params);
      expect(startKeyedJourneyImpl).toHaveBeenCalledTimes(admitted ? 1 : 0);
      if (admitted) {
        expect(startKeyedJourneyImpl).toHaveBeenCalledWith({
          workspaceId: params.workspaceId,
          userId: params.userId,
          journeyId: params.journeyId,
          event,
          definition,
        });
      }
    },
  );
});
