import { Static, Type } from "@sinclair/typebox";

export const AmieAsset = Type.Object({
  id: Type.String(),
  url: Type.String({ pattern: "^https?://" }),
  name: Type.String(),
  size: Type.Number({ minimum: 0 }),
  contentType: Type.String(),
  width: Type.Optional(Type.Number({ minimum: 1 })),
  height: Type.Optional(Type.Number({ minimum: 1 })),
});

export type AmieAsset = Static<typeof AmieAsset>;

export const AmieAssetListResponse = Type.Object({
  assets: Type.Array(AmieAsset),
});

export type AmieAssetListResponse = Static<typeof AmieAssetListResponse>;

export const AmieAssetErrorResponse = Type.Object({
  message: Type.String(),
});

export type AmieAssetErrorResponse = Static<typeof AmieAssetErrorResponse>;
