import { SecretNames } from "isomorphic-lib/src/constants";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { db } from "./db";
import { renderLiquid } from "./liquid";
import { constructUnsubscribeHeaders } from "./messaging/email";
import { insertSegmentAssignments } from "./segments";
import {
  signSubscriptionAttribution,
  verifySubscriptionAttribution,
} from "./subscriptionAttribution";
import {
  buildSubscriptionChangeEventInner,
  generateSubscriptionChangeUrl,
  lookupUserForSubscriptions,
  updateUserSubscriptions,
} from "./subscriptionGroups";
import { generateSubscriptionManagementPage } from "./subscriptionManagementPage";
import { SubscriptionChange } from "./types";
import { insertUserEvents } from "./userEvents";
import { findUserIdsByUserPropertyValue } from "./userProperties";

jest.mock("./db", () => ({ db: jest.fn() }));
jest.mock("./segments", () => ({ insertSegmentAssignments: jest.fn() }));
jest.mock("./userEvents", () => ({ insertUserEvents: jest.fn() }));
jest.mock("./userProperties", () => ({
  ...jest.requireActual<typeof import("./userProperties")>("./userProperties"),
  findUserIdsByUserPropertyValue: jest.fn(),
}));
jest.mock("./logger", () => ({
  __esModule: true,
  default: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const metadata = {
  messageId: "original-send",
  journeyId: "journey",
  broadcastId: "broadcast",
  templateId: "template",
  nodeId: "node",
  email: "person@example.com",
};
const identity = {
  workspaceId: "workspace",
  userId: "user",
  identifier: metadata.email,
  identifierKey: "email",
  subscriptionSecret: "test-secret",
};

beforeEach(() => {
  jest.clearAllMocks();
  // The identity lookup, rendering and event builders remain real.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  jest.mocked(db).mockReturnValue({
    query: {
      secret: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ value: identity.subscriptionSecret }),
      },
      segment: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionManagementTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    },
  } as unknown as ReturnType<typeof db>);
  jest
    .mocked(findUserIdsByUserPropertyValue)
    .mockResolvedValue([identity.userId]);
});

it.each([
  "unsubscribe_url",
  "subscription_management_url",
  "unsubscribe_link",
  "subscription_management_link",
])(
  "carries signed metadata through %s, page, identity lookup and event creation",
  async (tag) => {
    const rendered = renderLiquid({
      template: `{% ${tag} %}`,
      workspaceId: identity.workspaceId,
      identifierKey: "email",
      subscriptionGroupId: "group",
      tags: metadata,
      secrets: { [SecretNames.Subscription]: identity.subscriptionSecret },
      userProperties: { id: identity.userId, email: identity.identifier },
    });
    const url = new URL(
      tag.endsWith("_link")
        ? rendered.match(/href="([^"]+)"/)?.[1] ?? ""
        : rendered,
    );
    const hash = url.searchParams.get("h") ?? "";
    const attribution = url.searchParams.get("attribution") ?? "";
    const lookup = { ...identity, hash, attribution };
    const user = unwrap(await lookupUserForSubscriptions(lookup));
    expect(user).toEqual({
      userId: identity.userId,
      messageMetadata: metadata,
    });
    const html = await generateSubscriptionManagementPage({
      ...identity,
      hash,
      attribution,
      workspaceName: "Test",
      subscriptions: [],
      isPreview: false,
    });
    expect(html).toContain(`name="attribution" value="${attribution}"`);
    await updateUserSubscriptions({
      workspaceId: identity.workspaceId,
      userUpdates: [{ ...user, changes: { group: false, second: false } }],
    });
    const events =
      jest.mocked(insertUserEvents).mock.calls[0]?.[0].userEvents ?? [];
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(
        typeof event.messageRaw === "string"
          ? JSON.parse(event.messageRaw)
          : event.messageRaw,
      ).toMatchObject({
        event: "DFSubscriptionChange",
        properties: { ...metadata, action: "Unsubscribe" },
      });
      expect(event.messageId).not.toBe(metadata.messageId);
    }
    expect(insertSegmentAssignments).toHaveBeenCalled();
  },
);

it("puts the same original-send metadata in the one-click header URL", () => {
  const headers = unwrap(
    constructUnsubscribeHeaders({
      to: identity.identifier,
      from: "sender@example.com",
      userId: identity.userId,
      identifierKey: "email",
      subscriptionGroupSecret: identity.subscriptionSecret,
      subscriptionGroupName: "News",
      workspaceId: identity.workspaceId,
      subscriptionGroupId: "group",
      messageMetadata: metadata,
    }),
  );
  const url = new URL(
    headers["List-Unsubscribe"].match(/<(https?[^>]+)>/)?.[1] ?? "",
  );
  expect(
    verifySubscriptionAttribution(
      url.searchParams.get("attribution") ?? undefined,
      url.searchParams.get("h") ?? "",
      identity.subscriptionSecret,
    ),
  ).toEqual(metadata);
});

it("preserves old links and events; tampering cannot attribute another identity or change the authenticated user", async () => {
  const url = new URL(generateSubscriptionChangeUrl(identity));
  const hash = url.searchParams.get("h") ?? "";
  expect(url.searchParams.has("attribution")).toBe(false);
  expect(
    unwrap(await lookupUserForSubscriptions({ ...identity, hash })),
  ).toEqual({ userId: "user" });
  const token = signSubscriptionAttribution(
    metadata,
    hash,
    identity.subscriptionSecret,
  );
  await Promise.all(
    [
      token.replace(".", "x."),
      `${token}.extra`,
      signSubscriptionAttribution(
        metadata,
        "another-identity-hash",
        identity.subscriptionSecret,
      ),
    ].map(async (attribution) => {
      expect(
        unwrap(
          await lookupUserForSubscriptions({ ...identity, hash, attribution }),
        ),
      ).toEqual({ userId: "user" });
    }),
  );
  expect(
    (
      await lookupUserForSubscriptions({
        ...identity,
        hash: "wrong",
        attribution: token,
      })
    ).isErr(),
  ).toBe(true);
  expect(
    buildSubscriptionChangeEventInner({
      userId: "user",
      messageId: "event-id",
      timestamp: "now",
      subscriptionGroupId: "group",
      action: SubscriptionChange.Unsubscribe,
    }).properties,
  ).toEqual({ subscriptionId: "group", action: "Unsubscribe" });
});
