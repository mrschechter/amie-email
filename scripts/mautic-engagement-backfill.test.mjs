/* global Response */
/* eslint-disable import/extensions */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AMIE_MAUTIC_EMAIL_NAMESPACE,
  aggregateEmailStats,
  aggregatePageHits,
  buildContactsPageUrl,
  buildStatsPageUrl,
  contactToEngagementTraits,
  contactToIdentifyPayload,
  deriveUserId,
  engagementTier,
  extractEmailEngagementTimestamps,
  normalizeIsoTimestamp,
  parseFlags,
  resolveMauticLastActiveAt,
  runBackfill,
  uuidV5,
} from "./mautic-engagement-backfill.mjs";

function engagementStats() {
  const aggregates = aggregateEmailStats([
    {
      lead_id: "42",
      date_sent: "2025-01-01 00:00:00",
      is_read: "0",
      open_count: "0",
    },
    {
      lead_id: "42",
      date_sent: "2025-03-02 00:00:00",
      is_read: "1",
      open_count: "2",
      last_opened: "2025-03-10 00:00:00",
      date_read: "2025-03-09 00:00:00",
    },
  ]);
  return aggregatePageHits(
    [
      {
        lead_id: 42,
        email_id: "9",
        date_hit: "2025-03-15 00:00:00",
      },
      {
        lead_id: "42",
        email_id: null,
        date_hit: "2025-03-20 00:00:00",
      },
    ],
    aggregates,
  );
}

function contact(overrides = {}) {
  return {
    id: 42,
    points: "12",
    dateAdded: "2025-01-01 00:00:00",
    dateModified: "2025-03-01T00:00:00+00:00",
    lastActive: "2025-02-01T00:00:00+00:00",
    fields: {
      core: {
        email: { value: " Person@Example.COM " },
        last_active: { value: "2025-02-15 00:00:00" },
      },
      all: {
        email: " Person@Example.COM ",
        last_active: "2025-02-15 00:00:00",
      },
    },
    emailStats: { lastClickedAt: "2025-03-05T00:00:00Z" },
    ...overrides,
  };
}

test("uses the migration namespace and normalized email for deterministic IDs", () => {
  const userId = deriveUserId(" Person@Example.COM ");
  assert.equal(userId, deriveUserId("person@example.com"));
  assert.equal(
    userId,
    uuidV5("person@example.com", AMIE_MAUTIC_EMAIL_NAMESPACE),
  );
});

test("normalizes Mautic timestamps and uses all cheap activity signals", () => {
  assert.equal(
    normalizeIsoTimestamp("2025-02-15 00:00:00"),
    "2025-02-15T00:00:00.000Z",
  );
  assert.deepEqual(extractEmailEngagementTimestamps(contact()), [
    "2025-03-05T00:00:00.000Z",
  ]);
  assert.equal(
    resolveMauticLastActiveAt(contact()),
    "2025-03-05T00:00:00.000Z",
  );
});

test("aggregates sent, opened, and email-linked click stats by lead id", () => {
  assert.deepEqual(engagementStats().get("42"), {
    mauticLastSentAt: "2025-03-02T00:00:00.000Z",
    mauticSentCount: 2,
    mauticLastOpenedAt: "2025-03-10T00:00:00.000Z",
    mauticOpenCount: 2,
    mauticLastClickedAt: "2025-03-15T00:00:00.000Z",
    mauticClickCount: 1,
  });

  const fallback = aggregateEmailStats([
    {
      lead_id: 7,
      date_sent: "2025-02-01 00:00:00",
      is_read: "1",
      open_count: "1",
    },
  ]);
  assert.equal(
    fallback.get("7").mauticLastOpenedAt,
    "2025-02-01T00:00:00.000Z",
  );
});

test("tiers use the latest open or click and include their boundary day", () => {
  const now = new Date("2025-07-01T00:00:00Z");
  assert.equal(engagementTier("2025-06-01T00:00:00Z", null, now), "hot");
  assert.equal(engagementTier(null, "2025-04-02T00:00:00Z", now), "warm");
  assert.equal(
    engagementTier("2025-01-02T00:00:00Z", "2024-01-01", now),
    "cool",
  );
  assert.equal(engagementTier("2025-01-01T00:00:00Z", null, now), "cold");
  assert.equal(engagementTier(null, null, now), "cold");
  assert.equal(engagementTier("not-a-date", null, now), "cold");
});

test("maps only engagement traits and creates an idempotent identify", () => {
  const now = new Date("2025-04-01T00:00:00Z");
  const stats = engagementStats();
  const traits = contactToEngagementTraits(contact(), stats, now);
  assert.deepEqual(traits, {
    mauticLastSentAt: "2025-03-02T00:00:00.000Z",
    mauticSentCount: 2,
    mauticLastOpenedAt: "2025-03-10T00:00:00.000Z",
    mauticOpenCount: 2,
    mauticLastClickedAt: "2025-03-15T00:00:00.000Z",
    mauticClickCount: 1,
    mauticLastActiveAt: "2025-03-05T00:00:00.000Z",
    mauticPoints: 12,
    mauticEngagementTier: "hot",
  });
  const payload = contactToIdentifyPayload(contact(), stats, now);
  assert.deepEqual(payload, contactToIdentifyPayload(contact(), stats, now));
  assert.deepEqual(Object.keys(payload.traits), [
    "mauticLastSentAt",
    "mauticSentCount",
    "mauticLastOpenedAt",
    "mauticOpenCount",
    "mauticLastClickedAt",
    "mauticClickCount",
    "mauticLastActiveAt",
    "mauticPoints",
    "mauticEngagementTier",
  ]);
});

test("contact page URL and flags match the work brief", () => {
  assert.equal(
    buildContactsPageUrl("https://mautic.example.test", 200).toString(),
    "https://mautic.example.test/api/contacts?limit=200&start=200&where%5B0%5D%5Bcol%5D=email&where%5B0%5D%5Bexpr%5D=isNotNull",
  );
  assert.equal(
    buildStatsPageUrl(
      "https://mautic.example.test",
      "email_stats",
      500,
    ).toString(),
    "https://mautic.example.test/api/stats/email_stats?limit=500&start=500",
  );
  assert.deepEqual(parseFlags([]), { live: false, sample: null });
  assert.deepEqual(parseFlags(["--sample", "400", "--dry-run"]), {
    live: false,
    sample: 400,
  });
  assert.deepEqual(parseFlags(["--live"]), { live: true, sample: null });
  assert.throws(() => parseFlags(["--sample", "0"]), /positive integer/);
  assert.throws(() => parseFlags(["--dry-run", "--live"]), /either/);
});

test("dry-run samples without writes and prints the full tier distribution", async () => {
  const requests = [];
  const logs = [];
  const fetchImpl = async (input, options) => {
    requests.push({ input: String(input), options });
    const url = new URL(input);
    if (url.pathname === "/api/stats/email_stats") {
      return Response.json({
        total: "2",
        stats: [
          {
            lead_id: "42",
            date_sent: "2025-03-02 00:00:00",
            is_read: "1",
            open_count: "2",
          },
          {
            lead_id: "43",
            date_sent: "2024-01-01 00:00:00",
            is_read: "0",
            open_count: "0",
          },
        ],
      });
    }
    if (url.pathname === "/api/stats/page_hits") {
      return Response.json({
        total: "1",
        page_hits: [
          {
            lead_id: "43",
            email_id: "8",
            date_hit: "2025-01-01 00:00:00",
          },
        ],
      });
    }
    return Response.json({
      total: 2,
      contacts: {
        42: contact(),
        43: contact({
          id: 43,
          fields: {
            core: { email: { value: "second@example.com" } },
            all: { email: "second@example.com" },
          },
        }),
      },
    });
  };

  const summary = await runBackfill({
    flags: { live: false, sample: 1 },
    env: {
      MAUTIC_BASE_URL: "https://mautic.example.test",
      MAUTIC_API_USERNAME: "user",
      MAUTIC_API_PASSWORD: "password",
    },
    fetchImpl,
    sleep: async () => {},
    now: new Date("2025-04-01T00:00:00Z"),
    log: (message) => logs.push(message),
  });

  assert.equal(requests.length, 3);
  assert.equal(
    requests[0].options.headers.authorization,
    "Basic dXNlcjpwYXNzd29yZA==",
  );
  assert.equal(summary.contactsFetched, 1);
  assert.equal(summary.emailStatsRowsFetched, 2);
  assert.equal(summary.pageHitsRowsFetched, 1);
  assert.equal(summary.plannedIdentifies, 1);
  assert.equal(summary.tierDistribution.hot, 1);
  assert.ok(logs.some((line) => line === "Tier  | Count"));
  assert.ok(logs.includes("Mautic email_stats rows fetched: 2"));
  assert.ok(logs.includes("Mautic page_hits rows fetched: 1"));
  assert.ok(logs.some((line) => line.startsWith("##SAMPLE ")));
});

test("live mode posts engagement identifies to the public identify endpoint", async () => {
  const requests = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.hostname === "mautic.example.test") {
      if (url.pathname === "/api/stats/email_stats") {
        return Response.json({
          total: "1",
          stats: [
            {
              lead_id: "42",
              date_sent: "2025-03-02 00:00:00",
              is_read: "1",
              open_count: "1",
            },
          ],
        });
      }
      if (url.pathname === "/api/stats/page_hits") {
        return Response.json({ total: "0", page_hits: [] });
      }
      return Response.json({ total: 1, contacts: { 42: contact() } });
    }
    return new Response(null, { status: 204 });
  };

  const summary = await runBackfill({
    flags: { live: true, sample: null },
    env: {
      MAUTIC_BASE_URL: "https://mautic.example.test",
      MAUTIC_API_USERNAME: "user",
      MAUTIC_API_PASSWORD: "password",
      AMIE_SEND_BASE_URL: "https://send.example.test",
      AMIE_SEND_WRITE_KEY: "Basic write-key",
    },
    fetchImpl,
    sleep: async () => {},
    now: new Date("2025-04-01T00:00:00Z"),
    log: () => {},
    logError: () => {},
  });

  assert.equal(summary.identifySucceeded, 1);
  const write = requests.find(
    ({ url }) => url.hostname === "send.example.test",
  );
  assert.equal(write.url.pathname, "/api/public/apps/identify");
  assert.equal(write.options.headers.authorization, "Basic write-key");
  assert.equal(
    JSON.parse(write.options.body).userId,
    deriveUserId("person@example.com"),
  );
});
