import { timingSafeEqual } from "node:crypto";

import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { SubscriptionMessageMetadata } from "isomorphic-lib/src/subscriptionMessageMetadata";

import { generateSecureHash } from "./crypto";

/** Pick only analytics metadata. Never accept identity or subscription changes here. */
export function subscriptionMessageMetadata(
  value: unknown,
): SubscriptionMessageMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const picked = Object.fromEntries(
    Object.keys(SubscriptionMessageMetadata.properties).flatMap((key) => {
      const field: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
      return typeof field === "string" && field ? [[key, field]] : [];
    }),
  );
  const result = schemaValidate(picked, SubscriptionMessageMetadata);
  return result.isOk() ? result.value : undefined;
}

export function signSubscriptionAttribution(
  metadata: SubscriptionMessageMetadata,
  hash: string,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(metadata)).toString("base64url");
  const signature = generateSecureHash({
    key: secret,
    value: ["subscription-message-v1", hash, payload],
  });
  return `${payload}.${signature}`;
}

/** Invalid/removed attribution must never prevent a valid identity from opting out. */
export function verifySubscriptionAttribution(
  token: string | undefined,
  hash: string,
  secret: string,
): SubscriptionMessageMetadata | undefined {
  if (!token || token.length > 8192) return undefined;
  const parts = token.split(".");
  const [payload, signature] = parts;
  if (
    parts.length !== 2 ||
    !payload ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return undefined;
  const expected = generateSecureHash({
    key: secret,
    value: ["subscription-message-v1", hash, payload],
  });
  if (
    !timingSafeEqual(
      new Uint8Array(Buffer.from(signature)),
      new Uint8Array(Buffer.from(expected)),
    )
  )
    return undefined;
  try {
    const result = schemaValidate(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      SubscriptionMessageMetadata,
    );
    return result.isOk() ? result.value : undefined;
  } catch {
    return undefined;
  }
}
