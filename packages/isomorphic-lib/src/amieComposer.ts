import { Static, Type } from "@sinclair/typebox";

const strictObject = <T extends Parameters<typeof Type.Object>[0]>(
  properties: T,
) => Type.Object(properties, { additionalProperties: false });

const HttpUrl = Type.String({ pattern: "^https?://" });

export const AmieHeaderBlock = strictObject({
  type: Type.Literal("header"),
  params: strictObject({}),
});

export const AmieHeroHeadingBlock = strictObject({
  type: Type.Literal("heroHeading"),
  params: strictObject({
    title: Type.String(),
    subtitle: Type.Optional(Type.String()),
  }),
});

export const AmieParagraphBlock = strictObject({
  type: Type.Literal("paragraph"),
  params: strictObject({
    text: Type.String(),
  }),
});

export const AmieCtaButtonBlock = strictObject({
  type: Type.Literal("ctaButton"),
  params: strictObject({
    label: Type.String(),
    url: HttpUrl,
  }),
});

export const AmieProductCardBlock = strictObject({
  type: Type.Literal("productCard"),
  params: strictObject({
    title: Type.String(),
    description: Type.String(),
    price: Type.Optional(Type.String()),
    imageUrl: Type.Optional(HttpUrl),
    ctaLabel: Type.Optional(Type.String()),
    ctaUrl: Type.Optional(HttpUrl),
  }),
});

export const AmieTestimonialBlock = strictObject({
  type: Type.Literal("testimonial"),
  params: strictObject({
    quote: Type.String(),
    attribution: Type.String(),
  }),
});

export const AmieDividerBlock = strictObject({
  type: Type.Literal("divider"),
  params: strictObject({}),
});

export const AmieFooterBlock = strictObject({
  type: Type.Literal("footer"),
  params: strictObject({
    addressLine: Type.String(),
    unsubscribe: Type.String(),
  }),
});

export const AmieBlockSpec = Type.Union([
  AmieHeaderBlock,
  AmieHeroHeadingBlock,
  AmieParagraphBlock,
  AmieCtaButtonBlock,
  AmieProductCardBlock,
  AmieTestimonialBlock,
  AmieDividerBlock,
  AmieFooterBlock,
]);

export type AmieBlockSpec = Static<typeof AmieBlockSpec>;
export const BlockSpec = AmieBlockSpec;
export type BlockSpec = Static<typeof BlockSpec>;
export type AmieHeaderParams = Static<typeof AmieHeaderBlock>["params"];
export type AmieHeroHeadingParams = Static<
  typeof AmieHeroHeadingBlock
>["params"];
export type AmieParagraphParams = Static<
  typeof AmieParagraphBlock
>["params"];
export type AmieCtaButtonParams = Static<
  typeof AmieCtaButtonBlock
>["params"];
export type AmieProductCardParams = Static<
  typeof AmieProductCardBlock
>["params"];
export type AmieTestimonialParams = Static<
  typeof AmieTestimonialBlock
>["params"];
export type AmieDividerParams = Static<typeof AmieDividerBlock>["params"];
export type AmieFooterParams = Static<typeof AmieFooterBlock>["params"];

export const AmieComposerConversationMessage = strictObject({
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  content: Type.String(),
});

export const AmieComposeRequest = strictObject({
  workspaceId: Type.String(),
  prompt: Type.String({ minLength: 1 }),
  currentBlocks: Type.Optional(Type.Array(AmieBlockSpec)),
  conversation: Type.Optional(Type.Array(AmieComposerConversationMessage)),
});

export type AmieComposeRequest = Static<typeof AmieComposeRequest>;

export const AmieComposerModelOutput = strictObject({
  subject: Type.String(),
  previewText: Type.String(),
  blocks: Type.Array(AmieBlockSpec),
});

export type AmieComposerModelOutput = Static<typeof AmieComposerModelOutput>;

export const AmieComposeResponse = strictObject({
  subject: Type.String(),
  previewText: Type.String(),
  blocks: Type.Array(AmieBlockSpec),
  html: Type.String(),
});

export type AmieComposeResponse = Static<typeof AmieComposeResponse>;

export enum AmieComposerReasonCode {
  Disabled = "AMIE_COMPOSER_DISABLED",
  InvalidModelResponse = "AMIE_COMPOSER_INVALID_MODEL_RESPONSE",
  ModelFailure = "AMIE_COMPOSER_MODEL_FAILURE",
}

export const AmieComposerErrorResponse = strictObject({
  message: Type.String(),
  reasonCode: Type.Enum(AmieComposerReasonCode),
});

export type AmieComposerErrorResponse = Static<
  typeof AmieComposerErrorResponse
>;
