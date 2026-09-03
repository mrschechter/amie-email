import { Static, Type } from "@sinclair/typebox";

const strictObject = <T extends Parameters<typeof Type.Object>[0]>(
  properties: T,
) => Type.Object(properties, { additionalProperties: false });

const HttpUrl = Type.String({ pattern: "^https?://" });
const HttpOrLiquidUrl = Type.Union([
  HttpUrl,
  Type.String({ pattern: "^\\s*\\{\\{[\\s\\S]*\\}\\}\\s*$" }),
]);

// Keep copy constraints in the schemas themselves so every consumer (including
// model-output normalization) has one source of truth for the limits.
const AmieSubjectText = Type.String({ maxLength: 60 });
const AmiePreviewText = Type.String({ minLength: 1, maxLength: 140 });
const AmieBlockHeadingText = Type.String({ maxLength: 80 });
const AmieCtaText = Type.String({ maxLength: 40 });
const AmieAltText = Type.String({ maxLength: 125 });

export const AMIE_MAX_BLOCKS = 20;

export const AmieBrandBackground = Type.Union([
  Type.Literal("ivory"),
  Type.Literal("blush"),
  Type.Literal("white"),
  Type.Literal("teal"),
  Type.Literal("sage"),
]);
export type AmieBrandBackground = Static<typeof AmieBrandBackground>;

export const AmieBlockStyle = strictObject({
  background: Type.Optional(AmieBrandBackground),
  align: Type.Optional(
    Type.Union([Type.Literal("left"), Type.Literal("center")]),
  ),
  padding: Type.Optional(
    Type.Union([
      Type.Literal("tight"),
      Type.Literal("normal"),
      Type.Literal("loose"),
    ]),
  ),
  textSize: Type.Optional(
    Type.Union([Type.Literal("s"), Type.Literal("m"), Type.Literal("l")]),
  ),
  buttonVariant: Type.Optional(
    Type.Union([
      Type.Literal("primary"),
      Type.Literal("secondary"),
      Type.Literal("roseGold"),
    ]),
  ),
});
export type AmieBlockStyle = Static<typeof AmieBlockStyle>;

const styledBlock = <T extends Parameters<typeof Type.Object>[0]>(
  properties: T,
) =>
  strictObject({
    id: Type.Optional(Type.String({ minLength: 1 })),
    ...properties,
    style: Type.Optional(AmieBlockStyle),
  });

export const AmieHeaderBlock = styledBlock({
  type: Type.Literal("header"),
  params: strictObject({}),
});

export const AmieHeroHeadingBlock = styledBlock({
  type: Type.Literal("heroHeading"),
  params: strictObject({
    title: AmieBlockHeadingText,
    subtitle: Type.Optional(Type.String()),
  }),
});

export const AmieParagraphBlock = styledBlock({
  type: Type.Literal("paragraph"),
  params: strictObject({ text: Type.String() }),
});

export const AmieCtaButtonBlock = styledBlock({
  type: Type.Literal("ctaButton"),
  params: strictObject({ label: AmieCtaText, url: HttpOrLiquidUrl }),
});

export const AmieProductCardBlock = styledBlock({
  type: Type.Literal("productCard"),
  params: strictObject({
    title: AmieBlockHeadingText,
    description: Type.String(),
    price: Type.Optional(Type.String()),
    imageUrl: Type.Optional(HttpUrl),
    ctaLabel: Type.Optional(AmieCtaText),
    ctaUrl: Type.Optional(HttpOrLiquidUrl),
  }),
});

export const AmieImageBlock = styledBlock({
  type: Type.Literal("image"),
  params: strictObject({
    src: HttpUrl,
    alt: AmieAltText,
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 1200 })),
    href: Type.Optional(HttpOrLiquidUrl),
  }),
});

export const AmieHeroImageBlock = styledBlock({
  type: Type.Literal("heroImage"),
  params: strictObject({
    src: HttpUrl,
    alt: AmieAltText,
    headline: Type.Optional(AmieBlockHeadingText),
    href: Type.Optional(HttpOrLiquidUrl),
  }),
});

export const AmieTestimonialBlock = styledBlock({
  type: Type.Literal("testimonial"),
  params: strictObject({ quote: Type.String(), attribution: Type.String() }),
});

export const AmieDividerBlock = styledBlock({
  type: Type.Literal("divider"),
  params: strictObject({}),
});

export const AmieFooterBlock = styledBlock({
  type: Type.Literal("footer"),
  params: strictObject({
    addressLine: Type.String(),
    unsubscribe: Type.String(),
  }),
});

export const AmieTwoColumnBlock = styledBlock({
  type: Type.Literal("twoColumn"),
  params: strictObject({
    image: strictObject({
      src: HttpUrl,
      alt: AmieAltText,
      href: Type.Optional(HttpOrLiquidUrl),
    }),
    imageSide: Type.Union([Type.Literal("left"), Type.Literal("right")]),
    heading: Type.Optional(AmieBlockHeadingText),
    body: Type.String(),
    cta: Type.Optional(
      strictObject({ label: AmieCtaText, url: HttpOrLiquidUrl }),
    ),
  }),
});

export const AmieBulletListBlock = styledBlock({
  type: Type.Literal("bulletList"),
  params: strictObject({
    heading: Type.Optional(AmieBlockHeadingText),
    items: Type.Array(Type.String(), { minItems: 1 }),
  }),
});

export const AmieStatsRowBlock = styledBlock({
  type: Type.Literal("statsRow"),
  params: strictObject({
    items: Type.Array(
      strictObject({ value: Type.String(), label: Type.String() }),
      { minItems: 2, maxItems: 4 },
    ),
  }),
});

export const AmieQuoteCalloutBlock = styledBlock({
  type: Type.Literal("quoteCallout"),
  params: strictObject({
    quote: Type.String(),
    attribution: Type.Optional(Type.String()),
  }),
});

export const AmieSpacerBlock = styledBlock({
  type: Type.Literal("spacer"),
  params: strictObject({
    height: Type.Union([
      Type.Literal(16),
      Type.Literal(24),
      Type.Literal(32),
      Type.Literal(48),
    ]),
  }),
});

export const AmieSectionBreakBlock = styledBlock({
  type: Type.Literal("sectionBreak"),
  params: strictObject({ background: AmieBrandBackground }),
});

// Internal import fallback. The block picker intentionally does not expose it.
export const AmieRawHtmlBlock = styledBlock({
  type: Type.Literal("rawHtml"),
  params: strictObject({ html: Type.String() }),
});

export const AmieBlockSpec = Type.Union([
  AmieHeaderBlock,
  AmieHeroHeadingBlock,
  AmieParagraphBlock,
  AmieCtaButtonBlock,
  AmieProductCardBlock,
  AmieImageBlock,
  AmieHeroImageBlock,
  AmieTestimonialBlock,
  AmieDividerBlock,
  AmieFooterBlock,
  AmieTwoColumnBlock,
  AmieBulletListBlock,
  AmieStatsRowBlock,
  AmieQuoteCalloutBlock,
  AmieSpacerBlock,
  AmieSectionBreakBlock,
  AmieRawHtmlBlock,
]);

export type AmieBlockSpec = Static<typeof AmieBlockSpec>;
export const BlockSpec = AmieBlockSpec;
export type BlockSpec = Static<typeof BlockSpec>;
export type AmieHeaderParams = Static<typeof AmieHeaderBlock>["params"];
export type AmieHeroHeadingParams = Static<
  typeof AmieHeroHeadingBlock
>["params"];
export type AmieParagraphParams = Static<typeof AmieParagraphBlock>["params"];
export type AmieCtaButtonParams = Static<typeof AmieCtaButtonBlock>["params"];
export type AmieProductCardParams = Static<
  typeof AmieProductCardBlock
>["params"];
export type AmieImageParams = Static<typeof AmieImageBlock>["params"];
export type AmieHeroImageParams = Static<typeof AmieHeroImageBlock>["params"];
export type AmieTestimonialParams = Static<
  typeof AmieTestimonialBlock
>["params"];
export type AmieDividerParams = Static<typeof AmieDividerBlock>["params"];
export type AmieFooterParams = Static<typeof AmieFooterBlock>["params"];
export type AmieTwoColumnParams = Static<typeof AmieTwoColumnBlock>["params"];
export type AmieBulletListParams = Static<typeof AmieBulletListBlock>["params"];
export type AmieStatsRowParams = Static<typeof AmieStatsRowBlock>["params"];
export type AmieQuoteCalloutParams = Static<
  typeof AmieQuoteCalloutBlock
>["params"];
export type AmieSpacerParams = Static<typeof AmieSpacerBlock>["params"];
export type AmieSectionBreakParams = Static<
  typeof AmieSectionBreakBlock
>["params"];
export type AmieRawHtmlParams = Static<typeof AmieRawHtmlBlock>["params"];

export const AmieComposerConversationMessage = strictObject({
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  content: Type.String(),
});

export const AmieEditDocument = strictObject({
  subject: Type.String(),
  previewText: Type.String(),
  blocks: Type.Array(AmieBlockSpec, { maxItems: AMIE_MAX_BLOCKS }),
  rawHtml: Type.Optional(Type.String()),
});
export type AmieEditDocument = Static<typeof AmieEditDocument>;

const blockId = Type.String({ minLength: 1 });
const afterBlockId = Type.Union([blockId, Type.Null()]);

export const AmieEditOp = Type.Union([
  strictObject({ type: Type.Literal("set_subject"), value: AmieSubjectText }),
  strictObject({
    type: Type.Literal("set_preview_text"),
    value: AmiePreviewText,
  }),
  strictObject({
    type: Type.Literal("replace_text"),
    blockId,
    find: Type.String({ minLength: 1 }),
    replace: Type.String(),
  }),
  strictObject({
    type: Type.Literal("set_block_props"),
    blockId,
    props: Type.Record(Type.String(), Type.Unknown()),
  }),
  strictObject({
    type: Type.Literal("insert_block"),
    afterBlockId,
    block: AmieBlockSpec,
  }),
  strictObject({ type: Type.Literal("remove_block"), blockId }),
  strictObject({ type: Type.Literal("move_block"), blockId, afterBlockId }),
  strictObject({
    type: Type.Literal("set_style_token"),
    name: Type.Union([
      Type.Literal("background"),
      Type.Literal("align"),
      Type.Literal("padding"),
      Type.Literal("textSize"),
      Type.Literal("buttonVariant"),
    ]),
    value: Type.String(),
  }),
  strictObject({ type: Type.Literal("no_op"), reason: Type.String() }),
]);
export type AmieEditOp = Static<typeof AmieEditOp>;

export const AmieEditModelOutput = strictObject({
  reply: Type.String({ minLength: 1 }),
  ops: Type.Array(AmieEditOp, { minItems: 1, maxItems: 12 }),
});
export type AmieEditModelOutput = Static<typeof AmieEditModelOutput>;

export const AmieEditRequest = strictObject({
  workspaceId: Type.String(),
  templateId: Type.String(),
  message: Type.String({ minLength: 1 }),
  conversation: Type.Array(AmieComposerConversationMessage),
  document: AmieEditDocument,
  renderedText: Type.String(),
});
export type AmieEditRequest = Static<typeof AmieEditRequest>;

export const AmieEditResponse = strictObject({
  reply: Type.String(),
  ops: Type.Array(AmieEditOp),
  warnings: Type.Array(Type.String()),
  document: AmieEditDocument,
  html: Type.String(),
});
export type AmieEditResponse = Static<typeof AmieEditResponse>;

export const AmieDesignBrief = strictObject({
  goal: Type.Optional(
    Type.Union([
      Type.Literal("winback"),
      Type.Literal("launch"),
      Type.Literal("newsletter"),
      Type.Literal("promo"),
      Type.Literal("welcome"),
    ]),
  ),
  tone: Type.Optional(
    Type.Union([
      Type.Literal("warm"),
      Type.Literal("clinical"),
      Type.Literal("playful"),
    ]),
  ),
  density: Type.Optional(
    Type.Union([
      Type.Literal("airy"),
      Type.Literal("standard"),
      Type.Literal("dense"),
    ]),
  ),
  heroStyle: Type.Optional(
    Type.Union([
      Type.Literal("bigImage"),
      Type.Literal("headlineFirst"),
      Type.Literal("productFirst"),
    ]),
  ),
  ctaText: Type.Optional(Type.String()),
  ctaUrl: Type.Optional(HttpOrLiquidUrl),
});
export type AmieDesignBrief = Static<typeof AmieDesignBrief>;

export const AmieBlockSkeleton = strictObject({
  blockTypes: Type.Array(Type.String()),
  notes: Type.Optional(Type.String()),
});
export type AmieBlockSkeleton = Static<typeof AmieBlockSkeleton>;

export const AmieComposeRequest = strictObject({
  workspaceId: Type.String(),
  prompt: Type.String({ minLength: 1 }),
  images: Type.Optional(
    Type.Array(
      strictObject({
        url: HttpUrl,
        name: Type.Optional(Type.String()),
        alt: Type.Optional(Type.String()),
      }),
    ),
  ),
  currentBlocks: Type.Optional(
    Type.Array(AmieBlockSpec, { maxItems: AMIE_MAX_BLOCKS }),
  ),
  currentSubject: Type.Optional(Type.String()),
  currentPreviewText: Type.Optional(Type.String()),
  seedBlocks: Type.Optional(
    Type.Array(AmieBlockSpec, { maxItems: AMIE_MAX_BLOCKS }),
  ),
  designBrief: Type.Optional(AmieDesignBrief),
  conversation: Type.Optional(Type.Array(AmieComposerConversationMessage)),
  referenceSkeleton: Type.Optional(AmieBlockSkeleton),
});
export type AmieComposeRequest = Static<typeof AmieComposeRequest>;

export const AmieGenerateImageInstruction = strictObject({
  generateImage: strictObject({
    prompt: Type.String({ minLength: 1 }),
    aspect: Type.Union([
      Type.Literal("16:9"),
      Type.Literal("1:1"),
      Type.Literal("4:5"),
    ]),
    slot: Type.Integer({ minimum: 0, maximum: AMIE_MAX_BLOCKS - 1 }),
  }),
});
export type AmieGenerateImageInstruction = Static<
  typeof AmieGenerateImageInstruction
>;

export const AmieComposerModelOutput = strictObject({
  subject: AmieSubjectText,
  previewText: AmiePreviewText,
  blocks: Type.Array(AmieBlockSpec, { maxItems: AMIE_MAX_BLOCKS }),
  generateImages: Type.Optional(
    Type.Array(AmieGenerateImageInstruction, { maxItems: 3 }),
  ),
});
export type AmieComposerModelOutput = Static<typeof AmieComposerModelOutput>;

export const AmieCritiqueModelOutput = strictObject({
  subject: AmieSubjectText,
  previewText: AmiePreviewText,
  blocks: Type.Array(AmieBlockSpec, { maxItems: AMIE_MAX_BLOCKS }),
  designNotes: Type.String(),
});
export type AmieCritiqueModelOutput = Static<typeof AmieCritiqueModelOutput>;

export const AmieComposeResponse = strictObject({
  subject: Type.String(),
  previewText: Type.String(),
  blocks: Type.Array(AmieBlockSpec),
  html: Type.String(),
  designNotes: Type.String(),
  warnings: Type.Optional(Type.Array(Type.String())),
});
export type AmieComposeResponse = Static<typeof AmieComposeResponse>;

export const AmieImportHtmlRequest = strictObject({
  workspaceId: Type.String(),
  html: Type.String({ minLength: 1 }),
});
export type AmieImportHtmlRequest = Static<typeof AmieImportHtmlRequest>;

export const AmieAssembleRequest = strictObject({
  workspaceId: Type.String(),
  blocks: Type.Array(AmieBlockSpec, { maxItems: AMIE_MAX_BLOCKS }),
});
export type AmieAssembleRequest = Static<typeof AmieAssembleRequest>;

export const AmieAssembleResponse = strictObject({ html: Type.String() });
export type AmieAssembleResponse = Static<typeof AmieAssembleResponse>;

export const AmieSanitizeHtmlRequest = strictObject({
  workspaceId: Type.String(),
  html: Type.String({ minLength: 1 }),
});
export type AmieSanitizeHtmlRequest = Static<typeof AmieSanitizeHtmlRequest>;

export const AmieSanitizeHtmlResponse = strictObject({ html: Type.String() });
export type AmieSanitizeHtmlResponse = Static<typeof AmieSanitizeHtmlResponse>;

export const AmieComposerConfigResponse = strictObject({
  enabled: Type.Boolean(),
  imageGenerationEnabled: Type.Boolean(),
});
export type AmieComposerConfigResponse = Static<
  typeof AmieComposerConfigResponse
>;

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

function tagEnd(html: string, start: number): number | null {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return null;
}

function isTagNameBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s/>]/.test(character);
}

function stripEventHandlerAttributes(tag: string): string {
  if (!/^<\s*[a-z]/i.test(tag)) return tag;
  const withoutHandlers = tag.replace(
    /\s+on[a-z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi,
    "",
  );
  if (!/^<\s*img(?:\s|\/?>)/i.test(withoutHandlers)) return withoutHandlers;
  return withoutHandlers.replace(
    /\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    (attribute, doubleQuoted, singleQuoted, unquoted) => {
      const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
      return /^https?:\/\//i.test(value) ? attribute : "";
    },
  );
}

/** Removes executable script elements and inline handlers from pasted HTML. */
export function sanitizeAmieHtml(html: string): string {
  const lowerHtml = html.toLowerCase();
  let sanitized = "";
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) {
      sanitized += html.slice(cursor);
      break;
    }
    sanitized += html.slice(cursor, tagStart);
    const isScriptStart =
      lowerHtml.startsWith("<script", tagStart) &&
      isTagNameBoundary(html[tagStart + "<script".length]);
    const isScriptEnd =
      lowerHtml.startsWith("</script", tagStart) &&
      isTagNameBoundary(html[tagStart + "</script".length]);
    if (isScriptStart) {
      const openingTagEnd = tagEnd(html, tagStart + 1);
      if (openingTagEnd === null) break;
      let closingTagStart = lowerHtml.indexOf("</script", openingTagEnd + 1);
      while (
        closingTagStart !== -1 &&
        !isTagNameBoundary(html[closingTagStart + "</script".length])
      ) {
        closingTagStart = lowerHtml.indexOf("</script", closingTagStart + 1);
      }
      if (closingTagStart === -1) break;
      const closingTagEnd = tagEnd(html, closingTagStart + 2);
      cursor = closingTagEnd === null ? html.length : closingTagEnd + 1;
      continue;
    }
    const end = tagEnd(html, tagStart + 1);
    if (end === null) {
      sanitized += html.slice(tagStart);
      break;
    }
    if (!isScriptEnd) {
      sanitized += stripEventHandlerAttributes(html.slice(tagStart, end + 1));
    }
    cursor = end + 1;
  }
  return sanitized;
}
