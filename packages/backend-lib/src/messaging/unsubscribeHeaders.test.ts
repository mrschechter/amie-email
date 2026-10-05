import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import config from "../config";
import { generateSubscriptionChangeUrl } from "../subscriptionGroups";
import { constructUnsubscribeHeaders } from "./email";

jest.mock("../config", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("dotenv", () => ({ config: jest.fn() }));
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

const originalEnv = process.env;

function configure(env: NodeJS.ProcessEnv = {}) {
  process.env = { NODE_ENV: "test", ...env };
  jest.isolateModules(() => {
    const actualConfig =
      jest.requireActual<typeof import("../config")>("../config").default;
    jest.mocked(config).mockReturnValue(actualConfig());
  });
}

beforeEach(() => configure());
afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

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

it.each(["mail.tryamie.com", "replies.example.com", "MAIL.TRYAMIE.COM"])(
  "uses the configured hostname %s without changing one-click or List-ID",
  (domain) => {
    configure({
      UNSUBSCRIBE_MAILTO_ENABLED: "true",
      UNSUBSCRIBE_MAILTO_DOMAIN: domain,
    });
    expect(unwrap(constructUnsubscribeHeaders(params))).toEqual({
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "List-Unsubscribe": `<mailto:unsubscribe@${domain.toLowerCase()}?subject=unsubscribe>, <https://email.tryamie.com/api/public/subscription-management/page?w=workspace&i=user>`,
      "List-ID": "News <group.send.tryamie.com>",
    });
    expect(config().unsubscribeMailboxDomains).toContain(domain.toLowerCase());
    expect(
      config().unsubscribeMailboxDomains.filter(
        (value) => value === domain.toLowerCase(),
      ),
    ).toHaveLength(1);
  },
);

it("does not enable mailto just because an override is configured", () => {
  configure({ UNSUBSCRIBE_MAILTO_DOMAIN: "mail.tryamie.com" });
  expect(unwrap(constructUnsubscribeHeaders(params))["List-Unsubscribe"]).toBe(
    "<https://email.tryamie.com/api/public/subscription-management/page?w=workspace&i=user>",
  );
});

it("adds the override to an explicitly configured inbound domain list", () => {
  configure({
    UNSUBSCRIBE_MAILTO_DOMAIN: "mail.tryamie.com",
    UNSUBSCRIBE_MAILBOX_DOMAINS: " SEND.TRYAMIE.COM,em.tryamie.com ",
  });
  expect(config().unsubscribeMailboxDomains).toEqual([
    "send.tryamie.com",
    "em.tryamie.com",
    "mail.tryamie.com",
  ]);
});

it.each([
  "",
  "https://mail.tryamie.com",
  "unsubscribe@mail.tryamie.com",
  "mail.tryamie.com:25",
  "mail.tryamie.com/path",
  "mail.tryamie.com?subject=other",
  "mail.tryamie.com>, <mailto:other@example.com",
  "mail.tryamie.com\r\nBcc: other@example.com",
  "mail.tryamie.com\n",
  "mail domain.example",
  "-mail.example.com",
  "mail-.example.com",
  "mail..example.com",
  "mail_domain.example.com",
  `${"a".repeat(64)}.example.com`,
  Array(4).fill("a".repeat(63)).join("."),
])(
  "warns and falls back to the From domain for invalid override %j",
  (domain) => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    configure({
      UNSUBSCRIBE_MAILTO_ENABLED: "true",
      UNSUBSCRIBE_MAILTO_DOMAIN: domain,
    });
    expect(config().unsubscribeMailtoDomain).toBeUndefined();
    expect(config().unsubscribeMailboxDomains).toEqual([
      "send.tryamie.com",
      "mail.tryamie.com",
      "em.tryamie.com",
    ]);
    expect(
      unwrap(constructUnsubscribeHeaders(params))["List-Unsubscribe"],
    ).toBe(
      "<mailto:unsubscribe@send.tryamie.com?subject=unsubscribe>, <https://email.tryamie.com/api/public/subscription-management/page?w=workspace&i=user>",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Ignoring invalid UNSUBSCRIBE_MAILTO_DOMAIN: expected a hostname",
    );
  },
);

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
