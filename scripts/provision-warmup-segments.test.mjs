/* global Response */
/* eslint-disable import/extensions */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWarmupSegments,
  loadConfig,
  parseFlags,
  runProvisioning,
} from "./provision-warmup-segments.mjs";

test("definitions use valid graph references and the exact requested predicates", () => {
  const segments = buildWarmupSegments();
  assert.deepEqual(
    segments.map(({ name }) => name),
    [
      "Warmup 1 — hottest",
      "Warmup 2 — hot",
      "Warmup 3 — warm+",
      "Warmup 4 — all engaged",
    ],
  );

  for (const { definition } of segments) {
    const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
    for (const node of [definition.entryNode, ...definition.nodes]) {
      if (node.type === "And" || node.type === "Or") {
        assert.ok(node.children.every((id) => nodesById.has(id)));
      }
    }
  }

  const hottest = segments[0].definition;
  assert.deepEqual(hottest.nodes, [
    {
      type: "Trait",
      id: "tier-hot",
      path: "mauticEngagementTier",
      operator: { type: "Equals", value: "hot" },
    },
    {
      type: "Or",
      id: "recent-order-or-active-subscription",
      children: ["recent-order", "active-subscription"],
    },
    {
      type: "Trait",
      id: "recent-order",
      path: "lastOrderAt",
      operator: { type: "Within", windowSeconds: 7_776_000 },
    },
    {
      type: "Trait",
      id: "active-subscription",
      path: "subscriptionStatus",
      operator: { type: "Equals", value: "active" },
    },
  ]);
});

test("dry-run is default, needs no environment, and prints definitions", async () => {
  assert.deepEqual(parseFlags([]), { live: false });
  assert.deepEqual(parseFlags(["--dry-run"]), { live: false });
  assert.deepEqual(parseFlags(["--live"]), { live: true });
  assert.throws(() => parseFlags(["--live", "--dry-run"]), /either/);
  assert.deepEqual(loadConfig({}, { live: false }), {
    baseUrl: null,
    workspaceId: null,
    sessionCookie: null,
    password: null,
  });

  const logs = [];
  const summary = await runProvisioning({
    flags: { live: false },
    env: {},
    fetchImpl: async () => assert.fail("dry-run must not fetch"),
    log: (message) => logs.push(message),
  });
  assert.equal(summary.mode, "dry-run");
  assert.equal(JSON.parse(logs[0]).length, 4);
});

test("live mode logs in with the dashboard session and updates by name", async () => {
  const requests = [];
  const existingId = "00000000-0000-4000-8000-000000000001";
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, options, body });
    if (url.pathname === "/api/public/single-tenant/login") {
      return new Response(null, {
        status: 200,
        headers: { "set-cookie": "session=opaque-value; Path=/; HttpOnly" },
      });
    }
    if (options.method === "GET") {
      return Response.json({
        segments: [{ id: existingId, name: "Warmup 1 — hottest" }],
      });
    }
    return Response.json({ id: body.id ?? `new-${requests.length}` });
  };

  const summary = await runProvisioning({
    flags: { live: true },
    env: {
      AMIE_SEND_BASE_URL: "https://send.example.test",
      AMIE_SEND_WORKSPACE_ID: "00000000-0000-4000-8000-000000000099",
      AMIE_SEND_PASSWORD: "dashboard-password",
    },
    fetchImpl,
    sleep: async () => {},
    log: () => {},
  });

  assert.equal(summary.created, 3);
  assert.equal(summary.updated, 1);
  assert.equal(requests.length, 6);
  assert.deepEqual(requests[0].body, { password: "dashboard-password" });
  assert.equal(requests[1].url.pathname, "/api/segments");
  assert.equal(requests[1].url.searchParams.get("resourceType"), "Declarative");
  assert.equal(requests[2].body.id, existingId);
  assert.ok(
    requests
      .slice(1)
      .every(
        ({ options }) => options.headers.cookie === "session=opaque-value",
      ),
  );
  assert.ok(
    requests
      .slice(1)
      .every(({ options }) => !("authorization" in options.headers)),
  );
});

test("an existing session cookie can be used without logging in", async () => {
  const requests = [];
  await runProvisioning({
    flags: { live: true },
    env: {
      AMIE_SEND_BASE_URL: "https://send.example.test",
      AMIE_SEND_WORKSPACE_ID: "00000000-0000-4000-8000-000000000099",
      AMIE_SEND_SESSION_COOKIE: "session=already-authenticated",
    },
    fetchImpl: async (input, options) => {
      requests.push({ url: new URL(input), options });
      if (options.method === "GET") return Response.json({ segments: [] });
      return Response.json({ id: "saved" });
    },
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ url }) => url.pathname === "/api/segments"));
});
