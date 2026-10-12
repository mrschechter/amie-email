import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { validate } from "uuid";

import { generateSecureHash } from "./crypto";

const Payload = Type.Object(
  {
    workspaceId: Type.String(),
    templateId: Type.String(),
    v: Type.Literal(1),
  },
  { additionalProperties: false },
);

export function readTemplatePreviewToken(token: string) {
  const parts = token.split(".");
  const [payload, signature] = parts;
  if (
    parts.length !== 2 ||
    !payload ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const result = schemaValidate(parsed, Payload);
    return result.isOk() &&
      validate(result.value.workspaceId) &&
      validate(result.value.templateId)
      ? result.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function signTemplatePreviewToken(
  ids: { workspaceId: string; templateId: string },
  secret: string,
): string {
  if (!secret) throw new Error("Preview signing secret unavailable");
  const payload = Buffer.from(JSON.stringify({ ...ids, v: 1 })).toString(
    "base64url",
  );
  const signature = generateSecureHash({
    key: secret,
    value: ["template-web-preview-v1", payload],
  });
  return `${payload}.${signature}`;
}

export function verifyTemplatePreviewToken(token: string, secret: string) {
  if (!secret) return undefined;
  const decoded = readTemplatePreviewToken(token);
  if (!decoded) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = generateSecureHash({
    key: secret,
    value: ["template-web-preview-v1", payload],
  });
  return timingSafeEqual(
    new Uint8Array(Buffer.from(signature)),
    new Uint8Array(Buffer.from(expected)),
  )
    ? decoded
    : undefined;
}
