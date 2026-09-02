#!/usr/bin/env node

/* global globalThis */
/* eslint-disable max-classes-per-file, no-await-in-loop, no-bitwise, no-console, no-param-reassign, no-promise-executor-return */
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-use-before-define, @typescript-eslint/prefer-optional-chain */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const AMIE_MAUTIC_EMAIL_NAMESPACE =
  "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

const CONTACT_PAGE_SIZE = 200;
const PAGE_DELAY_MS = 100;
const MAX_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 25;
const RETRY_BASE_DELAY_MS = 250;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_ORDER = ["hot", "warm", "cool", "cold"];

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function uuidToBytes(uuid) {
  const compact = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) {
    throw new TypeError(`Invalid UUID namespace: ${uuid}`);
  }
  return Buffer.from(compact, "hex");
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function uuidV5(name, namespace = AMIE_MAUTIC_EMAIL_NAMESPACE) {
  const digest = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(Buffer.from(String(name), "utf8"))
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return bytesToUuid(digest.subarray(0, 16));
}

export function deriveUserId(email) {
  const normalized = normalizeEmail(email);
  if (!normalized)
    throw new TypeError("Cannot derive a userId without an email");
  return uuidV5(normalized);
}

function fieldValue(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "value" in value
  ) {
    return value.value;
  }
  return value;
}

function coreField(contact, name) {
  return fieldValue(contact?.fields?.core?.[name]);
}

function allField(contact, name) {
  return fieldValue(contact?.fields?.all?.[name]);
}

export function normalizeIsoTimestamp(value) {
  const unwrapped = fieldValue(value);
  if (unwrapped === undefined || unwrapped === null || unwrapped === "") {
    return null;
  }

  let milliseconds;
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) {
    milliseconds = unwrapped < 1e12 ? unwrapped * 1000 : unwrapped;
  } else {
    let text = String(unwrapped).trim();
    if (!text) return null;
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
    } else {
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
        text = `${text.replace(" ", "T")}Z`;
      }
      milliseconds = Date.parse(text);
    }
  }

  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

function collectEmailEngagementTimestamps(value, path = [], output = []) {
  if (!value || typeof value !== "object") return output;

  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    const normalizedPath = nextPath.join(".").toLowerCase();
    const isEmailEngagementPath =
      normalizedPath.includes("email") &&
      /(open|click|read|engag)/.test(normalizedPath);

    if (isEmailEngagementPath) {
      const timestamp = normalizeIsoTimestamp(child);
      if (timestamp) output.push(timestamp);
    }
    if (child && typeof child === "object") {
      collectEmailEngagementTimestamps(child, nextPath, output);
    }
  }
  return output;
}

export function extractEmailEngagementTimestamps(contact) {
  return [...new Set(collectEmailEngagementTimestamps(contact))].sort();
}

export function resolveMauticLastActiveAt(contact) {
  const candidates = [
    contact?.lastActive,
    coreField(contact, "last_active"),
    allField(contact, "last_active"),
    contact?.dateModified,
    contact?.dateAdded,
    ...extractEmailEngagementTimestamps(contact),
  ]
    .map(normalizeIsoTimestamp)
    .filter(Boolean);

  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) =>
    Date.parse(candidate) > Date.parse(latest) ? candidate : latest,
  );
}

export function engagementTier(lastActiveAt, now = new Date()) {
  const timestamp = normalizeIsoTimestamp(lastActiveAt);
  if (!timestamp) return "cold";
  const nowMilliseconds = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMilliseconds)) {
    throw new TypeError("now must be a valid date");
  }
  const ageDays = Math.max(0, nowMilliseconds - Date.parse(timestamp)) / DAY_MS;
  if (ageDays <= 30) return "hot";
  if (ageDays <= 90) return "warm";
  if (ageDays <= 180) return "cool";
  return "cold";
}

function numericPoints(value) {
  const points = Number(value);
  return Number.isFinite(points) ? points : 0;
}

export function contactToEngagementTraits(contact, now = new Date()) {
  const email = normalizeEmail(
    coreField(contact, "email") ?? allField(contact, "email"),
  );
  if (!email) return null;
  const mauticLastActiveAt = resolveMauticLastActiveAt(contact);
  return {
    mauticLastActiveAt,
    mauticPoints: numericPoints(contact?.points),
    mauticEngagementTier: engagementTier(mauticLastActiveAt, now),
  };
}

function stableTraitsString(traits) {
  return JSON.stringify({
    mauticLastActiveAt: traits.mauticLastActiveAt,
    mauticPoints: traits.mauticPoints,
    mauticEngagementTier: traits.mauticEngagementTier,
  });
}

export function contactToIdentifyPayload(contact, now = new Date()) {
  const email = normalizeEmail(
    coreField(contact, "email") ?? allField(contact, "email"),
  );
  const traits = contactToEngagementTraits(contact, now);
  if (!email || !traits) return null;
  const userId = deriveUserId(email);
  return {
    messageId: uuidV5(
      `mautic-engagement:${userId}:${stableTraitsString(traits)}`,
    ),
    userId,
    traits,
  };
}

export function buildContactsPageUrl(baseUrl, start) {
  const url = joinBaseUrl(baseUrl, "api/contacts");
  url.searchParams.set("limit", String(CONTACT_PAGE_SIZE));
  url.searchParams.set("start", String(start));
  url.searchParams.set("where[0][col]", "email");
  url.searchParams.set("where[0][expr]", "isNotNull");
  return url;
}

export function shouldRetry(status, retryCount, maxRetries = MAX_RETRIES) {
  return (
    retryCount < maxRetries &&
    (status === null || status === 429 || (status >= 500 && status <= 599))
  );
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export function retryDelayMs(
  retryCount,
  retryAfter = null,
  random = Math.random,
) {
  const serverDelay = parseRetryAfter(retryAfter);
  if (serverDelay !== null) return serverDelay;
  const base = RETRY_BASE_DELAY_MS * 2 ** retryCount;
  return Math.round(base + base * 0.25 * random());
}

export class ConsecutiveFailureError extends Error {
  constructor(limit) {
    super(`Aborting after ${limit} consecutive request failures`);
    this.name = "ConsecutiveFailureError";
    this.code = "CONSECUTIVE_FAILURE_LIMIT";
  }
}

export class FailureTracker {
  constructor(limit = MAX_CONSECUTIVE_FAILURES) {
    this.limit = limit;
    this.consecutive = 0;
  }

  success() {
    this.consecutive = 0;
  }

  failure() {
    this.consecutive += 1;
    if (this.consecutive >= this.limit) {
      throw new ConsecutiveFailureError(this.limit);
    }
  }
}

export class HttpError extends Error {
  constructor(status, operation) {
    super(`${operation} failed with HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.operation = operation;
    this.code = "HTTP_ERROR";
  }
}

const defaultSleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export async function requestWithRetry(
  url,
  options = {},
  {
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    random = Math.random,
    maxRetries = MAX_RETRIES,
    failureTracker = new FailureTracker(),
    operation = "request",
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }

  let retryCount = 0;
  for (;;) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      failureTracker.failure();
      if (!shouldRetry(null, retryCount, maxRetries)) throw error;
      await sleep(retryDelayMs(retryCount, null, random));
      retryCount += 1;
      continue;
    }

    if (response.ok) {
      failureTracker.success();
      return response;
    }

    failureTracker.failure();
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup must not change retry behavior.
    }
    if (!shouldRetry(response.status, retryCount, maxRetries)) {
      throw new HttpError(response.status, operation);
    }
    const retryAfter = response.headers?.get?.("retry-after") ?? null;
    await sleep(retryDelayMs(retryCount, retryAfter, random));
    retryCount += 1;
  }
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

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function numericTotal(payload, fallback) {
  const total = Number(payload?.total);
  return Number.isFinite(total) && total >= 0 ? total : fallback;
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

function mauticHeaders(username, password) {
  return {
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

function amieHeaders(writeKey) {
  return {
    accept: "application/json",
    authorization: writeKey,
    "content-type": "application/json",
  };
}

async function getJson(url, headers, requestOptions, operation) {
  const response = await requestWithRetry(
    url,
    { method: "GET", headers },
    { ...requestOptions, operation },
  );
  return responseJson(response, operation);
}

async function postJson(url, headers, body, requestOptions, operation) {
  await requestWithRetry(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    { ...requestOptions, operation },
  );
}

export async function mapConcurrent(items, concurrency, mapper) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function fetchContacts(config, requestOptions, sample, log) {
  const contacts = [];
  let start = 0;
  let total = Infinity;
  let nextProgress = 1000;

  while (start < total && (sample === null || contacts.length < sample)) {
    const payload = await getJson(
      buildContactsPageUrl(config.mauticBaseUrl, start),
      config.mauticHeaders,
      requestOptions,
      "fetch Mautic contacts page",
    );
    const page = values(payload?.contacts);
    total = numericTotal(payload, start + page.length);
    const remaining = sample === null ? page.length : sample - contacts.length;
    contacts.push(...page.slice(0, remaining));
    while (contacts.length >= nextProgress) {
      log(`Mautic contacts fetched: ${nextProgress}`);
      nextProgress += 1000;
    }
    start += CONTACT_PAGE_SIZE;
    if (page.length === 0 || start >= total) break;
    if (sample !== null && contacts.length >= sample) break;
    await requestOptions.sleep(PAGE_DELAY_MS);
  }
  return contacts;
}

function createTierDistribution() {
  return Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0]));
}

export function printTierDistribution(distribution, log = console.log) {
  log("Tier  | Count");
  log("------|------");
  for (const tier of TIER_ORDER) {
    log(`${tier.padEnd(5)} | ${distribution[tier] ?? 0}`);
  }
}

function errorCode(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string") return error.code;
    if (typeof error.name === "string") return error.name;
  }
  return "UNKNOWN_ERROR";
}

function createSummary(flags) {
  return {
    status: "ok",
    mode: flags.live ? "live" : "dry-run",
    sample: flags.sample,
    contactsFetched: 0,
    contactsEligible: 0,
    contactsSkippedNoEmail: 0,
    plannedIdentifies: 0,
    identifySucceeded: 0,
    identifyFailures: 0,
    tierDistribution: createTierDistribution(),
  };
}

async function writeIdentify(
  payload,
  config,
  requestOptions,
  summary,
  logError,
) {
  try {
    await postJson(
      config.identifyUrl,
      config.amieHeaders,
      payload,
      requestOptions,
      "Amie Send engagement identify",
    );
    summary.identifySucceeded += 1;
  } catch (error) {
    if (error instanceof ConsecutiveFailureError) throw error;
    summary.identifyFailures += 1;
    logError(`One Amie Send identify failed (${errorCode(error)})`);
  }
}

export function parseFlags(argv) {
  let live = false;
  let explicitDryRun = false;
  let sample = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      live = true;
    } else if (argument === "--dry-run") {
      explicitDryRun = true;
    } else if (argument === "--sample") {
      const value = argv[index + 1];
      if (!/^\d+$/.test(value ?? "") || Number(value) < 1) {
        throw new Error("--sample requires a positive integer");
      }
      sample = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown flag: ${argument}`);
    }
  }

  if (live && explicitDryRun) {
    throw new Error("Choose either --dry-run or --live, not both");
  }
  return { live, sample };
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`Missing required env: ${name}`);
  return value.trim();
}

export function loadConfig(env, flags) {
  const mauticBaseUrl = requiredEnv(env, "MAUTIC_BASE_URL");
  const mauticUsername = requiredEnv(env, "MAUTIC_API_USERNAME");
  const mauticPassword = requiredEnv(env, "MAUTIC_API_PASSWORD");
  const amieBaseUrl =
    env.AMIE_SEND_BASE_URL?.trim() || "https://email.tryamie.com";
  const writeKey = flags.live
    ? requiredEnv(env, "AMIE_SEND_WRITE_KEY")
    : env.AMIE_SEND_WRITE_KEY?.trim() || null;

  return {
    mauticBaseUrl,
    mauticHeaders: mauticHeaders(mauticUsername, mauticPassword),
    amieHeaders: writeKey ? amieHeaders(writeKey) : null,
    identifyUrl: joinBaseUrl(amieBaseUrl, "api/public/apps/identify"),
  };
}

export async function runBackfill({
  flags,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  now = new Date(),
  log = console.log,
  logError = console.error,
}) {
  const config = loadConfig(env, flags);
  const summary = createSummary(flags);
  const failureTracker = new FailureTracker();
  const requestOptions = { fetchImpl, sleep, random, failureTracker };
  const contacts = await fetchContacts(
    config,
    requestOptions,
    flags.sample,
    log,
  );
  summary.contactsFetched = contacts.length;

  const payloadsByUserId = new Map();
  for (const contact of contacts) {
    const payload = contactToIdentifyPayload(contact, now);
    if (!payload) {
      summary.contactsSkippedNoEmail += 1;
      continue;
    }
    payloadsByUserId.set(payload.userId, payload);
  }
  const payloads = [...payloadsByUserId.values()];
  summary.contactsEligible = payloads.length;
  summary.plannedIdentifies = payloads.length;
  for (const payload of payloads) {
    summary.tierDistribution[payload.traits.mauticEngagementTier] += 1;
  }

  if (flags.live) {
    await mapConcurrent(payloads, MAX_CONCURRENCY, (payload) =>
      writeIdentify(payload, config, requestOptions, summary, logError),
    );
  } else {
    for (const payload of payloads.slice(0, 3)) {
      log(`##SAMPLE ${JSON.stringify(payload)}`);
    }
  }

  printTierDistribution(summary.tierDistribution, log);
  if (summary.identifyFailures > 0) summary.status = "completed-with-errors";
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  let flags = { live: false, sample: null };
  let summary;
  try {
    flags = parseFlags(argv);
    summary = await runBackfill({ flags });
    if (summary.status !== "ok") process.exitCode = 1;
  } catch (error) {
    process.exitCode = 1;
    summary = createSummary(flags);
    summary.status = "failed";
    summary.error = errorCode(error);
    console.error(`Engagement backfill failed (${summary.error})`);
  }
  console.log(`##ENGAGEMENT_BACKFILL ${JSON.stringify(summary)}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
