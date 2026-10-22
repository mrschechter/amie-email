import { getExpectedTwilioSignature, validateRequest } from "twilio";

import { submitBatch } from "../apps/batch";
import config from "../config";
import { TwilioInboundSchema, TwilioMessageStatus } from "../types";
import {
  getTwilioWebhookPublicBaseUrl,
  sendSms,
  submitTwilioEvents,
} from "./twilio";

const mockCreate = jest.fn<
  Promise<{ sid: string }>,
  [{ statusCallback?: string }]
>();

jest.mock("twilio", () => {
  const actual = jest.requireActual<typeof import("twilio")>("twilio");
  const factory = jest.fn(() => ({ messages: { create: mockCreate } }));
  return Object.assign(factory, {
    __esModule: false,
    validateRequest: actual.validateRequest,
    getExpectedTwilioSignature: actual.getExpectedTwilioSignature,
  });
});
jest.mock("../config", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../apps/batch", () => ({
  submitBatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../logger", () => ({
  __esModule: true,
  default: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const workspaceId = "ea0a0a53-47d0-4af2-8906-8034e56c8578";
const authToken = "test-auth-token";

function setConfig(c: { apiBase: string; dashboardUrl: string }) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  jest.mocked(config).mockReturnValue(c as ReturnType<typeof config>);
}

async function send() {
  mockCreate.mockResolvedValue({ sid: "SM123" });
  const result = await sendSms({
    body: "hi",
    to: "+15555550100",
    subscriptionGroupId: "sg-1",
    userId: "user-1",
    workspaceId,
    accountSid: "AC123",
    auth: { type: "authToken", authToken },
    messagingServiceSid: "MG123",
    tags: {
      channel: "Sms",
      messageId: "msg-1",
      journeyId: "journey-1",
      templateId: "template-1",
    },
  });
  expect(result.isOk()).toBe(true);
  const payload = mockCreate.mock.calls[0]?.[0];
  if (!payload) {
    throw new Error("messages.create was not called");
  }
  return payload;
}

describe("Twilio status callback URL", () => {
  it("uses the configured API base instead of the upstream dashboardUrl default", async () => {
    // Live Amie Send config: DASHBOARD_API_BASE set, DASHBOARD_URL unset.
    setConfig({
      apiBase: "https://email.tryamie.com",
      dashboardUrl: "https://app.dittofeed.com",
    });
    const { statusCallback } = await send();
    const url = new URL(statusCallback ?? "");
    expect(url.origin).toBe("https://email.tryamie.com");
    expect(url.pathname).toBe("/api/public/webhooks/twilio");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      messageId: "msg-1",
      journeyId: "journey-1",
      templateId: "template-1",
      subscriptionGroupId: "sg-1",
      userId: "user-1",
      workspaceId,
    });
  });

  it("omits the callback rather than sending it to app.dittofeed.com", async () => {
    setConfig({
      apiBase: "https://app.dittofeed.com",
      dashboardUrl: "https://app.dittofeed.com",
    });
    const payload = await send();
    expect(payload.statusCallback).toBeUndefined();
  });

  it("signs and validates against the same URL the handler reconstructs", async () => {
    setConfig({
      apiBase: "https://email.tryamie.com/",
      dashboardUrl: "https://app.dittofeed.com",
    });
    const { statusCallback } = await send();
    const params = {
      MessageSid: "SM123",
      SmsStatus: "delivered",
      MessageStatus: "delivered",
    };
    // Twilio signs the exact callback URL it was given.
    const signature = getExpectedTwilioSignature(
      authToken,
      statusCallback ?? "",
      params,
    );
    // The handler rebuilds it as base + fastify request.url (path + query).
    const parsed = new URL(statusCallback ?? "");
    const requestUrl = `${parsed.pathname}${parsed.search}`;
    expect(
      validateRequest(
        authToken,
        signature,
        `${getTwilioWebhookPublicBaseUrl()}${requestUrl}`,
        params,
      ),
    ).toBe(true);
    // The old reconstruction (dashboardUrl) fails, which is the live bug.
    expect(
      validateRequest(
        authToken,
        signature,
        `https://app.dittofeed.com${requestUrl}`,
        params,
      ),
    ).toBe(false);
  });
});

describe("submitTwilioEvents", () => {
  const baseEvent: TwilioInboundSchema = {
    SmsSid: "SM123",
    MessageSid: "SM123",
    MessagingServiceSid: "MG123",
    SmsStatus: TwilioMessageStatus.Delivered,
    To: "+15555550100",
    From: "+15555550111",
    AccountSid: "AC123",
    ApiVersion: "2010-04-01",
  };

  async function submit(event: Partial<TwilioInboundSchema>) {
    return submitTwilioEvents({
      workspaceId,
      userId: "user-1",
      messageId: "msg-1",
      templateId: "template-1",
      TwilioEvent: { ...baseEvent, ...event },
    });
  }

  it.each([
    [TwilioMessageStatus.Delivered, "DFSmsDelivered"],
    [TwilioMessageStatus.Failed, "DFSmsFailed"],
    [TwilioMessageStatus.Undelivered, "DFSmsFailed"],
  ])("records %s as %s tied to the sent message", async (status, event) => {
    const result = await submit({ SmsStatus: status, ErrorCode: "30003" });
    expect(result.isOk()).toBe(true);
    const batch = jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch;
    expect(batch).toHaveLength(1);
    expect(batch?.[0]).toMatchObject({
      event,
      userId: "user-1",
      properties: {
        workspaceId,
        messageId: "msg-1",
        templateId: "template-1",
        twilioStatus: status,
        twilioMessageSid: "SM123",
        twilioErrorCode: "30003",
      },
    });
  });

  it("uses a stable event id per status so Twilio retries dedupe", async () => {
    await submit({ SmsStatus: TwilioMessageStatus.Delivered });
    await submit({ SmsStatus: TwilioMessageStatus.Delivered });
    await submit({ SmsStatus: TwilioMessageStatus.Undelivered });
    const ids = jest
      .mocked(submitBatch)
      .mock.calls.map((c) => c[0].data.batch[0]?.messageId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it.each([
    TwilioMessageStatus.Queued,
    TwilioMessageStatus.Sending,
    TwilioMessageStatus.Sent,
    TwilioMessageStatus.Accepted,
  ])("ignores intermediate status %s without an error", async (status) => {
    const result = await submit({ SmsStatus: status });
    expect(result.isOk()).toBe(true);
    expect(submitBatch).not.toHaveBeenCalled();
  });
});
