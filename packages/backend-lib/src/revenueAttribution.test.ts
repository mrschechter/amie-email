import { randomUUID } from "crypto";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { submitBatch } from "./apps/batch";
import config from "./config";
import {
  buildRevenueAttributionFile,
  getRevenueBreakdown,
  getRevenueSummary,
} from "./revenueAttribution";
import { BatchItem, EventType, InternalEventType } from "./types";
import { createWorkspace } from "./workspaces";

describe("revenue attribution", () => {
  let workspaceId: string;
  const rangeStart = "2026-08-01T00:00:00.000Z";
  const rangeEnd = "2026-08-31T23:59:59.999Z";

  let originalIncludeOpens: boolean;

  beforeEach(async () => {
    originalIncludeOpens = config().amieAttributionIncludeOpens;
    config().amieAttributionIncludeOpens = false;
    workspaceId = unwrap(
      await createWorkspace({ name: `revenue-test-${randomUUID()}` }),
    ).id;
  });

  afterEach(() => {
    config().amieAttributionIncludeOpens = originalIncludeOpens;
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
  }): Extract<BatchItem, { type: EventType.Track }> {
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
    orderId = randomUUID(),
    paidAt = timestamp,
    amountCents = 12500,
    kind = "new",
  }: {
    userId: string;
    timestamp: string;
    orderId?: string;
    paidAt?: string;
    amountCents?: number;
    kind?: "new" | "renewal";
  }): Extract<BatchItem, { type: EventType.Track }> {
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
        paidAt,
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
      currency: "USD",
      attributionTouch: "click",
      totalOrders: 1,
      attributedOrders: 1,
      attributedNewOrders: 1,
      attributedRevenueCents: 12500,
      unattributedOrders: 0,
    });
  });

  it("deduplicates an order using the latest processing time", async () => {
    const userId = randomUUID();
    const orderId = randomUUID();
    const paidAt = "2026-08-12T10:00:00.000Z";
    await submit([
      orderEvent({
        userId,
        orderId,
        paidAt,
        timestamp: "2026-08-12T10:01:00.000Z",
        amountCents: 10000,
      }),
      orderEvent({
        userId,
        orderId,
        paidAt,
        timestamp: "2026-08-12T10:02:00.000Z",
        amountCents: 17500,
      }),
    ]);

    const result = await getRevenueSummary({
      workspaceId,
      startDate: rangeStart,
      endDate: rangeEnd,
    });

    expect(result.summary).toMatchObject({
      totalOrders: 1,
      totalRevenueCents: 17500,
      unattributedOrders: 1,
      unattributedRevenueCents: 17500,
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

  function legacyOrderEvent({
    userId,
    orderId = randomUUID(),
    timestamp = "2026-08-12T10:00:00.000Z",
    total = "125.25",
    isFirstOrder,
  }: {
    userId: string;
    orderId?: string | number;
    timestamp?: string;
    total?: string | number;
    isFirstOrder?: boolean | string;
  }): Extract<BatchItem, { type: EventType.Track }> {
    return {
      type: EventType.Track,
      event: "order_paid",
      userId,
      messageId: randomUUID(),
      timestamp,
      properties: {
        orderId,
        total,
        productHandle: "test-product",
        isFirstOrder,
      },
    };
  }

  it.each([
    { total: "125.256", isFirstOrder: true, cents: 12526, kind: "New" },
    { total: 42.124, isFirstOrder: "true", cents: 4212, kind: "New" },
    { total: "65.99", isFirstOrder: false, cents: 6599, kind: "Renewal" },
    { total: 25, isFirstOrder: "false", cents: 2500, kind: "Renewal" },
    { total: "10", isFirstOrder: undefined, cents: 1000, kind: "Unknown" },
    { total: 0, isFirstOrder: "other", cents: 0, kind: "Unknown" },
  ])(
    "reads legacy dollars and classifies $isFirstOrder as $kind",
    async ({ total, isFirstOrder, cents, kind }) => {
      const userId = randomUUID();
      const broadcastId = randomUUID();
      await submit([
        engagementEvent({
          userId,
          broadcastId,
          timestamp: "2026-08-11T10:00:00.000Z",
          event: InternalEventType.EmailClicked,
        }),
        legacyOrderEvent({ userId, total, isFirstOrder }),
      ]);
      const request = { workspaceId, startDate: rangeStart, endDate: rangeEnd };
      const { summary } = await getRevenueSummary(request);
      expect(summary).toMatchObject({
        currency: "USD",
        totalOrders: 1,
        totalRevenueCents: cents,
        attributedOrders: 1,
        attributedRevenueCents: cents,
        attributedNewOrders: kind === "New" ? 1 : 0,
        attributedRenewalOrders: kind === "Renewal" ? 1 : 0,
        attributedUnknownOrders: kind === "Unknown" ? 1 : 0,
        [`attributed${kind}RevenueCents`]: cents,
      });
      const breakdown = await getRevenueBreakdown({
        ...request,
        groupBy: "broadcast",
      });
      expect(
        breakdown.rows.find((row) => row.sourceId === broadcastId),
      ).toMatchObject({
        attributedOrders: 1,
        attributedRevenueCents: cents,
        [`attributed${kind}Orders`]: 1,
      });
      const csv = await buildRevenueAttributionFile(request);
      const [header, row] = csv.fileContent.split("\n");
      expect(header?.split(",")).toContain("Unknown orders");
      const values = Object.fromEntries(
        (header?.split(",") ?? []).map((key, index) => [
          key,
          row?.split(",")[index],
        ]),
      );
      expect(values).toMatchObject({
        [`${kind} orders`]: "1",
        "Attributed revenue (USD)": (cents / 100).toFixed(2),
      });
    },
  );

  it.each([0, 4567])(
    "prefers present amountCents=%s over legacy total and preserves kind",
    async (amountCents) => {
      const userId = randomUUID();
      const order = orderEvent({
        userId,
        timestamp: "2026-08-12T10:00:00.000Z",
        amountCents,
        kind: "renewal",
      });
      await submit([
        engagementEvent({
          userId,
          timestamp: "2026-08-11T10:00:00.000Z",
          event: InternalEventType.EmailClicked,
        }),
        {
          ...order,
          properties: {
            ...order.properties,
            total: "999.99",
            isFirstOrder: true,
          },
        },
      ]);
      const { summary } = await getRevenueSummary({
        workspaceId,
        startDate: rangeStart,
        endDate: rangeEnd,
      });
      expect(summary).toMatchObject({
        totalRevenueCents: amountCents,
        attributedRenewalOrders: 1,
        attributedNewOrders: 0,
      });
    },
  );

  it.each([123456, "123456", "gid://shopify/Order/123456"])(
    "deduplicates legacy id %s against the new gid using processing time",
    async (legacyId) => {
      const userId = randomUUID();
      const broadcastId = randomUUID();
      const newer = orderEvent({
        userId,
        orderId: "gid://shopify/Order/123456",
        timestamp: "2026-08-12T10:00:00.000Z",
        amountCents: 17500,
        kind: "renewal",
      });
      const older = legacyOrderEvent({
        userId,
        orderId: legacyId,
        timestamp: "2026-08-13T10:00:00.000Z",
        total: 100,
        isFirstOrder: true,
      });
      await submit([
        engagementEvent({
          userId,
          broadcastId,
          timestamp: "2026-08-11T10:00:00.000Z",
          event: InternalEventType.EmailClicked,
        }),
      ]);
      // The later-processed event has an earlier event_time.
      await submitBatch(
        { workspaceId, data: { batch: [older] } },
        { processingTime: new Date("2026-08-14T10:00:00.000Z").getTime() },
      );
      await submitBatch(
        { workspaceId, data: { batch: [newer] } },
        { processingTime: new Date("2026-08-15T10:00:00.000Z").getTime() },
      );
      const request = { workspaceId, startDate: rangeStart, endDate: rangeEnd };
      expect((await getRevenueSummary(request)).summary).toMatchObject({
        totalOrders: 1,
        totalRevenueCents: 17500,
        attributedRenewalOrders: 1,
        attributedNewOrders: 0,
      });
      expect(
        (await getRevenueBreakdown({ ...request, groupBy: "email" })).rows,
      ).toEqual([
        expect.objectContaining({
          attributedOrders: 1,
          attributedRevenueCents: 17500,
          attributedRenewalOrders: 1,
        }),
      ]);
      expect(
        (await buildRevenueAttributionFile(request)).fileContent,
      ).toContain("175.00");
      // A later legacy emission must also win.
      await submitBatch(
        {
          workspaceId,
          data: { batch: [{ ...older, messageId: randomUUID() }] },
        },
        { processingTime: new Date("2026-08-16T10:00:00.000Z").getTime() },
      );
      expect((await getRevenueSummary(request)).summary).toMatchObject({
        totalOrders: 1,
        totalRevenueCents: 10000,
        attributedNewOrders: 1,
        attributedRenewalOrders: 0,
      });
    },
  );

  it("preserves distinct Stripe and other string ids and falls back to message id", async () => {
    const userId = randomUUID();
    const timestamp = "2026-08-12T10:00:00.000Z";
    await submit([
      ...[
        "pi_123",
        "in_123",
        "123",
        "custom/123",
        "gid://shopify/Order/123extra",
      ].map((orderId) =>
        orderEvent({ userId, timestamp, orderId, amountCents: 100 }),
      ),
      ...[1, 2].map(() => ({
        ...orderEvent({ userId, timestamp }),
        properties: { total: 1 },
      })),
    ]);
    expect(
      (
        await getRevenueSummary({
          workspaceId,
          startDate: rangeStart,
          endDate: rangeEnd,
        })
      ).summary,
    ).toMatchObject({ totalOrders: 7, totalRevenueCents: 700 });
  });

  it.each<InternalEventType.EmailOpened | InternalEventType.EmailClicked>([
    InternalEventType.EmailOpened,
    InternalEventType.EmailClicked,
  ])(
    "uses the latest touch (%s) when opens are enabled",
    async (latestEvent) => {
      config().amieAttributionIncludeOpens = true;
      const userId = randomUUID();
      const broadcastId = randomUUID();
      await submit([
        engagementEvent({
          userId,
          timestamp: "2026-08-10T10:00:00.000Z",
          event:
            latestEvent === InternalEventType.EmailOpened
              ? InternalEventType.EmailClicked
              : InternalEventType.EmailOpened,
        }),
        engagementEvent({
          userId,
          broadcastId,
          timestamp: "2026-08-11T10:00:00.000Z",
          event: latestEvent,
        }),
        engagementEvent({
          userId,
          timestamp: "2026-08-13T10:00:00.000Z",
          event: InternalEventType.EmailOpened,
        }),
        legacyOrderEvent({ userId }),
      ]);
      const request = { workspaceId, startDate: rangeStart, endDate: rangeEnd };
      expect((await getRevenueSummary(request)).summary).toMatchObject({
        attributionTouch: "click_or_open",
        attributedOrders: 1,
        attributedUnknownOrders: 1,
      });
      const { rows } = await getRevenueBreakdown({
        ...request,
        groupBy: "broadcast",
      });
      expect(rows.filter((row) => row.attributedOrders > 0)).toEqual([
        expect.objectContaining({
          sourceId: broadcastId,
          attributedOrders: 1,
          clicks: latestEvent === InternalEventType.EmailClicked ? 1 : 0,
        }),
      ]);
      expect(
        (await buildRevenueAttributionFile(request)).fileContent,
      ).toContain(broadcastId);
    },
  );

  it("ignores a later open when opens are disabled", async () => {
    const userId = randomUUID();
    const broadcastId = randomUUID();
    await submit([
      engagementEvent({
        userId,
        broadcastId,
        timestamp: "2026-08-10T10:00:00.000Z",
        event: InternalEventType.EmailClicked,
      }),
      engagementEvent({
        userId,
        timestamp: "2026-08-11T10:00:00.000Z",
        event: InternalEventType.EmailOpened,
      }),
      legacyOrderEvent({ userId }),
    ]);
    const request = { workspaceId, startDate: rangeStart, endDate: rangeEnd };
    expect((await getRevenueSummary(request)).summary).toMatchObject({
      attributionTouch: "click",
      attributedOrders: 1,
    });
    const { rows } = await getRevenueBreakdown({
      ...request,
      groupBy: "broadcast",
    });
    expect(rows.filter((row) => row.attributedOrders > 0)).toEqual([
      expect.objectContaining({ sourceId: broadcastId, attributedOrders: 1 }),
    ]);
  });

  it.each([false, true])(
    "applies the opens toggle (%s) and attribution window",
    async (includeOpens) => {
      config().amieAttributionIncludeOpens = includeOpens;
      const userId = randomUUID();
      await submit([
        engagementEvent({
          userId,
          timestamp: "2026-08-10T10:00:00.000Z",
          event: InternalEventType.EmailOpened,
        }),
        legacyOrderEvent({ userId, timestamp: "2026-08-11T10:00:00.000Z" }),
        legacyOrderEvent({ userId, timestamp: "2026-08-16T10:00:00.000Z" }),
      ]);
      expect(
        (
          await getRevenueSummary({
            workspaceId,
            startDate: rangeStart,
            endDate: rangeEnd,
          })
        ).summary,
      ).toMatchObject({
        attributionTouch: includeOpens ? "click_or_open" : "click",
        totalOrders: 2,
        attributedOrders: includeOpens ? 1 : 0,
        unattributedOrders: includeOpens ? 1 : 2,
      });
    },
  );
});
