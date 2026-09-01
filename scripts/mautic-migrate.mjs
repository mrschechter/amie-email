#!/usr/bin/env node

import { createHash } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const AMIE_MAUTIC_EMAIL_NAMESPACE =
  "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

const CONTACT_PAGE_SIZE = 200;
const DNC_PAGE_SIZE = 500;
const PAGE_DELAY_MS = 100;
const MAX_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 25;
const RETRY_BASE_DELAY_MS = 250;
const SUBSCRIPTION_CHANGE_EVENT = "DFSubscriptionChange";
const UNSUBSCRIBE_ACTION = "Unsubscribe";

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
  if (!normalized) throw new TypeError("Cannot derive a userId without an email");
  return uuidV5(normalized);
}

function coreField(contact, name) {
  const value = contact?.fields?.core?.[name]?.value;
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function tagName(tag) {
  if (typeof tag === "string" || typeof tag === "number") {
    const value = String(tag).trim();
    return value || null;
  }
  if (!tag || typeof tag !== "object") return null;
  for (const key of ["tag", "name", "label"]) {
    if (tag[key] !== undefined && tag[key] !== null) {
      const value = String(tag[key]).trim();
      if (value) return value;
    }
  }
  return null;
}

export function contactToTraits(contact) {
  const email = normalizeEmail(coreField(contact, "email"));
  if (!email) return null;

  const tags = Array.isArray(contact?.tags)
    ? [...new Set(contact.tags.map(tagName).filter(Boolean))].sort()
    : [];

  return {
    email,
    firstName: coreField(contact, "firstname"),
    lastName: coreField(contact, "lastname"),
    mauticId:
      contact?.id === undefined || contact?.id === null
        ? null
        : String(contact.id),
    mauticTags: tags,
    createdAt: contact?.dateAdded ? String(contact.dateAdded) : null,
  };
}

function stableTraitsString(traits) {
  return JSON.stringify({
    email: traits.email,
    firstName: traits.firstName,
    lastName: traits.lastName,
    mauticId: traits.mauticId,
    mauticTags: traits.mauticTags,
    createdAt: traits.createdAt,
  });
}

export function contactToIdentifyPayload(contact) {
  const traits = contactToTraits(contact);
  if (!traits) return null;
  const userId = deriveUserId(traits.email);
  return {
    messageId: uuidV5(`identify:${userId}:${stableTraitsString(traits)}`),
    userId,
    traits,
  };
}

export function buildOptOutPayload(email, subscriptionGroupId) {
  const userId = deriveUserId(email);
  return {
    messageId: uuidV5(`unsubscribe:${userId}:${subscriptionGroupId}`),
    userId,
    event: SUBSCRIPTION_CHANGE_EVENT,
    properties: {
      subscriptionId: subscriptionGroupId,
      action: UNSUBSCRIBE_ACTION,
    },
  };
}

export function isEmailDncRow(row) {
  return (
    row &&
    String(row.channel ?? "").trim().toLowerCase() === "email" &&
    row.lead_id !== undefined &&
    row.lead_id !== null &&
    String(row.lead_id).trim() !== ""
  );
}

export function joinDncRowsWithEmails(rows, contactsById) {
  const joinedByEmail = new Map();
  for (const row of rows) {
    if (!isEmailDncRow(row)) continue;
    const leadId = String(row.lead_id);
    const contact = contactsById.get(leadId) ?? contactsById.get(row.lead_id);
    const traits = contactToTraits(contact);
    if (!traits || joinedByEmail.has(traits.email)) continue;
    joinedByEmail.set(traits.email, { row, contact, leadId, email: traits.email });
  }
  return [...joinedByEmail.values()];
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
      // A failed response body is not needed; retry behavior must not depend on cleanup.
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

export function buildContactsPageUrl(baseUrl, start) {
  const url = joinBaseUrl(baseUrl, "api/contacts");
  url.searchParams.set("limit", String(CONTACT_PAGE_SIZE));
  url.searchParams.set("start", String(start));
  url.searchParams.set("where[0][col]", "email");
  url.searchParams.set("where[0][expr]", "isNotNull");
  return url;
}

function buildDncPageUrl(baseUrl, start) {
  const url = joinBaseUrl(baseUrl, "api/stats/lead_donotcontact");
  url.searchParams.set("limit", String(DNC_PAGE_SIZE));
  url.searchParams.set("start", String(start));
  return url;
}

function buildContactUrl(baseUrl, id) {
  return joinBaseUrl(baseUrl, `api/contacts/${encodeURIComponent(id)}`);
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function extractRows(payload, preferredKeys) {
  for (const key of preferredKeys) {
    if (payload?.[key] !== undefined) return values(payload[key]);
  }
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

async function fetchAllContacts(config, requestOptions, log) {
  const contacts = [];
  let start = 0;
  let total = Infinity;
  let nextProgress = 1000;

  while (start < total) {
    const payload = await getJson(
      buildContactsPageUrl(config.mauticBaseUrl, start),
      config.mauticHeaders,
      requestOptions,
      "fetch Mautic contacts page",
    );
    const page = extractRows(payload, ["contacts"]);
    total = numericTotal(payload, start + page.length);
    contacts.push(...page);
    while (contacts.length >= nextProgress) {
      log(`Mautic contacts fetched: ${nextProgress}`);
      nextProgress += 1000;
    }
    start += CONTACT_PAGE_SIZE;
    if (page.length === 0 || start >= total) break;
    await requestOptions.sleep(PAGE_DELAY_MS);
  }
  return contacts;
}

async function fetchAllDncRows(config, requestOptions) {
  const rows = [];
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const payload = await getJson(
      buildDncPageUrl(config.mauticBaseUrl, start),
      config.mauticHeaders,
      requestOptions,
      "fetch Mautic suppression page",
    );
    const page = extractRows(payload, [
      "lead_donotcontact",
      "leadDoNotContact",
      "stats",
      "rows",
    ]);
    total = numericTotal(payload, start + page.length);
    rows.push(...page);
    start += DNC_PAGE_SIZE;
    if (page.length === 0 || start >= total) break;
    await requestOptions.sleep(PAGE_DELAY_MS);
  }
  return rows;
}

async function resolveDncContacts(
  rows,
  config,
  requestOptions,
  summary,
  logError,
) {
  const ids = [
    ...new Set(
      rows
        .filter(isEmailDncRow)
        .map((row) => String(row.lead_id)),
    ),
  ];
  const contactsById = new Map();

  await mapConcurrent(ids, MAX_CONCURRENCY, async (id) => {
    try {
      const payload = await getJson(
        buildContactUrl(config.mauticBaseUrl, id),
        config.mauticHeaders,
        requestOptions,
        "resolve Mautic suppression contact",
      );
      const contact = payload?.contact ?? payload;
      contactsById.set(id, contact);
      summary.dncContactsResolved += 1;
    } catch (error) {
      if (error instanceof ConsecutiveFailureError) throw error;
      summary.dncResolutionFailures += 1;
      logError(`Could not resolve one Mautic suppression contact (${errorCode(error)})`);
    }
  });

  return { contactsById, distinctLeadIds: ids.length };
}

function createSummary(flags) {
  return {
    status: "ok",
    mode: flags.execute ? "execute" : "dry-run",
    onlySuppression: flags.onlySuppression,
    contactsFetched: 0,
    contactsEligible: 0,
    contactsSkippedNoEmail: 0,
    dncRowsFetched: 0,
    emailDncRows: 0,
    dncDistinctLeadIds: 0,
    dncContactsResolved: 0,
    dncResolutionFailures: 0,
    dncEmails: 0,
    plannedIdentifies: 0,
    identifySucceeded: 0,
    identifyFailures: 0,
    plannedOptOuts: 0,
    optOutSucceeded: 0,
    optOutFailures: 0,
  };
}

function errorCode(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string") return error.code;
    if (typeof error.name === "string") return error.name;
  }
  return "UNKNOWN_ERROR";
}

function printSamples(samples, log) {
  for (const sample of samples.slice(0, 3)) {
    log(`##SAMPLE ${JSON.stringify(sample)}`);
  }
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
      "Amie Send identify",
    );
    summary.identifySucceeded += 1;
    return true;
  } catch (error) {
    if (error instanceof ConsecutiveFailureError) throw error;
    summary.identifyFailures += 1;
    logError(`One Amie Send identify failed (${errorCode(error)})`);
    return false;
  }
}

async function writeOptOut(
  payload,
  config,
  requestOptions,
  summary,
  logError,
) {
  try {
    await postJson(
      config.trackUrl,
      config.amieHeaders,
      payload,
      requestOptions,
      "Amie Send subscription opt-out",
    );
    summary.optOutSucceeded += 1;
    return true;
  } catch (error) {
    if (error instanceof ConsecutiveFailureError) throw error;
    summary.optOutFailures += 1;
    logError(`One Amie Send opt-out failed (${errorCode(error)})`);
    return false;
  }
}

export function parseFlags(argv) {
  const allowed = new Set(["--dry-run", "--execute", "--only-suppression"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length) {
    throw new Error(`Unknown flag: ${unknown[0]}`);
  }
  if (argv.includes("--dry-run") && argv.includes("--execute")) {
    throw new Error("Choose either --dry-run or --execute, not both");
  }
  return {
    execute: argv.includes("--execute"),
    onlySuppression: argv.includes("--only-suppression"),
  };
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
  const subscriptionGroupId = requiredEnv(
    env,
    "AMIE_SEND_EMAIL_SUBSCRIPTION_GROUP_ID",
  );
  const amieBaseUrl =
    env.AMIE_SEND_BASE_URL?.trim() || "https://email.tryamie.com";
  const writeKey = flags.execute
    ? requiredEnv(env, "AMIE_SEND_WRITE_KEY")
    : env.AMIE_SEND_WRITE_KEY?.trim() || null;

  return {
    mauticBaseUrl,
    subscriptionGroupId,
    mauticHeaders: mauticHeaders(mauticUsername, mauticPassword),
    amieHeaders: writeKey ? amieHeaders(writeKey) : null,
    identifyUrl: joinBaseUrl(amieBaseUrl, "api/public/apps/identify"),
    trackUrl: joinBaseUrl(amieBaseUrl, "api/public/apps/track"),
  };
}

export async function runMigration({
  flags,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  log = console.log,
  logError = console.error,
}) {
  const config = loadConfig(env, flags);
  const summary = createSummary(flags);
  const failureTracker = new FailureTracker();
  const requestOptions = { fetchImpl, sleep, random, failureTracker };
  const samples = [];

  if (!flags.onlySuppression) {
    const contacts = await fetchAllContacts(config, requestOptions, log);
    summary.contactsFetched = contacts.length;
    const identifyPayloadsByUserId = new Map();
    for (const contact of contacts) {
      const payload = contactToIdentifyPayload(contact);
      if (payload) identifyPayloadsByUserId.set(payload.userId, payload);
      else summary.contactsSkippedNoEmail += 1;
    }
    const identifyPayloads = [...identifyPayloadsByUserId.values()];
    summary.contactsEligible = identifyPayloads.length;
    summary.plannedIdentifies += identifyPayloads.length;
    samples.push(...identifyPayloads.slice(0, 3));

    if (flags.execute) {
      await mapConcurrent(identifyPayloads, MAX_CONCURRENCY, (payload) =>
        writeIdentify(payload, config, requestOptions, summary, logError),
      );
    }
  }

  const dncRows = await fetchAllDncRows(config, requestOptions);
  summary.dncRowsFetched = dncRows.length;
  summary.emailDncRows = dncRows.filter(isEmailDncRow).length;
  const { contactsById, distinctLeadIds } = await resolveDncContacts(
    dncRows,
    config,
    requestOptions,
    summary,
    logError,
  );
  summary.dncDistinctLeadIds = distinctLeadIds;
  const dncContacts = joinDncRowsWithEmails(dncRows, contactsById);
  summary.dncEmails = dncContacts.length;
  summary.plannedIdentifies += dncContacts.length;
  summary.plannedOptOuts = dncContacts.length;

  const suppressionPayloads = dncContacts.map(({ contact, email }) => ({
    identify: contactToIdentifyPayload(contact),
    optOut: buildOptOutPayload(email, config.subscriptionGroupId),
  }));
  if (samples.length < 3) {
    for (const payloads of suppressionPayloads) {
      if (samples.length < 3) samples.push(payloads.identify);
      if (samples.length < 3) samples.push(payloads.optOut);
      if (samples.length >= 3) break;
    }
  }

  if (flags.execute) {
    await mapConcurrent(suppressionPayloads, MAX_CONCURRENCY, async (payloads) => {
      const identified = await writeIdentify(
        payloads.identify,
        config,
        requestOptions,
        summary,
        logError,
      );
      if (!identified) {
        summary.optOutFailures += 1;
        return;
      }
      await writeOptOut(
        payloads.optOut,
        config,
        requestOptions,
        summary,
        logError,
      );
    });
  } else {
    printSamples(samples, log);
  }

  const failed =
    summary.dncResolutionFailures +
    summary.identifyFailures +
    summary.optOutFailures;
  if (failed > 0) summary.status = "completed-with-errors";
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  let flags = { execute: false, onlySuppression: false };
  let summary;
  try {
    flags = parseFlags(argv);
    summary = await runMigration({ flags });
    if (summary.status !== "ok") process.exitCode = 1;
  } catch (error) {
    process.exitCode = 1;
    summary = createSummary(flags);
    summary.status = "failed";
    summary.error = errorCode(error);
    console.error(`Migration failed (${summary.error})`);
  }
  console.log(`##MIGRATION ${JSON.stringify(summary)}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
