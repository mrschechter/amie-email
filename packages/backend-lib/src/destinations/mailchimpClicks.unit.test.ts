import { submitBatch } from "../apps/batch";
import { MailChimpEvent, MailChimpEventType } from "../types";
import { submitMailChimpEvents } from "./mailchimp";

jest.mock("../apps/batch", () => ({
  submitBatch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../logger", () => ({
  __esModule: true,
  default: () => ({ info: jest.fn(), error: jest.fn() }),
}));

it("captures existing Mailchimp URLs and keeps click retries stable without collapsing distinct clicks", async () => {
  const base: MailChimpEvent = {
    event: MailChimpEventType.Click,
    ts: 1791849600,
    url: "https://example.com/offer?utm_campaign=fall&token=raw",
    msg: {
      _id: "provider-id",
      email: "fixture@example.com",
      metadata: {
        workspaceId: "9d6b0cb8-946b-4e1f-bf2e-987004e58a6d",
        userId: "fixture-user",
        broadcastId: "broadcast",
      },
    },
  };
  await submitMailChimpEvents({
    events: [
      base,
      base,
      { ...base, ts: base.ts + 1 },
      { ...base, url: "https://example.com/unsubscribe" },
      { ...base, url: undefined },
    ],
  });
  const batch = jest.mocked(submitBatch).mock.calls[0]?.[0].data.batch;
  expect(batch).toHaveLength(5);
  expect(batch?.[0]).toMatchObject({
    event: "DFEmailClicked",
    properties: {
      link: base.url,
      linkKind: "content",
      broadcastId: "broadcast",
    },
  });
  expect(batch?.[3]).toMatchObject({ properties: { linkKind: "unsubscribe" } });
  expect(batch?.[4]).not.toHaveProperty("properties.link");
  const ids = batch?.map((item) => item.messageId);
  expect(ids?.[0]).toBe(ids?.[1]);
  expect(new Set(ids).size).toBe(4);
});
