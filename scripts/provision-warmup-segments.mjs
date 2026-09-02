#!/usr/bin/env node

/* global globalThis */
/* eslint-disable no-await-in-loop, no-console, no-promise-executor-return */
/* eslint-disable @typescript-eslint/prefer-optional-chain */

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 250;
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

function equalsTrait(id, path, value) {
  return {
    type: "Trait",
    id,
    path,
    operator: { type: "Equals", value },
  };
}

function tierEquals(id, tier) {
  return equalsTrait(id, "mauticEngagementTier", tier);
}

export function buildWarmupSegments() {
  return [
    {
      name: "Warmup 1 — hottest",
      definition: {
        entryNode: {
          type: "And",
          id: "entry",
          children: ["tier-hot", "recent-order-or-active-subscription"],
        },
        nodes: [
          tierEquals("tier-hot", "hot"),
          {
            type: "Or",
            id: "recent-order-or-active-subscription",
            children: ["recent-order", "active-subscription"],
          },
          {
            type: "Trait",
            id: "recent-order",
            path: "lastOrderAt",
            operator: {
              type: "Within",
              windowSeconds: NINETY_DAYS_SECONDS,
            },
          },
          equalsTrait("active-subscription", "subscriptionStatus", "active"),
        ],
      },
    },
    {
      name: "Warmup 2 — hot",
      definition: {
        entryNode: tierEquals("entry", "hot"),
        nodes: [],
      },
    },
    {
      name: "Warmup 3 — warm+",
      definition: {
        entryNode: {
          type: "Or",
          id: "entry",
          children: ["tier-hot", "tier-warm"],
        },
        nodes: [tierEquals("tier-hot", "hot"), tierEquals("tier-warm", "warm")],
      },
    },
    {
      name: "Warmup 4 — all engaged",
      definition: {
        entryNode: {
          type: "Or",
          id: "entry",
          children: ["tier-hot", "tier-warm", "tier-cool"],
        },
        nodes: [
          tierEquals("tier-hot", "hot"),
          tierEquals("tier-warm", "warm"),
          tierEquals("tier-cool", "cool"),
        ],
      },
    },
  ];
}

export function parseFlags(argv) {
  const allowed = new Set(["--dry-run", "--live"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw new Error(`Unknown flag: ${unknown[0]}`);
  if (argv.includes("--dry-run") && argv.includes("--live")) {
    throw new Error("Choose either --dry-run or --live, not both");
  }
  return { live: argv.includes("--live") };
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`Missing required env: ${name}`);
  return value.trim();
}

export function loadConfig(env, flags) {
  if (!flags.live) {
    return {
      baseUrl: env.AMIE_SEND_BASE_URL?.trim() || null,
      workspaceId: env.AMIE_SEND_WORKSPACE_ID?.trim() || null,
      sessionCookie: null,
      password: null,
    };
  }

  const sessionCookie = env.AMIE_SEND_SESSION_COOKIE?.trim() || null;
  const password =
    env.AMIE_SEND_PASSWORD?.trim() || env.PASSWORD?.trim() || null;
  if (!sessionCookie && !password) {
    throw new Error(
      "Missing required env: AMIE_SEND_PASSWORD (or PASSWORD/AMIE_SEND_SESSION_COOKIE)",
    );
  }
  return {
    baseUrl: requiredEnv(env, "AMIE_SEND_BASE_URL"),
    workspaceId: requiredEnv(env, "AMIE_SEND_WORKSPACE_ID"),
    sessionCookie,
    password,
  };
}

function joinBaseUrl(baseUrl, path) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;
  base.pathname = `${basePath}${path.replace(/^\/+/, "")}`;
  base.search = "";
  base.hash = "";
  return base;
}

function retryDelayMs(retryCount, retryAfter, random) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const timestamp = Date.parse(retryAfter);
    if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  }
  const base = RETRY_BASE_DELAY_MS * 2 ** retryCount;
  return Math.round(base + base * 0.25 * random());
}

const defaultSleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export async function requestWithRetry(
  url,
  options,
  {
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    random = Math.random,
    operation = "request",
  } = {},
) {
  let retryCount = 0;
  for (;;) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      if (retryCount >= MAX_RETRIES) throw error;
      await sleep(retryDelayMs(retryCount, null, random));
      retryCount += 1;
      continue;
    }

    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || retryCount >= MAX_RETRIES) {
      const error = new Error(
        `${operation} failed with HTTP ${response.status}`,
      );
      error.code = "HTTP_ERROR";
      error.status = response.status;
      throw error;
    }
    const retryAfter = response.headers.get("retry-after");
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup must not change retry behavior.
    }
    await sleep(retryDelayMs(retryCount, retryAfter, random));
    retryCount += 1;
  }
}

async function responseJson(response, operation) {
  try {
    return await response.json();
  } catch {
    const error = new Error(`${operation} returned invalid JSON`);
    error.code = "INVALID_JSON";
    throw error;
  }
}

function cookieFromLoginResponse(response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const rawCookies =
    setCookies.length > 0
      ? setCookies
      : [response.headers.get("set-cookie")].filter(Boolean);
  const cookie = rawCookies
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    const error = new Error(
      "Single-tenant login did not return a session cookie",
    );
    error.code = "MISSING_SESSION_COOKIE";
    throw error;
  }
  return cookie;
}

async function login(config, requestOptions) {
  if (config.sessionCookie) return config.sessionCookie;
  const response = await requestWithRetry(
    joinBaseUrl(config.baseUrl, "api/public/single-tenant/login"),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: config.password }),
    },
    { ...requestOptions, operation: "single-tenant login" },
  );
  return cookieFromLoginResponse(response);
}

function apiHeaders(sessionCookie) {
  return {
    accept: "application/json",
    cookie: sessionCookie,
    "content-type": "application/json",
  };
}

async function fetchExistingSegments(config, sessionCookie, requestOptions) {
  const url = joinBaseUrl(config.baseUrl, "api/segments");
  url.searchParams.set("workspaceId", config.workspaceId);
  url.searchParams.set("resourceType", "Declarative");
  const response = await requestWithRetry(
    url,
    { method: "GET", headers: apiHeaders(sessionCookie) },
    { ...requestOptions, operation: "list Amie Send segments" },
  );
  const payload = await responseJson(response, "list Amie Send segments");
  if (!Array.isArray(payload?.segments)) {
    const error = new Error("Segment list response did not contain segments");
    error.code = "INVALID_SEGMENT_RESPONSE";
    throw error;
  }
  return payload.segments;
}

async function upsertSegment(
  segment,
  existing,
  config,
  sessionCookie,
  requestOptions,
) {
  const body = {
    ...(existing?.id ? { id: existing.id } : {}),
    workspaceId: config.workspaceId,
    name: segment.name,
    definition: segment.definition,
    resourceType: "Declarative",
  };
  const response = await requestWithRetry(
    joinBaseUrl(config.baseUrl, "api/segments"),
    {
      method: "PUT",
      headers: apiHeaders(sessionCookie),
      body: JSON.stringify(body),
    },
    { ...requestOptions, operation: `upsert segment ${segment.name}` },
  );
  return responseJson(response, `upsert segment ${segment.name}`);
}

export async function runProvisioning({
  flags,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  log = console.log,
}) {
  const config = loadConfig(env, flags);
  const segments = buildWarmupSegments();
  if (!flags.live) {
    log(JSON.stringify(segments, null, 2));
    return {
      status: "ok",
      mode: "dry-run",
      created: 0,
      updated: 0,
      definitions: segments,
    };
  }

  const requestOptions = { fetchImpl, sleep, random };
  const sessionCookie = await login(config, requestOptions);
  const existingSegments = await fetchExistingSegments(
    config,
    sessionCookie,
    requestOptions,
  );
  const existingByName = new Map(
    existingSegments.map((segment) => [segment.name, segment]),
  );
  let created = 0;
  let updated = 0;

  for (const segment of segments) {
    const existing = existingByName.get(segment.name);
    const saved = await upsertSegment(
      segment,
      existing,
      config,
      sessionCookie,
      requestOptions,
    );
    if (existing) updated += 1;
    else created += 1;
    log(`${existing ? "Updated" : "Created"} ${segment.name} (${saved.id})`);
  }

  return {
    status: "ok",
    mode: "live",
    created,
    updated,
    definitions: segments,
  };
}

function errorCode(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string") return error.code;
    if (typeof error.name === "string") return error.name;
  }
  return "UNKNOWN_ERROR";
}

export async function main(argv = process.argv.slice(2)) {
  let flags = { live: false };
  let summary;
  try {
    flags = parseFlags(argv);
    summary = await runProvisioning({ flags });
  } catch (error) {
    process.exitCode = 1;
    summary = {
      status: "failed",
      mode: flags.live ? "live" : "dry-run",
      error: errorCode(error),
    };
    console.error(`Warm-up segment provisioning failed (${summary.error})`);
  }
  console.log(`##WARMUP_SEGMENTS ${JSON.stringify(summary)}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
