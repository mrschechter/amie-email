/* eslint-disable @typescript-eslint/unbound-method -- These methods are Jest mocks. */
/* eslint-disable @typescript-eslint/require-await -- Async generators model streaming input. */
import { S3 } from "@aws-sdk/client-s3";
import { EmailProviderType } from "isomorphic-lib/src/types";
import { ok } from "neverthrow";
import { Readable } from "stream";

import config from "./config";
import { db } from "./db";
import {
  InboundUnsubscribeS3,
  processInboundUnsubscribes,
  processScheduledInboundUnsubscribes,
  readInboundHeaders,
} from "./inboundUnsubscribe";
import logger from "./logger";
import { getEmailProvider } from "./messaging";
import { getMeter } from "./openTelemetry";

jest.mock("./config", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./db", () => ({
  db: jest.fn(() => ({
    query: {
      workspace: { findFirst: jest.fn() },
      subscriptionGroup: { findMany: jest.fn() },
    },
  })),
}));
jest.mock("./messaging", () => ({ getEmailProvider: jest.fn() }));
jest.mock("./subscriptionGroups", () => ({
  updateUserSubscriptions: jest.fn(),
}));
jest.mock("./userProperties", () => ({
  findUserIdsByUserPropertyValue: jest.fn(),
}));
jest.mock("./logger", () => ({
  __esModule: true,
  default: jest.fn(() => ({ info: jest.fn() })),
}));
jest.mock("./openTelemetry", () => ({
  getMeter: jest.fn(() => ({
    createCounter: jest.fn(() => ({ add: jest.fn() })),
  })),
}));
jest.mock("@aws-sdk/client-s3", () => ({
  S3: jest.fn(() => ({ destroy: jest.fn() })),
}));

const settings = {
  unsubscribeInboundBucket: "inbound-bucket",
  unsubscribeInboundPrefix: "inbound/",
  unsubscribeMailboxDomains: [
    "send.tryamie.com",
    "mail.tryamie.com",
    "em.tryamie.com",
  ],
  unsubscribeMailtoProcessorEnabled: false,
};
const log = logger();
const meter = getMeter();
const counter = meter.createCounter("test");
const database = db();
const info = jest.mocked(log.info);
const add = jest.mocked(counter.add);
const createCounter = jest.mocked(meter.createCounter);
const findWorkspace = jest.mocked(database.query.workspace.findFirst);

beforeEach(() => {
  jest.mocked(config).mockReturnValue({ ...config(), ...settings });
  jest.mocked(logger).mockReturnValue(log);
  jest.mocked(getMeter).mockReturnValue(meter);
  createCounter.mockReturnValue(counter);
  jest.mocked(db).mockReturnValue(database);
  jest.clearAllMocks();
});

function fixture(messages: Record<string, string>, failedCopy?: string) {
  const listObjectsV2 = jest
    .fn<
      ReturnType<InboundUnsubscribeS3["listObjectsV2"]>,
      Parameters<InboundUnsubscribeS3["listObjectsV2"]>
    >()
    .mockResolvedValue({
      Contents: Object.keys(messages).map((Key) => ({ Key })),
    });
  const streams: Readable[] = [];
  const getObject = jest
    .fn<
      ReturnType<InboundUnsubscribeS3["getObject"]>,
      Parameters<InboundUnsubscribeS3["getObject"]>
    >()
    .mockImplementation((input) => {
      const Body = Readable.from([
        Buffer.from(messages[input.Key ?? ""] ?? ""),
      ]);
      streams.push(Body);
      return Promise.resolve({ Body });
    });
  const copyObject = jest
    .fn<
      ReturnType<InboundUnsubscribeS3["copyObject"]>,
      Parameters<InboundUnsubscribeS3["copyObject"]>
    >()
    .mockImplementation((input) =>
      input.Key === failedCopy
        ? Promise.reject(new Error("Copy failed"))
        : Promise.resolve({}),
    );
  const deleteObject = jest.fn().mockResolvedValue({});
  const s3Impl = { listObjectsV2, getObject, copyObject, deleteObject };
  const lookupImpl = jest.fn().mockResolvedValue(["user-1"]);
  const updateImpl = jest.fn().mockResolvedValue(undefined);
  const emailGroupsImpl = jest
    .fn()
    .mockResolvedValue([{ id: "marketing" }, { id: "news" }]);
  return {
    params: {
      workspaceId: "workspace-1",
      s3Impl,
      lookupImpl,
      updateImpl,
      emailGroupsImpl,
      nowImpl: () => 123,
    },
    s3Impl,
    lookupImpl,
    updateImpl,
    emailGroupsImpl,
    streams,
  };
}
const request =
  'To: unsubscribe@send.tryamie.com\r\nFrom: "Doe, Jane" <Jane@Example.COM>\r\nMessage-ID: <message-1>\r\nSubject: unsubscribe\r\n\r\nbody';

function expectResult(result: string) {
  expect(createCounter).toHaveBeenCalledWith("mailto_unsubscribe_processed");
  expect(add).toHaveBeenCalledWith(1, { result });
  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "mailto_unsubscribe",
      workspaceId: "workspace-1",
      result,
    }),
    expect.any(String),
  );
}

describe("readInboundHeaders", () => {
  it("unfolds headers, preserves quoted commas, and stops before requesting the body", async () => {
    const readBody = jest.fn();
    const closed = jest.fn();
    async function* chunks() {
      try {
        yield Buffer.from(
          'To: "Doe, Jane" <reader@example.com>,\r\n\tUNSUBSCRIBE@SEND.TRYAMIE.COM\r\nSubject: one\r\n two\r\n',
        );
        yield Buffer.from("\r\n");
        readBody();
        yield Buffer.from("From: wrong@example.com");
      } finally {
        closed();
      }
    }
    const headers = await readInboundHeaders(chunks());
    expect(headers.get("to")).toEqual([
      '"Doe, Jane" <reader@example.com>, UNSUBSCRIBE@SEND.TRYAMIE.COM',
    ]);
    expect(headers.get("subject")).toEqual(["one two"]);
    expect(headers.has("from")).toBe(false);
    expect(readBody).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it("handles a delimiter split across chunks and ignores body headers in the same chunk", async () => {
    const headers = await readInboundHeaders(
      Readable.from([
        Buffer.from("To: a@example.com\r"),
        Buffer.from("\n\r"),
        Buffer.from("\nFrom: wrong@example.com"),
      ]),
    );
    expect(headers.get("to")).toEqual(["a@example.com"]);
    expect(headers.has("from")).toBe(false);
  });

  it("supports LF headers, repeated fields, and only the specified headers", async () => {
    const headers = await readInboundHeaders(
      Readable.from([
        "Cc: a@example.com\nCc: b@example.com\nX-Ignored: ignored\n\n",
      ]),
    );
    expect(headers.get("cc")).toEqual(["a@example.com", "b@example.com"]);
    expect(headers.has("x-ignored")).toBe(false);
  });

  it("rejects overlong headers without reading another chunk", async () => {
    const more = jest.fn();
    async function* chunks() {
      yield Buffer.alloc(65536, 65);
      more();
      yield Buffer.from("\r\n\r\n");
    }
    await expect(readInboundHeaders(chunks())).rejects.toThrow("64 KB");
    expect(more).not.toHaveBeenCalled();
  });

  it("accepts a header block ending exactly at 64 KB", async () => {
    const input = `Subject: ${"a".repeat(65536 - 13)}\r\n\r\n`;
    expect(Buffer.byteLength(input)).toBe(65536);
    await expect(
      readInboundHeaders(Readable.from([input])),
    ).resolves.toBeInstanceOf(Map);
  });

  it("rejects incomplete headers and stream errors", async () => {
    await expect(
      readInboundHeaders(Readable.from(["To: incomplete"])),
    ).rejects.toThrow("Incomplete");
    async function* broken() {
      yield Buffer.from("To: ");
      throw new Error("Read failed");
    }
    await expect(readInboundHeaders(broken())).rejects.toThrow("Read failed");
  });
});

describe("processInboundUnsubscribes", () => {
  it("resolves email case-insensitively, unsubscribes every email group, copies then deletes", async () => {
    const f = fixture({ "inbound/one": request });
    expect(await processInboundUnsubscribes(f.params)).toEqual({
      scanned: 1,
      unsubscribed: 1,
      userNotFound: 0,
      other: 0,
      errors: 0,
    });
    expect(f.lookupImpl).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userPropertyName: "email",
      value: "jane@example.com",
      caseInsensitive: true,
    });
    expect(f.emailGroupsImpl).toHaveBeenCalledWith("workspace-1");
    expect(f.updateImpl).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userUpdates: [
        { userId: "user-1", changes: { marketing: false, news: false } },
      ],
    });
    expect(f.s3Impl.getObject).toHaveBeenCalledWith({
      Bucket: "inbound-bucket",
      Key: "inbound/one",
      Range: "bytes=0-65535",
    });
    expect(f.s3Impl.copyObject).toHaveBeenCalledWith({
      Bucket: "inbound-bucket",
      Key: "processed/inbound/one",
      CopySource: "inbound-bucket/inbound/one",
    });
    expect(f.s3Impl.deleteObject).toHaveBeenCalledWith({
      Bucket: "inbound-bucket",
      Key: "inbound/one",
    });
    expect(f.s3Impl.copyObject.mock.invocationCallOrder[0]).toBeLessThan(
      f.s3Impl.deleteObject.mock.invocationCallOrder[0] ?? 0,
    );
    expect(f.streams[0]?.destroyed).toBe(true);
    expectResult("unsubscribed");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        messageId: "<message-1>",
        processedAt: 123,
      }),
      expect.any(String),
    );
  });

  it.each([
    'To: "Doe, Jane" <reader@example.com>,\r\n\tUNSUBSCRIBE@SEND.TRYAMIE.COM',
    "Delivered-To: unsubscribe@mail.tryamie.com",
    "X-Original-To: unsubscribe@em.tryamie.com",
    "Cc: UnSubscribe@send.tryamie.com",
    "To: List: reader@example.com, unsubscribe@send.tryamie.com;",
  ])("detects recipient header %s", async (recipient) => {
    const f = fixture({
      "inbound/one": `${recipient}\r\nFrom: jane@example.com\r\n\r\n`,
    });
    expect((await processInboundUnsubscribes(f.params)).unsubscribed).toBe(1);
  });

  it("falls back to Return-Path when From has no address", async () => {
    const f = fixture({
      "inbound/one":
        "To: unsubscribe@send.tryamie.com\r\nFrom: invalid\r\nReturn-Path: <fallback@example.com>\r\n\r\n",
    });
    await processInboundUnsubscribes(f.params);
    expect(f.lookupImpl).toHaveBeenCalledWith(
      expect.objectContaining({ value: "fallback@example.com" }),
    );
  });

  it("moves unknown senders to processed", async () => {
    const f = fixture({ "inbound/one": request });
    f.lookupImpl.mockResolvedValue([]);
    expect((await processInboundUnsubscribes(f.params)).userNotFound).toBe(1);
    expect(f.updateImpl).not.toHaveBeenCalled();
    expect(f.s3Impl.copyObject).toHaveBeenCalledWith(
      expect.objectContaining({ Key: "processed/inbound/one" }),
    );
    expectResult("user_not_found");
  });

  it.each([
    "reader@send.tryamie.com",
    "unsubscribe@send.tryamie.com.evil",
    "unsubscribe+tag@send.tryamie.com",
  ])("moves non-unsubscribe recipient %s to other", async (recipient) => {
    const f = fixture({
      "inbound/one": request.replace("unsubscribe@send.tryamie.com", recipient),
    });
    expect((await processInboundUnsubscribes(f.params)).other).toBe(1);
    expect(f.lookupImpl).not.toHaveBeenCalled();
    expect(f.s3Impl.copyObject).toHaveBeenCalledWith(
      expect.objectContaining({ Key: "other/inbound/one" }),
    );
    expectResult("not_unsubscribe");
  });

  it.each(["auto-replied", "AUTO-GENERATED"])(
    "ignores Auto-Submitted: %s",
    async (value) => {
      const f = fixture({
        "inbound/one": `Auto-Submitted: ${value}\r\n${request}`,
      });
      expect((await processInboundUnsubscribes(f.params)).other).toBe(1);
      expect(f.lookupImpl).not.toHaveBeenCalled();
      expect(f.s3Impl.copyObject).toHaveBeenCalledWith(
        expect.objectContaining({ Key: "other/inbound/one" }),
      );
      expectResult("auto_submitted");
    },
  );

  it("does not ignore Auto-Submitted: no", async () => {
    const f = fixture({ "inbound/one": `Auto-Submitted: no\r\n${request}` });
    expect((await processInboundUnsubscribes(f.params)).unsubscribed).toBe(1);
  });

  it("leaves a failed copy in place and continues to the next object", async () => {
    const f = fixture(
      { "inbound/one": request, "inbound/two": request },
      "processed/inbound/one",
    );
    expect(await processInboundUnsubscribes(f.params)).toEqual({
      scanned: 2,
      unsubscribed: 1,
      userNotFound: 0,
      other: 0,
      errors: 1,
    });
    expect(f.s3Impl.deleteObject).toHaveBeenCalledTimes(1);
    expect(f.s3Impl.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ Key: "inbound/two" }),
    );
    expectResult("error");
  });

  it.each(["get", "lookup", "update", "delete"])(
    "continues after %s fails",
    async (operation) => {
      const f = fixture({ "inbound/one": request, "inbound/two": request });
      const failure = new Error("Failed");
      if (operation === "get")
        f.s3Impl.getObject.mockRejectedValueOnce(failure);
      if (operation === "lookup") f.lookupImpl.mockRejectedValueOnce(failure);
      if (operation === "update") f.updateImpl.mockRejectedValueOnce(failure);
      if (operation === "delete")
        f.s3Impl.deleteObject.mockRejectedValueOnce(failure);
      const result = await processInboundUnsubscribes(f.params);
      expect(result.errors).toBe(1);
      expect(result.unsubscribed).toBe(1);
      if (operation !== "delete")
        expect(f.s3Impl.deleteObject).not.toHaveBeenCalledWith(
          expect.objectContaining({ Key: "inbound/one" }),
        );
    },
  );

  it("leaves malformed or oversized messages in place", async () => {
    const f = fixture({
      "inbound/one": "missing blank line",
      "inbound/two": "x".repeat(65537),
    });
    expect((await processInboundUnsubscribes(f.params)).errors).toBe(2);
    expect(f.s3Impl.copyObject).not.toHaveBeenCalled();
    expect(f.s3Impl.deleteObject).not.toHaveBeenCalled();
    expect(f.streams.every((stream) => stream.destroyed)).toBe(true);
  });

  it("paginates and stops at the requested limit", async () => {
    const f = fixture({
      "inbound/one": request,
      "inbound/two": request,
      "inbound/three": request,
    });
    f.s3Impl.listObjectsV2
      .mockResolvedValueOnce({
        Contents: [{ Key: "inbound/one" }],
        IsTruncated: true,
        NextContinuationToken: "next",
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: "inbound/two" }, { Key: "inbound/three" }],
        IsTruncated: true,
        NextContinuationToken: "last",
      });
    expect(
      (await processInboundUnsubscribes({ ...f.params, limit: 2 })).scanned,
    ).toBe(2);
    expect(f.s3Impl.listObjectsV2).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ Prefix: "inbound/", MaxKeys: 2 }),
    );
    expect(f.s3Impl.listObjectsV2).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ContinuationToken: "next", MaxKeys: 1 }),
    );
    expect(f.s3Impl.listObjectsV2).toHaveBeenCalledTimes(2);
  });

  it("uses the default limit of 200 and encodes copy source keys", async () => {
    const f = fixture({ "inbound/a +b": request });
    await processInboundUnsubscribes(f.params);
    expect(f.s3Impl.listObjectsV2).toHaveBeenCalledWith(
      expect.objectContaining({ MaxKeys: 200 }),
    );
    expect(f.s3Impl.copyObject).toHaveBeenCalledWith(
      expect.objectContaining({
        CopySource: "inbound-bucket/inbound/a%20%2Bb",
      }),
    );
  });

  it("counts list errors and does not call S3 for a zero limit", async () => {
    const f = fixture({});
    await processInboundUnsubscribes({ ...f.params, limit: 0 });
    expect(f.s3Impl.listObjectsV2).not.toHaveBeenCalled();
    f.s3Impl.listObjectsV2.mockRejectedValue(new Error("List failed"));
    expect((await processInboundUnsubscribes(f.params)).errors).toBe(1);
    expectResult("error");
  });

  it("uses SES provider credentials to construct and close its S3 client", async () => {
    const f = fixture({});
    const destroy = jest.fn();
    const client = new S3({});
    jest
      .mocked(S3)
      .mockReturnValue(Object.assign(client, f.s3Impl, { destroy }));
    jest.mocked(getEmailProvider).mockResolvedValue(
      ok({
        type: EmailProviderType.AmazonSes,
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
        region: "us-east-1",
      }),
    );
    expect(
      (await processInboundUnsubscribes({ workspaceId: "workspace-1" })).errors,
    ).toBe(0);
    expect(getEmailProvider).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      providerOverride: EmailProviderType.AmazonSes,
    });
    expect(S3).toHaveBeenCalledWith({
      region: "us-east-1",
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    });
    expect(destroy).toHaveBeenCalled();
  });
});

describe("scheduled inbound processing", () => {
  it("is disabled without querying the workspace or provider", async () => {
    await processScheduledInboundUnsubscribes();
    expect(db).not.toHaveBeenCalled();
    expect(getEmailProvider).not.toHaveBeenCalled();
  });

  it("selects the default single-tenant workspace when enabled", async () => {
    jest.mocked(config).mockReturnValue({
      ...config(),
      unsubscribeMailtoProcessorEnabled: true,
    });
    findWorkspace.mockResolvedValue({
      id: "default-workspace",
      name: "Default",
      createdAt: new Date(),
      updatedAt: new Date(),
      domain: null,
      type: "Root",
      status: "Active",
      parentWorkspaceId: null,
      externalId: null,
    });
    jest
      .mocked(getEmailProvider)
      .mockRejectedValue(new Error("Provider unavailable"));
    await processScheduledInboundUnsubscribes();
    expect(findWorkspace).toHaveBeenCalledWith();
    expect(getEmailProvider).toHaveBeenCalledWith({
      workspaceId: "default-workspace",
      providerOverride: EmailProviderType.AmazonSes,
    });
  });
});
