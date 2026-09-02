import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  AssetStorageClient,
  deleteAssetObject,
  listAssetObjects,
  putAssetObject,
  storage,
} from "backend-lib/src/blobStorage";
import backendConfig from "backend-lib/src/config";
import { randomUUID } from "crypto";
import { FastifyInstance } from "fastify";
import {
  AmieAsset,
  AmieAssetErrorResponse,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";
import path from "path";

const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

type ImageContentType = keyof typeof IMAGE_TYPES;

export interface AmieAssetsControllerOptions {
  s3Client?: AssetStorageClient;
}

function detectedContentType(bytes: Buffer): ImageContentType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const signature = new TextDecoder().decode(bytes.slice(0, 6));
  if (signature === "GIF87a" || signature === "GIF89a") {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function safeName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  return (
    base
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "image"
  );
}

function assetUrl(key: string): string {
  return `${backendConfig().amieAssetsPublicBaseUrl.replace(/\/$/, "")}/${key}`;
}

function contentTypeFromKey(key: string): ImageContentType {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".gif")) return "image/gif";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function displayNameFromKey(key: string): string {
  const segment = key.split("/").pop() ?? key;
  return segment.replace(/^[0-9a-f-]{36}-/i, "");
}

function workspaceField(fields: Record<string, unknown>): string | undefined {
  const field = fields.workspaceId;
  if (typeof field === "string") return field;
  if (field && typeof field === "object" && "value" in field) {
    const { value } = field;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

// Fastify detects the returned promise and completes plugin registration.
// eslint-disable-next-line @typescript-eslint/require-await
export default async function amieAssetsController(
  fastify: FastifyInstance,
  options: AmieAssetsControllerOptions,
) {
  const s3Client =
    options.s3Client ??
    // S3Client's generic send overload implements this narrower injected seam.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    (storage() as unknown as AssetStorageClient);

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/assets",
    {
      schema: {
        description: "Upload an image asset for an Amie workspace.",
        tags: ["Content"],
        response: {
          200: AmieAsset,
          400: AmieAssetErrorResponse,
          413: AmieAssetErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const maxBytes = backendConfig().amieAssetsMaxBytes;
      let upload;
      try {
        upload = await request.file({ limits: { fileSize: maxBytes } });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "FST_REQ_FILE_TOO_LARGE"
        ) {
          return reply.status(413).send({ message: "Image is too large." });
        }
        throw error;
      }
      if (!upload) {
        return reply
          .status(400)
          .send({ message: "An image file is required." });
      }

      const workspaceId = workspaceField(upload.fields);
      if (!workspaceId) {
        upload.file.resume();
        return reply.status(400).send({ message: "workspaceId is required." });
      }

      let buffer: Buffer;
      try {
        buffer = await upload.toBuffer();
      } catch (error) {
        if (upload.file.truncated) {
          return reply.status(413).send({ message: "Image is too large." });
        }
        throw error;
      }
      if (upload.file.truncated || buffer.byteLength > maxBytes) {
        return reply.status(413).send({ message: "Image is too large." });
      }

      const contentType = detectedContentType(buffer);
      if (!contentType) {
        return reply.status(400).send({
          message: "Upload a PNG, JPG, GIF, or WebP image.",
        });
      }

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const extension = IMAGE_TYPES[contentType];
      const key = `public/${workspaceId}/${year}/${month}/${randomUUID()}-${safeName(upload.filename)}.${extension}`;
      await putAssetObject(s3Client, {
        key,
        body: buffer,
        contentType,
      });
      return reply.status(200).send({
        id: key,
        url: assetUrl(key),
        name: upload.filename,
        size: buffer.byteLength,
        contentType,
      });
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/assets",
    {
      schema: {
        description: "List image assets for an Amie workspace.",
        tags: ["Content"],
        querystring: Type.Object({ workspaceId: Type.String() }),
        response: { 200: AmieAssetListResponse },
      },
    },
    async (request, reply) => {
      const objects = await listAssetObjects(s3Client, {
        prefix: `public/${request.query.workspaceId}/`,
      });
      const assets: AmieAsset[] = objects
        .sort(
          (left, right) =>
            (right.lastModified?.getTime() ?? 0) -
            (left.lastModified?.getTime() ?? 0),
        )
        .slice(0, 200)
        .map((object) => ({
          id: object.key,
          url: assetUrl(object.key),
          name: displayNameFromKey(object.key),
          size: object.size,
          contentType: contentTypeFromKey(object.key),
        }));
      return reply.status(200).send({ assets });
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().delete(
    "/assets/:key",
    {
      schema: {
        description: "Delete an image asset from an Amie workspace.",
        tags: ["Content"],
        params: Type.Object({ key: Type.String() }),
        querystring: Type.Object({ workspaceId: Type.String() }),
        response: {
          204: Type.Null(),
          403: AmieAssetErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const expectedPrefix = `public/${request.query.workspaceId}/`;
      if (!request.params.key.startsWith(expectedPrefix)) {
        return reply.status(403).send({
          message: "Asset does not belong to this workspace.",
        });
      }
      await deleteAssetObject(s3Client, { key: request.params.key });
      return reply.status(204).send();
    },
  );
}
