import { randomUUID } from "crypto";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { submitBatch } from "./apps/batch";
import { getRevenueBreakdown, getRevenueSummary } from "./revenueAttribution";
import { BatchItem, EventType, InternalEventType } from "./types";
import { createWorkspace } from "./workspaces";

describe("revenue attribution", () => {
  let workspaceId: string;
  const rangeStart = "2026-08-01T00:00:00.000Z";
  const rangeEnd = "2026-08-31T23:59:59.999Z";

  beforeEach(async () => {
    workspaceId = unwrap(
      await createWorkspace({ name: `revenue-test-${randomUUID()}` }),
    ).id;
  });

  async function submit(events: BatchItem[]) {
    await Promise.all(
      events.map((event) =>
        submitBatch(
          { workspaceId, data: { batch: [event] } },
          {
            processingTime: new Date(event.timestamp ?? rangeStart).getTime(),
          },
        ),
      ),
    );
  }

  function engagementEvent({
    userId,
    timestamp,
    event,
    broadcastId = randomUUID(),
  }: {
    userId: string;
    timestamp: string;
    event: InternalEventType.EmailClicked | InternalEventType.EmailOpened;
    broadcastId?: string;
  }): BatchItem {
    return {
      type: EventType.Track,
      event,
      userId,
      messageId: randomUUID(),
      timestamp,
      properties: {
        workspaceId,
        messageId: randomUUID(),
        broadcastId,
        templateId: randomUUID(),
      },
    };
  }

  function orderEvent({
    userId,
    timestamp,
    amountCents = 12500,
    kind = "new",
  }: {
    userId: string;
    timestamp: string;
    amountCents?: number;
    kind?: "new" | "renewal";
  }): BatchItem {
    const orderId = randomUUID();
    return {
      type: EventType.Track,
      event: "order_paid",
      userId,
      messageId: randomUUID(),
      timestamp,
      properties: {
        orderId,
        orderName: `#${orderId.slice(0, 6)}`,
        source: "shopify",
        kind,
        amountCents,
        currency: "USD",
        productKey: "test-product",
        plan: "monthly",
        paidAt: timestamp,
        subscriptionId: randomUUID(),
      },
    };
  }

  it("attributes a paid order to a click inside the five-day window", async () => {
    const userId = randomUUID();
    await submit([
      engagementEvent({
        userId,
        timestamp: "2026-08-10T10:00:00.000Z",
        event: InternalEventType.EmailClicked,
      }),
      orderEvent({ userId, timestamp: "2026-08-12T10:00:00.000Z" }),
    ]);

    const result = await getRevenueSummary({
      workspaceId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    expect(result.summary).toMatchObject({
      totalOrders: 1,
      attributedOrders: 1,
      attributedRevenueCents: 12500,
      unattributedOrders: 0,
    });
  });

  it("leaves an order unattributed when its prior click is outside the window", async () => {
    const userId = randomUUID();
    await submit([
      engagementEvent({
        userId,
        timestamp: "2026-08-01T10:00:00.000Z",
        event: InternalEventType.EmailClicked,
      }),
      orderEvent({ userId, timestamp: "2026-08-07T10:00:01.000Z" }),
    ]);

    const result = await getRevenueSummary({
      workspaceId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    expect(result.summary).toMatchObject({
      totalOrders: 1,
      attributedOrders: 0,
      unattributedOrders: 1,
      unattributedRevenueCents: 12500,
    });
  });

  it("uses the latest of two eligible clicks", async () => {
    const userId = randomUUID();
    const earlierBroadcastId = randomUUID();
    const latestBroadcastId = randomUUID();
    await submit([
      engagementEvent({
        userId,
        timestamp: "2026-08-10T10:00:00.000Z",
        event: InternalEventType.EmailClicked,
        broadcastId: earlierBroadcastId,
      }),
      engagementEvent({
        userId,
        timestamp: "2026-08-12T10:00:00.000Z",
        event: InternalEventType.EmailClicked,
        broadcastId: latestBroadcastId,
      }),
      orderEvent({
        userId,
        timestamp: "2026-08-13T10:00:00.000Z",
        kind: "renewal",
      }),
    ]);

    const result = await getRevenueBreakdown({
      workspaceId,
      startDate: rangeStart,
      endDate: rangeEnd,
      groupBy: "broadcast",
    });

    const latest = result.rows.find(
      (row) => row.sourceId === latestBroadcastId,
    );
    const earlier = result.rows.find(
      (row) => row.sourceId === earlierBroadcastId,
    );
    expect(latest).toMatchObject({
      attributedOrders: 1,
      attributedNewOrders: 0,
      attributedRenewalOrders: 1,
      attributedRevenueCents: 12500,
    });
    expect(earlier?.attributedOrders).toBe(0);
  });

  it("does not attribute an order from an open without a click", async () => {
    const userId = randomUUID();
    await submit([
      engagementEvent({
        userId,
        timestamp: "2026-08-10T10:00:00.000Z",
        event: InternalEventType.EmailOpened,
      }),
      orderEvent({ userId, timestamp: "2026-08-11T10:00:00.000Z" }),
    ]);

    const result = await getRevenueSummary({
      workspaceId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    expect(result.summary).toMatchObject({
      totalOrders: 1,
      attributedOrders: 0,
      unattributedOrders: 1,
    });
  });
});
