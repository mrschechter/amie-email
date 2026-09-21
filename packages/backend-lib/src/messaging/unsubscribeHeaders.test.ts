import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import config from "../config";
import { generateSubscriptionChangeUrl } from "../subscriptionGroups";
import { constructUnsubscribeHeaders } from "./email";

jest.mock("../config", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../db", () => ({}));
jest.mock("../subscriptionGroups", () => ({
  generateSubscriptionChangeUrl: jest.fn(
    () =>
      "https://email.tryamie.com/api/public/subscription-management/page?w=workspace&i=user",
  ),
}));

const params = {
  to: "reader@example.com",
  from: "sender@send.tryamie.com",
  userId: "user",
  identifierKey: "email",
  subscriptionGroupSecret: "test-secret",
  subscriptionGroupName: "News",
  workspaceId: "workspace",
  subscriptionGroupId: "group",
};

it("preserves all header bytes when the flag is off", () => {
  jest
    .mocked(config)
    .mockReturnValue({ ...config(), unsubscribeMailtoEnabled: false });
  expect(unwrap(constructUnsubscribeHeaders(params))).toEqual({
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "List-Unsubscribe":
      "<https://email.tryamie.com/api/public/subscription-management/page?w=workspace&i=user>",
    "List-ID": "News <group.send.tryamie.com>",
  });
});

it.each([
  "sender@send.tryamie.com",
  '"Sender, Team" <sender@send.tryamie.com>',
])("adds mailto first with exact brackets for %s", (from) => {
  jest
    .mocked(config)
    .mockReturnValue({ ...config(), unsubscribeMailtoEnabled: true });
  const enabled = unwrap(constructUnsubscribeHeaders({ ...params, from }));
  expect(enabled["List-Unsubscribe"]).toBe(
    "<mailto:unsubscribe@send.tryamie.com?subject=unsubscribe>, <https://email.tryamie.com/api/public/subscription-management/page?w=workspace&i=user>",
  );
  jest
    .mocked(config)
    .mockReturnValue({ ...config(), unsubscribeMailtoEnabled: false });
  const disabled = unwrap(constructUnsubscribeHeaders({ ...params, from }));
  expect(enabled["List-ID"]).toBe(disabled["List-ID"]);
  expect(enabled["List-Unsubscribe-Post"]).toBe(
    disabled["List-Unsubscribe-Post"],
  );
  expect(generateSubscriptionChangeUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: "workspace",
      identifier: "reader@example.com",
      identifierKey: "email",
    }),
  );
});
