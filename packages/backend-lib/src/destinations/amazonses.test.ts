import { randomUUID } from "node:crypto";

import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { submitBatch } from "../apps/batch";
import { canWorkspaceReceiveEventsById } from "../auth";
import { db } from "../db";
import {
  AmazonSesBounceEvent,
  AmazonSesBounceSubType,
  AmazonSesBounceType,
  AmazonSesComplaintEvent,
  AmazonSesComplaintSubType,
  AmazonSesNotificationType,
  AmazonSNSEventTypes,
  AmazonSNSNotificationEvent,
  ChannelType,
  EventType,
  InternalEventType,
  SubscriptionChange,
} from "../types";
import { handleSesNotification } from "./amazonses";

jest.mock("../apps/batch", () => ({ submitBatch: jest.fn() }));
jest.mock("../auth", () => ({ canWorkspaceReceiveEventsById: jest.fn() }));
jest.mock("../db", () => ({
  db: jest.fn(),
  endPool: jest.fn(),
}));
jest.mock("../logger", () => ({
  __esModule: true,
  default: () => ({ error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

function notification(message: unknown): AmazonSNSNotificationEvent {
  return {
    Type: AmazonSNSEventTypes.Notification,
    Message: JSON.stringify(message),
    MessageId: randomUUID(),
    TopicArn: "arn:aws:sns:us-east-1:123456789012:ses-events",
    Timestamp: "2026-09-29T03:20:00.000Z",
    SignatureVersion: "1",
    Signature: "test-signature",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/test.pem",
    UnsubscribeURL: "https://sns.us-east-1.amazonaws.com/",
  };
}

describe("handleSesNotification", () => {
  const findGroups = jest.fn<
    Promise<{ id: string }[]>,
    [{ where: SQL; columns: { id: boolean } }]
  >();
  let workspaceId: string;
  let emailGroupIds: string[];
  let complaint: AmazonSesComplaintEvent;
  let bounce: AmazonSesBounceEvent;

  beforeEach(() => {
    workspaceId = randomUUID();
    emailGroupIds = [randomUUID(), randomUUID()];
    findGroups
      .mockReset()
      .mockResolvedValue(emailGroupIds.map((id) => ({ id })));
    // Only the database boundary is mocked; the real Drizzle predicate and
    // subscription-change builder are exercised below.
    const databaseMock = {
      query: { subscriptionGroup: { findMany: findGroups } },
    };
    // Only the query used by this handler is needed in the database mock.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const mockedDatabase = databaseMock as unknown as ReturnType<typeof db>;
    jest.mocked(db).mockReturnValue(mockedDatabase);
    jest.mocked(canWorkspaceReceiveEventsById).mockResolvedValue(true);
    jest.mocked(submitBatch).mockReset().mockResolvedValue(undefined);

    // Synthetic fixtures use the SES configuration-set event-publishing shape:
    // https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
    const mail = {
      timestamp: "2026-09-29T03:00:00.000Z",
      messageId: "ses-message-id",
      source: "sender@example.com",
      sourceArn: "arn:aws:ses:us-east-1:123456789012:identity/example.com",
      sendingAccountId: "123456789012",
      destination: ["recipient@example.com"],
      tags: {
        workspaceId: [workspaceId],
        userId: ["user-123"],
        journeyId: [randomUUID()],
        templateId: [randomUUID()],
        broadcastId: [randomUUID()],
        nodeId: ["email-node"],
        messageId: [randomUUID()],
        "ses:configuration-set": ["test-config-set"],
      },
    };
    complaint = {
      eventType: AmazonSesNotificationType.Complaint,
      mail,
      complaint: {
        complainedRecipients: [{ emailAddress: "recipient@example.com" }],
        timestamp: "2026-09-29T03:20:00.000Z",
        feedbackId: "ses-complaint-feedback-id",
        complaintSubType: null,
        complaintFeedbackType: "abuse",
        userAgent: "Example feedback loop",
        arrivalDate: "2026-09-29T03:00:00.000Z",
      },
    };
    bounce = {
      eventType: AmazonSesNotificationType.Bounce,
      mail,
      bounce: {
        timestamp: "2026-09-29T03:20:00.000Z",
        feedbackId: "ses-bounce-feedback-id",
        bounceType: AmazonSesBounceType.Transient,
        bounceSubType: AmazonSesBounceSubType.MailboxFull,
        bouncedRecipients: [
          {
            emailAddress: "recipient@example.com",
            action: "failed",
            status: "4.2.2",
            diagnosticCode: "smtp; 452 4.2.2 Mailbox full",
          },
        ],
        reportingMTA: "dns; example.com",
      },
    };
  });

  it("accepts emailAddress and null subtype, recording spam and email opt-outs with stable IDs", async () => {
    unwrap(await handleSesNotification(notification(complaint)));
    const submission = jest.mocked(submitBatch).mock.calls[0]?.[0];
    expect(submission?.workspaceId).toBe(workspaceId);
    const batch = submission?.data.batch;
    expect(batch).toHaveLength(3);
    expect(batch?.[0]).toMatchObject({
      type: EventType.Track,
      event: InternalEventType.EmailMarkedSpam,
      userId: "user-123",
      timestamp: complaint.complaint.timestamp,
      properties: {
        email: "recipient@example.com",
        journeyId: complaint.mail.tags?.journeyId?.[0],
        templateId: complaint.mail.tags?.templateId?.[0],
        broadcastId: complaint.mail.tags?.broadcastId?.[0],
        nodeId: "email-node",
      },
    });
    expect(batch?.slice(1)).toMatchObject(
      emailGroupIds.map((id) => ({
        type: EventType.Track,
        event: InternalEventType.SubscriptionChange,
        userId: "user-123",
        timestamp: complaint.complaint.timestamp,
        properties: {
          subscriptionId: id,
          action: SubscriptionChange.Unsubscribe,
        },
      })),
    );
    expect(new Set(batch?.map((item) => item.messageId)).size).toBe(3);

    // A retry with a different SNS envelope ID must reuse all event IDs and
    // the original complaint time, including after a later subscription change.
    unwrap(await handleSesNotification(notification(complaint)));
    expect(jest.mocked(submitBatch).mock.calls[1]?.[0]).toEqual(submission);
  });

  it("selects only Email groups in the tagged workspace, independently of group name/type", async () => {
    unwrap(await handleSesNotification(notification(complaint)));
    const query = findGroups.mock.calls[0]?.[0];
    expect(query).toBeDefined();
    if (!query) throw new Error("Expected subscription group query");
    const sql = new PgDialect().sqlToQuery(query.where);
    expect(sql.sql).toBe(
      '("SubscriptionGroup"."workspaceId" = $1 and "SubscriptionGroup"."channel" = $2)',
    );
    expect(sql.params).toEqual([workspaceId, ChannelType.Email]);
  });

  it.each([
    AmazonSesComplaintSubType.OnAccountSuppressionList,
    AmazonSesComplaintSubType.OnTenantSuppressionList,
  ])(
    "acknowledges %s without a new spam event or unsubscribe",
    async (subtype) => {
      complaint.complaint.complaintSubType = subtype;
      delete complaint.complaint.complaintFeedbackType;
      unwrap(await handleSesNotification(notification(complaint)));
      expect(submitBatch).not.toHaveBeenCalled();
      expect(findGroups).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, AmazonSesComplaintSubType.Abuse])(
    "preserves legacy email/subtype compatibility (%s)",
    async (subtype) => {
      complaint.complaint.complaintSubType = subtype;
      complaint.complaint.complainedRecipients = [
        { email: "recipient@example.com" },
      ];
      unwrap(await handleSesNotification(notification(complaint)));
      expect(
        jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch,
      ).toHaveLength(3);
    },
  );

  it("records spam even when the workspace has no email groups", async () => {
    findGroups.mockResolvedValue([]);
    unwrap(await handleSesNotification(notification(complaint)));
    expect(jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch).toHaveLength(
      1,
    );
  });

  it("does not infer a user from the email address when the userId tag is absent", async () => {
    delete complaint.mail.tags?.userId;
    unwrap(await handleSesNotification(notification(complaint)));
    expect(findGroups).not.toHaveBeenCalled();
    expect(jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch).toEqual([]);
  });

  it.each([
    [AmazonSesBounceType.Transient, AmazonSesBounceSubType.MailboxFull],
    [AmazonSesBounceType.Permanent, AmazonSesBounceSubType.General],
    [
      AmazonSesBounceType.Permanent,
      AmazonSesBounceSubType.OnAccountSuppressionList,
    ],
    [
      AmazonSesBounceType.Permanent,
      AmazonSesBounceSubType.OnTenantSuppressionList,
    ],
    [
      AmazonSesBounceType.Permanent,
      AmazonSesBounceSubType.EmailValidationSuppressed,
    ],
    [
      AmazonSesBounceType.Transient,
      AmazonSesBounceSubType.CustomTimeoutExceeded,
    ],
  ])(
    "records %s/%s bounce classification without unsubscribing",
    async (type, subtype) => {
      bounce.bounce.bounceType = type;
      bounce.bounce.bounceSubType = subtype;
      unwrap(await handleSesNotification(notification(bounce)));
      const batch = jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch;
      expect(batch).toHaveLength(1);
      expect(batch).toMatchObject([
        {
          event: InternalEventType.EmailBounced,
          properties: { bounceType: type, bounceSubType: subtype },
        },
      ]);
      expect(findGroups).not.toHaveBeenCalled();
    },
  );

  it("keeps accepting legacy bounce payloads with omitted classification", async () => {
    delete bounce.bounce.bounceType;
    delete bounce.bounce.bounceSubType;
    unwrap(await handleSesNotification(notification(bounce)));
    expect(findGroups).not.toHaveBeenCalled();
  });

  it.each([
    { complainedRecipients: [{}] },
    { complainedRecipients: [{ emailAddress: 123 }] },
    { complaintSubType: "invalid-subtype" },
    { timestamp: null },
  ])("rejects malformed complaints: %j", async (invalidFields) => {
    const result = await handleSesNotification(
      notification({
        ...complaint,
        complaint: { ...complaint.complaint, ...invalidFields },
      }),
    );
    expect(result.isErr()).toBe(true);
    expect(submitBatch).not.toHaveBeenCalled();
    expect(findGroups).not.toHaveBeenCalled();
  });

  it("rejects malformed bounce classification", async () => {
    const result = await handleSesNotification(
      notification({
        ...bounce,
        bounce: { ...bounce.bounce, bounceType: "invalid" },
      }),
    );
    expect(result.isErr()).toBe(true);
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const body = notification(complaint);
    body.Message = "{";
    expect((await handleSesNotification(body)).isErr()).toBe(true);
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("rejects ineligible workspaces before looking up groups or emitting events", async () => {
    jest.mocked(canWorkspaceReceiveEventsById).mockResolvedValue(false);
    expect((await handleSesNotification(notification(complaint))).isErr()).toBe(
      true,
    );
    expect(findGroups).not.toHaveBeenCalled();
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("does not acknowledge or emit a partial batch if group lookup fails", async () => {
    findGroups.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(
      handleSesNotification(notification(complaint)),
    ).rejects.toThrow("lookup failed");
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it.each([
    [
      AmazonSesNotificationType.Delivery,
      "delivery",
      InternalEventType.EmailDelivered,
    ],
    [AmazonSesNotificationType.Open, "open", InternalEventType.EmailOpened],
    [AmazonSesNotificationType.Click, "click", InternalEventType.EmailClicked],
  ])(
    "keeps recording %s events without subscription changes",
    async (eventType, field, eventName) => {
      unwrap(
        await handleSesNotification(
          notification({
            eventType,
            mail: complaint.mail,
            [field]: { timestamp: complaint.complaint.timestamp },
          }),
        ),
      );
      const batch = jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch;
      expect(batch).toHaveLength(1);
      expect(batch?.[0]).toMatchObject({
        event: eventName,
        userId: "user-123",
      });
      expect(findGroups).not.toHaveBeenCalled();
    },
  );

  it("returns submission failures so SNS can retry the same event IDs", async () => {
    jest.mocked(submitBatch).mockRejectedValueOnce(new Error("write failed"));
    expect((await handleSesNotification(notification(complaint))).isErr()).toBe(
      true,
    );
    const failed = jest.mocked(submitBatch).mock.calls[0]?.[0];
    unwrap(await handleSesNotification(notification(complaint)));
    expect(jest.mocked(submitBatch).mock.calls[1]?.[0]).toEqual(failed);
  });
});
