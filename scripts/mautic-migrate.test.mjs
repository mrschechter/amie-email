import assert from "node:assert/strict";
import test from "node:test";

import {
  AMIE_MAUTIC_EMAIL_NAMESPACE,
  FailureTracker,
  buildContactsPageUrl,
  buildOptOutPayload,
  contactToIdentifyPayload,
  contactToTraits,
  deriveUserId,
  isEmailDncRow,
  joinDncRowsWithEmails,
  requestWithRetry,
  retryDelayMs,
  runMigration,
  shouldRetry,
  uuidV5,
} from "./mautic-migrate.mjs";

function contact(overrides = {}) {
  return {
    id: 42,
    dateAdded: "2025-01-02T03:04:05+00:00",
    fields: {
      core: {
        email: { value: " Person@Example.COM " },
        firstname: { value: " Ada " },
        lastname: { value: " Lovelace " },
      },
    },
    tags: [{ tag: "Customer" }, { name: "VIP" }, { tag: "Customer" }],
    ...overrides,
  };
}

test("userId derivation is UUIDv5 of the normalized email", () => {
  const first = deriveUserId(" Person@Example.COM ");
  const second = deriveUserId("person@example.com");

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first, uuidV5("person@example.com", AMIE_MAUTIC_EMAIL_NAMESPACE));
  assert.throws(() => deriveUserId("  "), /without an email/);
});

test("contact maps to normalized Amie traits and a stable identify payload", () => {
  assert.deepEqual(contactToTraits(contact()), {
    email: "person@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    mauticId: "42",
    mauticTags: ["Customer", "VIP"],
    createdAt: "2025-01-02T03:04:05+00:00",
  });

  const payload = contactToIdentifyPayload(contact());
  assert.equal(payload.userId, deriveUserId("person@example.com"));
  assert.match(payload.messageId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(payload, contactToIdentifyPayload(contact()));

  const noEmail = contact({
    fields: { core: { email: { value: " " } } },
  });
  assert.equal(contactToTraits(noEmail), null);
  assert.equal(contactToIdentifyPayload(noEmail), null);
});

test("DNC filtering and email join keep email rows, skip missing email, and dedupe", () => {
  const rows = [
    { lead_id: 42, channel: "email", reason: 1 },
    { lead_id: 42, channel: " EMAIL ", reason: 2 },
    { lead_id: 43, channel: "sms", reason: 1 },
    { lead_id: 44, channel: "email", reason: 1 },
    { channel: "email", reason: 1 },
  ];
  const contacts = new Map([
    ["42", contact()],
    ["43", contact({ id: 43 })],
    ["44", contact({ id: 44, fields: { core: { email: { value: null } } } })],
  ]);

  assert.equal(isEmailDncRow(rows[0]), true);
  assert.equal(isEmailDncRow(rows[2]), false);
  assert.equal(isEmailDncRow(rows[4]), false);
  assert.deepEqual(joinDncRowsWithEmails(rows, contacts), [
    {
      row: rows[0],
      contact: contacts.get("42"),
      leadId: "42",
      email: "person@example.com",
    },
  ]);
});

test("opt-out payload matches the public Subscription Change event", () => {
  const payload = buildOptOutPayload(" Person@Example.com ", "group-id");
  assert.deepEqual(payload, {
    messageId: payload.messageId,
    userId: deriveUserId("person@example.com"),
    event: "DFSubscriptionChange",
    properties: {
      subscriptionId: "group-id",
      action: "Unsubscribe",
    },
  });
  assert.deepEqual(payload, buildOptOutPayload("person@example.com", "group-id"));
});

test("contact query uses Mautic where bracket parameters and no search operator", () => {
  const url = buildContactsPageUrl("https://mautic.example.test", 400);
  assert.equal(
    url.toString(),
    "https://mautic.example.test/api/contacts?limit=200&start=400&where%5B0%5D%5Bcol%5D=email&where%5B0%5D%5Bexpr%5D=isNotNull",
  );
  assert.equal(url.searchParams.has("search"), false);
});

test("retry decision and backoff cover 429, 5xx, network errors, and limits", () => {
  assert.equal(shouldRetry(429, 0), true);
  assert.equal(shouldRetry(500, 2), true);
  assert.equal(shouldRetry(null, 0), true);
  assert.equal(shouldRetry(400, 0), false);
  assert.equal(shouldRetry(503, 3), false);
  assert.equal(retryDelayMs(0, null, () => 0), 250);
  assert.equal(retryDelayMs(2, null, () => 0), 1000);
  assert.equal(retryDelayMs(0, "2", () => 0), 2000);
});

test("requestWithRetry retries stubbed 5xx/429 fetches and honors Retry-After", async () => {
  const responses = [
    new Response(null, { status: 503 }),
    new Response(null, { status: 429, headers: { "retry-after": "1" } }),
    new Response(null, { status: 204 }),
  ];
  const delays = [];
  let calls = 0;
  const response = await requestWithRetry(
    "https://example.test/resource",
    {},
    {
      fetchImpl: async () => responses[calls++],
      sleep: async (delay) => delays.push(delay),
      random: () => 0,
      failureTracker: new FailureTracker(),
    },
  );

  assert.equal(response.status, 204);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 1000]);
});

test("requestWithRetry does not retry a stubbed non-retryable response", async () => {
  let calls = 0;
  await assert.rejects(
    requestWithRetry(
      "https://example.test/resource",
      {},
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 400 });
        },
        sleep: async () => assert.fail("sleep should not be called"),
      },
    ),
    (error) => error.status === 400,
  );
  assert.equal(calls, 1);
});

test("failure tracker aborts at 25 consecutive failures and resets on success", () => {
  const tracker = new FailureTracker(25);
  for (let index = 0; index < 24; index += 1) tracker.failure();
  tracker.success();
  for (let index = 0; index < 24; index += 1) tracker.failure();
  assert.throws(() => tracker.failure(), { code: "CONSECUTIVE_FAILURE_LIMIT" });
});

test("execute flow uses Basic Mautic auth and the exact Amie public calls", async () => {
  const requests = [];
  const sourceContact = contact();
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url: url.toString(), options, body });

    if (url.pathname === "/api/contacts" && options.method === "GET") {
      return Response.json({ total: 1, contacts: { 42: sourceContact } });
    }
    if (
      url.pathname === "/api/stats/lead_donotcontact" &&
      options.method === "GET"
    ) {
      return Response.json({
        total: 1,
        stats: [{ lead_id: 42, channel: "email", reason: 1 }],
      });
    }
    if (url.pathname === "/api/contacts/42" && options.method === "GET") {
      return Response.json({ contact: sourceContact });
    }
    if (url.hostname === "send.example.test" && options.method === "POST") {
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  };

  const summary = await runMigration({
    flags: { execute: true, onlySuppression: false },
    env: {
      MAUTIC_BASE_URL: "https://mautic.example.test",
      MAUTIC_API_USERNAME: "api-user",
      MAUTIC_API_PASSWORD: "api-password",
      AMIE_SEND_BASE_URL: "https://send.example.test",
      AMIE_SEND_WRITE_KEY: "Basic public-write-key",
      AMIE_SEND_EMAIL_SUBSCRIPTION_GROUP_ID: "email-group",
    },
    fetchImpl,
    sleep: async () => {},
    random: () => 0,
    log: () => {},
    logError: () => {},
  });

  assert.equal(summary.status, "ok");
  assert.equal(summary.identifySucceeded, 2);
  assert.equal(summary.optOutSucceeded, 1);
  const mauticRequests = requests.filter(
    ({ url }) => new URL(url).hostname === "mautic.example.test",
  );
  assert.ok(
    mauticRequests.every(
      ({ options }) =>
        options.headers.authorization ===
        `Basic ${Buffer.from("api-user:api-password").toString("base64")}`,
    ),
  );
  const publicRequests = requests.filter(
    ({ url }) => new URL(url).hostname === "send.example.test",
  );
  assert.deepEqual(
    publicRequests.map(({ url }) => new URL(url).pathname),
    [
      "/api/public/apps/identify",
      "/api/public/apps/identify",
      "/api/public/apps/track",
    ],
  );
  assert.ok(
    publicRequests.every(
      ({ options }) => options.headers.authorization === "Basic public-write-key",
    ),
  );
  assert.deepEqual(publicRequests[2].body, {
    messageId: publicRequests[2].body.messageId,
    userId: deriveUserId("person@example.com"),
    event: "DFSubscriptionChange",
    properties: { subscriptionId: "email-group", action: "Unsubscribe" },
  });
});
