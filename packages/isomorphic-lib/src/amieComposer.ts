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

export const AmieImageBlock = strictObject({
  type: Type.Literal("image"),
  params: strictObject({
    src: HttpUrl,
    alt: Type.String(),
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 1200 })),
    href: Type.Optional(HttpUrl),
  }),
});

export const AmieHeroImageBlock = strictObject({
  type: Type.Literal("heroImage"),
  params: strictObject({
    src: HttpUrl,
    alt: Type.String(),
    headline: Type.Optional(Type.String()),
    href: Type.Optional(HttpUrl),
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
  AmieImageBlock,
  AmieHeroImageBlock,
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
export type AmieParagraphParams = Static<typeof AmieParagraphBlock>["params"];
export type AmieCtaButtonParams = Static<typeof AmieCtaButtonBlock>["params"];
export type AmieProductCardParams = Static<
  typeof AmieProductCardBlock
>["params"];
export type AmieImageParams = Static<typeof AmieImageBlock>["params"];
export type AmieHeroImageParams = Static<
  typeof AmieHeroImageBlock
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
  images: Type.Optional(
    Type.Array(
      strictObject({
        url: HttpUrl,
        alt: Type.Optional(Type.String()),
      }),
    ),
  ),
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

export const AmieAssembleRequest = strictObject({
  workspaceId: Type.String(),
  blocks: Type.Array(AmieBlockSpec),
});

export type AmieAssembleRequest = Static<typeof AmieAssembleRequest>;

export const AmieAssembleResponse = strictObject({
  html: Type.String(),
});

export type AmieAssembleResponse = Static<typeof AmieAssembleResponse>;

export const AmieSanitizeHtmlRequest = strictObject({
  workspaceId: Type.String(),
  html: Type.String({ minLength: 1 }),
});

export type AmieSanitizeHtmlRequest = Static<typeof AmieSanitizeHtmlRequest>;

export const AmieSanitizeHtmlResponse = strictObject({
  html: Type.String(),
});

export type AmieSanitizeHtmlResponse = Static<typeof AmieSanitizeHtmlResponse>;

export const AmieComposerConfigResponse = strictObject({
  enabled: Type.Boolean(),
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
      if (character === quote) {
        quote = null;
      }
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
  if (!/^<\s*[a-z]/i.test(tag)) {
    return tag;
  }

  const withoutHandlers = tag.replace(
    /\s+on[a-z0-9_:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi,
    "",
  );
  if (!/^<\s*img(?:\s|\/?>)/i.test(withoutHandlers)) {
    return withoutHandlers;
  }
  return withoutHandlers.replace(
    /\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    (attribute, doubleQuoted, singleQuoted, unquoted) => {
      const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
      return /^https?:\/\//i.test(value) ? attribute : "";
    },
  );
}

/**
 * Removes executable script elements and inline event handlers while leaving
 * all other pasted email HTML byte-for-byte unchanged.
 */
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
      if (openingTagEnd === null) {
        break;
      }

      let closingTagStart = lowerHtml.indexOf("</script", openingTagEnd + 1);
      while (
        closingTagStart !== -1 &&
        !isTagNameBoundary(html[closingTagStart + "</script".length])
      ) {
        closingTagStart = lowerHtml.indexOf("</script", closingTagStart + 1);
      }
      if (closingTagStart === -1) {
        break;
      }

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
