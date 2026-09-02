/* eslint-disable no-await-in-loop */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import config from "./config";

export interface AssetStorageClient {
  send(command: object): Promise<unknown>;
}

export interface AssetStorageObject {
  key: string;
  size: number;
  lastModified?: Date;
}

export function storage() {
  const {
    blobStorageAccessKeyId,
    blobStorageSecretAccessKey,
    blobStorageEndpoint,
    blobStorageRegion,
  } = config();
  const configuredCredentials =
    blobStorageAccessKeyId && blobStorageSecretAccessKey
      ? {
          credentials: {
            accessKeyId: blobStorageAccessKeyId,
            secretAccessKey: blobStorageSecretAccessKey,
          },
          endpoint: blobStorageEndpoint,
          forcePathStyle: true,
        }
      : {};
  const s3Client = new S3Client({
    ...configuredCredentials,
    region: blobStorageRegion,
  });
  return s3Client;
}

export async function putAssetObject(
  client: AssetStorageClient,
  {
    key,
    body,
    contentType,
  }: { key: string; body: Buffer; contentType: string },
) {
  await client.send(
    new PutObjectCommand({
      Bucket: config().amieAssetsBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function listAssetObjects(
  client: AssetStorageClient,
  { prefix }: { prefix: string },
): Promise<AssetStorageObject[]> {
  const objects: AssetStorageObject[] = [];
  let continuationToken: string | undefined;
  do {
    // The injected interface intentionally keeps AWS out of API package types.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const response = (await client.send(
      new ListObjectsV2Command({
        Bucket: config().amieAssetsBucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )) as ListObjectsV2CommandOutput;
    for (const object of response.Contents ?? []) {
      if (object.Key) {
        objects.push({
          key: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified,
        });
      }
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

export async function deleteAssetObject(
  client: AssetStorageClient,
  { key }: { key: string },
) {
  await client.send(
    new DeleteObjectCommand({
      Bucket: config().amieAssetsBucket,
      Key: key,
    }),
  );
}

export async function putObject(
  client: S3Client,
  {
    text,
    key,
    contentType,
  }: {
    text: string;
    key: string;
    contentType?: string;
  },
) {
  const body = new TextEncoder().encode(text);
  const command = new PutObjectCommand({
    Bucket: config().blobStorageBucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await client.send(command);
}

export async function getObject(
  client: S3Client,
  { key }: { key: string },
): Promise<{
  text: string;
} | null> {
  const command = new GetObjectCommand({
    Bucket: config().blobStorageBucket,
    Key: key,
  });
  const response = await client.send(command);
  if (!response.Body) {
    return null;
  }

  const text = await response.Body.transformToString();
  return { text };
}

export async function createBucket(
  client: S3Client,
  { bucketName }: { bucketName: string },
) {
  const command = new CreateBucketCommand({
    Bucket: bucketName,
  });
  try {
    await client.send(command);
  } catch (e) {
    // Ignore if bucket already exists and is owned by us
    if (e instanceof Error && e.name === "BucketAlreadyOwnedByYou") {
      return;
    }
    throw e;
  }
}

export async function deleteObjectsWithPrefix(
  client: S3Client,
  { prefix }: { prefix: string },
) {
  const bucket = config().blobStorageBucket;
  let continuationToken: string | undefined;
  do {
    const listRes: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    const contents = listRes.Contents ?? [];
    const keys = contents
      .map((o: { Key?: string }) => o.Key)
      .filter((k: string | undefined): k is string => !!k);
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((Key: string) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
    continuationToken = listRes.IsTruncated
      ? listRes.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

export async function listObjectKeysWithPrefix(
  client: S3Client,
  { prefix }: { prefix: string },
): Promise<string[]> {
  const bucket = config().blobStorageBucket;
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const listRes: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    const contents = listRes.Contents ?? [];
    for (const o of contents) {
      if (o.Key) keys.push(o.Key);
    }
    continuationToken = listRes.IsTruncated
      ? listRes.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
}
