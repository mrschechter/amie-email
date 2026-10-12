import { generateSecureHash } from "./crypto";
import {
  signTemplatePreviewToken,
  verifyTemplatePreviewToken,
} from "./templatePreviewToken";

const ids = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  templateId: "22222222-2222-4222-8222-222222222222",
};
const secret = "test-only-subscription-secret";

it("round trips a versioned, scoped token", () => {
  expect(
    verifyTemplatePreviewToken(signTemplatePreviewToken(ids, secret), secret),
  ).toEqual({ ...ids, v: 1 });
});

it("rejects tampering, a different key, and missing keys", () => {
  const token = signTemplatePreviewToken(ids, secret);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Expected signed token");
  const changed = Buffer.from(
    JSON.stringify({ ...ids, templateId: ids.workspaceId, v: 1 }),
  ).toString("base64url");
  expect(
    verifyTemplatePreviewToken(`${changed}.${signature}`, secret),
  ).toBeUndefined();
  expect(
    verifyTemplatePreviewToken(`${payload}.${"0".repeat(64)}`, secret),
  ).toBeUndefined();
  expect(verifyTemplatePreviewToken(token, "another-key")).toBeUndefined();
  expect(verifyTemplatePreviewToken(token, "")).toBeUndefined();
  expect(() => signTemplatePreviewToken(ids, "")).toThrow();
});

it.each(["", "bad", "a.b.c", `e30=.${"0".repeat(64)}`])(
  "rejects malformed token %s",
  (token) => {
    expect(verifyTemplatePreviewToken(token, secret)).toBeUndefined();
  },
);

it.each([
  { ...ids, v: 2 },
  { ...ids, v: 1, userId: "recipient" },
  { ...ids, workspaceId: "invalid", v: 1 },
])("rejects invalid payloads even with a valid signature", (value) => {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = generateSecureHash({
    key: secret,
    value: ["template-web-preview-v1", payload],
  });
  expect(
    verifyTemplatePreviewToken(`${payload}.${signature}`, secret),
  ).toBeUndefined();
});

it("does not accept a signature from another public-link purpose", () => {
  const payload = Buffer.from(JSON.stringify({ ...ids, v: 1 })).toString(
    "base64url",
  );
  const signature = generateSecureHash({
    key: secret,
    value: ["subscription-message-v1", payload],
  });
  expect(
    verifyTemplatePreviewToken(`${payload}.${signature}`, secret),
  ).toBeUndefined();
});
