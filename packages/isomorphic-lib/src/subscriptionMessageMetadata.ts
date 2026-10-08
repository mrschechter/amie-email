import { Static, Type } from "@sinclair/typebox";

/** Original send ID, distinct from the subscription event's deduplication ID. */
export const SubscriptionMessageMetadata = Type.Object(
  {
    messageId: Type.String({ minLength: 1, maxLength: 512 }),
    journeyId: Type.Optional(Type.String({ maxLength: 512 })),
    broadcastId: Type.Optional(Type.String({ maxLength: 512 })),
    templateId: Type.Optional(Type.String({ maxLength: 512 })),
    nodeId: Type.Optional(Type.String({ maxLength: 512 })),
    email: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type SubscriptionMessageMetadata = Static<
  typeof SubscriptionMessageMetadata
>;
