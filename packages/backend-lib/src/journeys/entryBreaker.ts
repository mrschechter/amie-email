import { Counter } from "@opentelemetry/api";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import NodeCache from "node-cache";

import config from "../config";
import { db } from "../db";
import { userJourneyEvent } from "../db/schema";
import logger from "../logger";
import { getMeter } from "../openTelemetry";
import { JourneyNodeType } from "../types";

let JOURNEY_ENTRY_BREAKER_REFUSED_COUNTER: Counter | null = null;

function journeyEntryBreakerRefusedCounter() {
  if (JOURNEY_ENTRY_BREAKER_REFUSED_COUNTER === null) {
    JOURNEY_ENTRY_BREAKER_REFUSED_COUNTER = getMeter().createCounter(
      "journey_entry_breaker_refused",
      {
        description: "Counter for journey entries refused by the entry breaker",
        unit: "1",
      },
    );
  }
  return JOURNEY_ENTRY_BREAKER_REFUSED_COUNTER;
}

interface CountRecentEntriesParams {
  journeyId: string;
  since: Date;
}

async function countRecentEntries({
  journeyId,
  since,
}: CountRecentEntriesParams): Promise<number> {
  // The existing composite index leads with journeyId and covers type and
  // journeyStartedAt. Entry nodes are recorded with type and nodeId both equal
  // to EventEntryNode or SegmentEntryNode; count rows, not distinct users.
  const [result] = await db()
    .select({ count: count() })
    .from(userJourneyEvent)
    .where(
      and(
        eq(userJourneyEvent.journeyId, journeyId),
        inArray(userJourneyEvent.type, [
          JourneyNodeType.EventEntryNode,
          JourneyNodeType.SegmentEntryNode,
        ]),
        gte(userJourneyEvent.journeyStartedAt, since),
      ),
    );
  if (!result) {
    throw new Error("Journey entry count returned no row");
  }
  return result.count;
}

interface CachedEntries {
  count: number;
  admitted: number;
  refreshedAt: number;
}

export function journeyEntryBreakerFactory({
  countRecentEntriesImpl = countRecentEntries,
  nowImpl = Date.now,
  cache = new NodeCache({ stdTTL: 15 }),
}: {
  countRecentEntriesImpl?: (
    params: CountRecentEntriesParams,
  ) => Promise<number>;
  nowImpl?: () => number;
  cache?: NodeCache;
} = {}) {
  const refreshes = new Map<string, Promise<CachedEntries>>();
  const logCache = new NodeCache({ stdTTL: 60 });

  return async function admit({
    workspaceId,
    journeyId,
    journeyName,
    userId,
  }: {
    workspaceId: string;
    journeyId: string;
    journeyName: string;
    userId: string;
  }): Promise<boolean> {
    const {
      journeyEntryBreakerMaxPerWindow: max,
      journeyEntryBreakerWindowSeconds: windowSeconds,
    } = config();
    if (max === 0) {
      return true;
    }

    let entries = cache.get<CachedEntries>(journeyId);
    if (!entries || nowImpl() - entries.refreshedAt >= 15_000) {
      try {
        let refresh = refreshes.get(journeyId);
        if (!refresh) {
          // Share a refresh across concurrent callers. They reserve admissions
          // synchronously below, against the latest cached state.
          refresh = (async () => {
            const recentCount = await countRecentEntriesImpl({
              journeyId,
              since: new Date(nowImpl() - windowSeconds * 1000),
            });
            const freshEntries = {
              count: recentCount,
              admitted: 0,
              refreshedAt: nowImpl(),
            };
            cache.set(journeyId, freshEntries, 15);
            return freshEntries;
          })().finally(() => refreshes.delete(journeyId));
          refreshes.set(journeyId, refresh);
        }
        const refreshed = await refresh;
        // Another caller can reserve an entry after the cache is populated but
        // before this await resumes. NodeCache clones values by default.
        entries = cache.get<CachedEntries>(journeyId) ?? refreshed;
      } catch (err) {
        logger().warn(
          { workspaceId, journeyId, journeyName, userId, err },
          "journey_entry_breaker_count_failed",
        );
        return true;
      }
    }

    const entryCount = entries.count + entries.admitted;
    if (entryCount >= max) {
      const lastLoggedAt = logCache.get<number>(journeyId);
      const now = nowImpl();
      if (lastLoggedAt === undefined || now - lastLoggedAt >= 60_000) {
        logger().error(
          {
            workspaceId,
            journeyId,
            journeyName,
            userId,
            count: entryCount,
            max,
            windowSeconds,
          },
          "journey_entry_breaker_tripped",
        );
        logCache.set(journeyId, now);
      }
      journeyEntryBreakerRefusedCounter().add(1, {
        workspaceId,
        journeyId,
        journeyName,
      });
      return false;
    }

    entries.admitted += 1;
    // Updating the reservation must not extend the original count's TTL.
    cache.set(
      journeyId,
      entries,
      Math.max(0.001, (entries.refreshedAt + 15_000 - nowImpl()) / 1000),
    );
    return true;
  };
}
