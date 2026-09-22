/* eslint-disable no-await-in-loop -- Keep memory bounded and serialize copy/delete per message. */
import {
  CopyObjectCommandInput,
  DeleteObjectCommandInput,
  GetObjectCommandInput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  S3,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { ChannelType, EmailProviderType } from "isomorphic-lib/src/types";
import addressparser from "nodemailer/lib/addressparser";
import { Readable } from "stream";

import config from "./config";
import { db } from "./db";
import * as schema from "./db/schema";
import logger from "./logger";
import { getEmailProvider } from "./messaging";
import { getMeter } from "./openTelemetry";
import { updateUserSubscriptions } from "./subscriptionGroups";
import { findUserIdsByUserPropertyValue } from "./userProperties";

const MAX_HEADER_BYTES = 64 * 1024;
const HEADER_NAMES = new Set([
  "to",
  "cc",
  "delivered-to",
  "x-original-to",
  "from",
  "return-path",
  "subject",
  "message-id",
  "auto-submitted",
]);

type Headers = Map<string, string[]>;
type Result =
  | "unsubscribed"
  | "user_not_found"
  | "not_unsubscribe"
  | "auto_submitted"
  | "error";

// A small injectable interface keeps tests independent of AWS and databases.
export interface InboundUnsubscribeS3 {
  listObjectsV2(
    input: ListObjectsV2CommandInput,
  ): Promise<
    Pick<
      ListObjectsV2CommandOutput,
      "Contents" | "IsTruncated" | "NextContinuationToken"
    >
  >;
  getObject(input: GetObjectCommandInput): Promise<{ Body?: unknown }>;
  copyObject(input: CopyObjectCommandInput): Promise<unknown>;
  deleteObject(input: DeleteObjectCommandInput): Promise<unknown>;
}

/** Consume only the top-level header block, closing the iterator at its end. */
export async function readInboundHeaders(
  body: AsyncIterable<unknown>,
): Promise<Headers> {
  const bytes = Buffer.alloc(MAX_HEADER_BYTES);
  let length = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) && typeof chunk !== "string") {
      throw new Error("Invalid inbound message stream");
    }
    const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    for (const byte of data) {
      if (length === MAX_HEADER_BYTES) {
        throw new Error("Inbound headers exceed 64 KB");
      }
      bytes[length] = byte;
      length += 1;
      if (
        byte === 10 &&
        (length === 1 ||
          (length === 2 && bytes[0] === 13) ||
          bytes[length - 2] === 10 ||
          (bytes[length - 2] === 13 && bytes[length - 3] === 10))
      ) {
        const headers: Headers = new Map();
        const lines = bytes
          .subarray(0, length)
          .toString("utf8")
          .replace(/\r?\n[ \t]+/g, " ")
          .split(/\r?\n/);
        for (const line of lines) {
          const colon = line.indexOf(":");
          if (colon < 1) continue;
          const name = line.slice(0, colon).toLowerCase();
          if (!HEADER_NAMES.has(name)) continue;
          const values = headers.get(name) ?? [];
          values.push(line.slice(colon + 1).trim());
          headers.set(name, values);
        }
        return headers;
      }
    }
    if (length === MAX_HEADER_BYTES) {
      throw new Error("Inbound headers exceed 64 KB");
    }
  }
  throw new Error("Incomplete inbound headers");
}

function addresses(headers: Headers, names: string[]): string[] {
  return names
    .flatMap((name) =>
      (headers.get(name) ?? []).flatMap((value) =>
        addressparser(value, { flatten: true }).map((address) =>
          address.address.toLowerCase(),
        ),
      ),
    )
    .filter((address) => /^[^\s@]+@[^\s@]+$/.test(address));
}

async function createInboundS3(workspaceId: string): Promise<S3> {
  const result = await getEmailProvider({
    workspaceId,
    providerOverride: EmailProviderType.AmazonSes,
  });
  if (result.isErr())
    throw new Error("Inbound unsubscribe SES provider unavailable");
  const provider = result.value;
  if (
    provider.type !== EmailProviderType.AmazonSes ||
    !provider.accessKeyId ||
    !provider.secretAccessKey ||
    !provider.region
  ) {
    throw new Error("Inbound unsubscribe SES provider is not configured");
  }
  return new S3({
    region: provider.region,
    credentials: {
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
    },
  });
}

async function emailGroups(workspaceId: string): Promise<{ id: string }[]> {
  return db().query.subscriptionGroup.findMany({
    where: and(
      eq(schema.subscriptionGroup.workspaceId, workspaceId),
      eq(schema.subscriptionGroup.channel, ChannelType.Email),
    ),
  });
}

export async function processInboundUnsubscribes({
  workspaceId,
  s3Impl,
  nowImpl = Date.now,
  limit = 200,
  lookupImpl = findUserIdsByUserPropertyValue,
  updateImpl = updateUserSubscriptions,
  emailGroupsImpl = emailGroups,
}: {
  workspaceId: string;
  s3Impl?: InboundUnsubscribeS3;
  nowImpl?: () => number;
  limit?: number;
  lookupImpl?: typeof findUserIdsByUserPropertyValue;
  updateImpl?: typeof updateUserSubscriptions;
  emailGroupsImpl?: typeof emailGroups;
}) {
  const counts = {
    scanned: 0,
    unsubscribed: 0,
    userNotFound: 0,
    other: 0,
    errors: 0,
  };
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error("Invalid inbound unsubscribe limit");
  if (limit === 0) return counts;
  const {
    unsubscribeInboundBucket: Bucket,
    unsubscribeInboundPrefix: Prefix,
    unsubscribeMailboxDomains,
  } = config();
  const domains = new Set(
    unsubscribeMailboxDomains.map((domain) => domain.toLowerCase()),
  );
  const counter = getMeter().createCounter("mailto_unsubscribe_processed");
  const record = (result: Result, messageId?: string, userId?: string) => {
    logger().info(
      {
        event: "mailto_unsubscribe",
        workspaceId,
        userId,
        messageId,
        result,
        processedAt: nowImpl(),
      },
      "Processed inbound unsubscribe message",
    );
    counter.add(1, { result });
  };
  let ownedClient: S3 | undefined;
  try {
    const s3 = s3Impl ?? (ownedClient = await createInboundS3(workspaceId));
    let continuationToken: string | undefined;
    do {
      const page = await s3.listObjectsV2({
        Bucket,
        Prefix,
        MaxKeys: Math.min(1000, limit - counts.scanned),
        ContinuationToken: continuationToken,
      });
      for (const object of page.Contents ?? []) {
        if (counts.scanned >= limit) break;
        counts.scanned += 1;
        const { Key } = object;
        let messageId = Key;
        let userId: string | undefined;
        try {
          if (!Key?.startsWith(Prefix))
            throw new Error("Invalid inbound object key");
          const { Body } = await s3.getObject({
            Bucket,
            Key,
            Range: `bytes=0-${MAX_HEADER_BYTES - 1}`,
          });
          if (!(Body instanceof Readable))
            throw new Error("Missing inbound message stream");
          let headers: Headers;
          try {
            headers = await readInboundHeaders(Body);
          } finally {
            Body.destroy();
          }
          messageId = headers.get("message-id")?.[0] ?? Key;
          let result: Result = "not_unsubscribe";
          const autoSubmitted = headers
            .get("auto-submitted")
            ?.some((value) => /^auto-/i.test(value));
          const isUnsubscribe = addresses(headers, [
            "to",
            "cc",
            "delivered-to",
            "x-original-to",
          ]).some((address) => {
            const [local, domain] = address.split("@");
            return (
              local === "unsubscribe" &&
              domain !== undefined &&
              domains.has(domain)
            );
          });
          if (autoSubmitted) {
            result = "auto_submitted";
          } else if (isUnsubscribe) {
            const sender =
              addresses(headers, ["from"])[0] ??
              addresses(headers, ["return-path"])[0];
            const userIds = sender
              ? await lookupImpl({
                  workspaceId,
                  userPropertyName: "email",
                  value: sender,
                  caseInsensitive: true,
                })
              : null;
            [userId] = userIds ?? [];
            if (userId) {
              const groups = await emailGroupsImpl(workspaceId);
              const changes = Object.fromEntries(
                groups.map((group) => [group.id, false]),
              );
              await updateImpl({
                workspaceId,
                userUpdates: [{ userId, changes }],
              });
              result = "unsubscribed";
            } else {
              result = "user_not_found";
            }
          }
          const destination =
            result === "unsubscribed" || result === "user_not_found"
              ? "processed"
              : "other";
          await s3.copyObject({
            Bucket,
            Key: `${destination}/${Key}`,
            CopySource: `${Bucket}/${Key.split("/").map(encodeURIComponent).join("/")}`,
          });
          await s3.deleteObject({ Bucket, Key });
          if (result === "unsubscribed") counts.unsubscribed += 1;
          else if (result === "user_not_found") counts.userNotFound += 1;
          else counts.other += 1;
          record(result, messageId, userId);
        } catch {
          // Do not log message contents or provider errors that could contain secrets.
          counts.errors += 1;
          record("error", messageId, userId);
        }
      }
      if (!page.IsTruncated || counts.scanned >= limit) break;
      if (
        !page.NextContinuationToken ||
        page.NextContinuationToken === continuationToken
      ) {
        throw new Error("Invalid inbound pagination token");
      }
      continuationToken = page.NextContinuationToken;
    } while (counts.scanned < limit);
  } catch {
    counts.errors += 1;
    record("error");
  } finally {
    ownedClient?.destroy();
  }
  return counts;
}

/** Called by the existing five-minute global cron activity in the worker. */
export async function processScheduledInboundUnsubscribes() {
  if (!config().unsubscribeMailtoProcessorEnabled) return;
  // Same default workspace selection as single-tenant requestContext.
  const workspace = await db().query.workspace.findFirst();
  if (!workspace)
    throw new Error("No default workspace for inbound unsubscribes");
  await processInboundUnsubscribes({ workspaceId: workspace.id });
}
