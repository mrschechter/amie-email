import fastifyMultipart from "@fastify/multipart";
import { AssetStorageClient } from "backend-lib/src/blobStorage";
import fastify from "fastify";
import {
  AmieAsset,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";

import amieAssetsController from "./amieAssetsController";

function multipartUpload({
  workspaceId,
  filename,
  contentType,
  bytes,
}: {
  workspaceId: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}) {
  const boundary = "amie-test-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      [
        `--${boundary}\r\nContent-Disposition: form-data; name="workspaceId"\r\n\r\n${workspaceId}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
        bytes.toString("latin1"),
        `\r\n--${boundary}--\r\n`,
      ].join(""),
      "latin1",
    ),
  };
}

function s3Mock(
  implementation?: (command: object) => Promise<unknown>,
): AssetStorageClient & { send: jest.Mock<Promise<unknown>, [object]> } {
  return {
    send: jest.fn(implementation ?? (() => Promise.resolve({}))),
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function commandInput(command: object | undefined): Record<string, unknown> {
  if (command && "input" in command) {
    const { input } = command;
    if (isUnknownRecord(input)) return input;
  }
  return {};
}

describe("amieAssetsController", () => {
  it("validates image bytes and uploads with public immutable metadata", async () => {
    const client = s3Mock();
    const app = fastify();
    await app.register(fastifyMultipart);
    await app.register(amieAssetsController, { s3Client: client });

    const multipart = multipartUpload({
      workspaceId: "workspace-1",
      filename: "Summer Product!!.not-png",
      contentType: "application/octet-stream",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    const response = await app.inject({
      method: "POST",
      url: "/assets",
      ...multipart,
    });

    expect(response.statusCode).toBe(200);
    const asset = response.json<AmieAsset>();
    expect(asset).toMatchObject({
      name: "Summer Product!!.not-png",
      size: 8,
      contentType: "image/png",
    });
    expect(asset.id).toMatch(
      /^public\/workspace-1\/\d{4}\/\d{2}\/[0-9a-f-]{36}-Summer-Product\.png$/,
    );
    expect(asset.url).toContain(asset.id);

    const input = commandInput(client.send.mock.calls[0]?.[0]);
    expect(input).toMatchObject({
      Bucket: "amie-send-assets",
      Key: asset.id,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("rejects a spoofed unsupported file without calling S3", async () => {
    const client = s3Mock();
    const app = fastify();
    await app.register(fastifyMultipart);
    await app.register(amieAssetsController, { s3Client: client });

    const response = await app.inject({
      method: "POST",
      url: "/assets",
      ...multipartUpload({
        workspaceId: "workspace-1",
        filename: "not-really.png",
        contentType: "image/png",
        bytes: Buffer.from("not an image"),
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(client.send).not.toHaveBeenCalled();
  });

  it("lists the newest 200 assets from only the workspace prefix", async () => {
    const contents = Array.from({ length: 205 }, (_, index) => ({
      Key: `public/workspace-1/2026/09/00000000-0000-4000-8000-${String(index).padStart(12, "0")}-asset-${index}.jpg`,
      Size: index,
      LastModified: new Date(2026, 0, index + 1),
    }));
    const client = s3Mock(() => Promise.resolve({ Contents: contents }));
    const app = fastify();
    await app.register(fastifyMultipart);
    await app.register(amieAssetsController, { s3Client: client });

    const response = await app.inject({
      method: "GET",
      url: "/assets?workspaceId=workspace-1",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieAssetListResponse>();
    expect(body.assets).toHaveLength(200);
    expect(body.assets[0]?.size).toBe(204);
    const input = commandInput(client.send.mock.calls[0]?.[0]);
    expect(input.Prefix).toBe("public/workspace-1/");
  });

  it("deletes only keys under the requested workspace", async () => {
    const client = s3Mock();
    const app = fastify();
    await app.register(fastifyMultipart);
    await app.register(amieAssetsController, { s3Client: client });
    const ownKey = "public/workspace-1/2026/09/id-image.jpg";

    const forbidden = await app.inject({
      method: "DELETE",
      url: `/assets/${encodeURIComponent("public/workspace-2/image.jpg")}?workspaceId=workspace-1`,
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/assets/${encodeURIComponent(ownKey)}?workspaceId=workspace-1`,
    });

    expect(forbidden.statusCode).toBe(403);
    expect(deleted.statusCode).toBe(204);
    expect(client.send).toHaveBeenCalledTimes(1);
    const input = commandInput(client.send.mock.calls[0]?.[0]);
    expect(input.Key).toBe(ownKey);
  });
});
