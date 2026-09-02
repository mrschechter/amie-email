import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ResponseStream,
} from "@aws-sdk/client-bedrock-runtime";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AssetStorageClient, storage } from "backend-lib/src/blobStorage";
import backendConfig from "backend-lib/src/config";
import logger from "backend-lib/src/logger";
import { assembleEmail } from "backend-lib/src/messaging/amieBlocks";
import {
  cleanAmieModelStyles,
  extractFirstJsonObject,
} from "backend-lib/src/messaging/amieComposer";
import {
  AmieImageAspect,
  generateAndStoreImage,
  GeneratedImage,
} from "backend-lib/src/messaging/amieImageGeneration";
import {
  normalizeLiquid,
  validateLiquid,
} from "backend-lib/src/messaging/amieLiquid";
import { findAllUserPropertyResources } from "backend-lib/src/userProperties";
import { FastifyInstance } from "fastify";
import {
  AmieAssembleRequest,
  AmieAssembleResponse,
  AmieBlockSpec,
  AmieComposerConfigResponse,
  AmieComposeRequest,
  AmieComposerErrorResponse,
  AmieComposeResponse,
  AmieComposerModelOutput,
  AmieComposerReasonCode,
  AmieCritiqueModelOutput,
  AmieImportHtmlRequest,
  AmieSanitizeHtmlRequest,
  AmieSanitizeHtmlResponse,
  sanitizeAmieHtml,
} from "isomorphic-lib/src/amieComposer";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";

import config from "../config";

const BEDROCK_REGION = "us-east-1";
const MAX_MODEL_OUTPUT_TOKENS = 4096;
const RAW_MODEL_OUTPUT_LOG_LENGTH = 300;
const CORRECTIVE_INSTRUCTION =
  "Return ONLY the JSON object, no fences, matching the schema";
const PENDING_GENERATED_IMAGE_URL = "https://generated.amie.invalid/pending";

type AmieComposeRequestWithFallback = AmieComposeRequest & {
  currentSubject?: string;
  currentPreviewText?: string;
};

export interface BedrockInvoker {
  send(command: InvokeModelCommand): Promise<{ body?: Uint8Array }>;
}

export interface BedrockStreamInvoker {
  send(
    command: InvokeModelWithResponseStreamCommand,
  ): Promise<{ body?: AsyncIterable<ResponseStream> }>;
}

export interface AmieComposerControllerOptions {
  bedrockClient?: BedrockInvoker;
  bedrockStreamClient?: BedrockStreamInvoker;
  enabled?: boolean;
  modelId?: string;
  fastModelId?: string;
  userPropertyNames?: (workspaceId: string) => Promise<string[]>;
  storageClient?: AssetStorageClient;
  imageGenerationEnabled?: boolean;
  imageGenerator?: (options: {
    prompt: string;
    aspect: AmieImageAspect;
  }) => Promise<GeneratedImage>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ComposerModelError extends Error {
  constructor(
    public readonly reasonCode: AmieComposerReasonCode,
    public readonly underlyingError: unknown,
    public readonly rawModelOutput = "",
  ) {
    super(errorMessage(underlyingError));
    this.name = "ComposerModelError";
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

const RECIPE_SKELETONS = `Recipe priors (vary these; they are not fixed templates):
- Winback: header, heroHeading, paragraph, twoColumn or productCard, ctaButton, quoteCallout, footer.
- Product launch: header, heroImage or heroHeading, statsRow, twoColumn, ctaButton, footer.
- Educational newsletter: header, heroHeading, paragraph, bulletList, sectionBreak, quoteCallout, ctaButton, footer.
- Promo/sale: header, heroImage, heroHeading, productCard, ctaButton, spacer, footer.
- Welcome: header, heroHeading, paragraph, bulletList, ctaButton, testimonial, footer.`;

function systemPrompt(
  request: AmieComposeRequest,
  imageGenerationAvailable: boolean,
  knownUserProperties: readonly string[],
): string {
  const imageInstruction = request.images?.length
    ? `The workspace asset library is ${JSON.stringify(request.images)}. Use ONLY those exact image URLs, or the fixed pending URL described below for a requested generated image.`
    : "The workspace asset library is empty. Do not invent image URLs.";
  const generationInstruction = imageGenerationAvailable
    ? `You may request at most 3 generated images with top-level generateImages entries shaped {"generateImage":{"prompt":string,"aspect":"16:9"|"1:1"|"4:5","slot":blockIndex}}. Put ${PENDING_GENERATED_IMAGE_URL} in that image-bearing block until the server replaces it. Make each prompt describe only the scene; the server adds Amie's fixed photography style.`
    : "Image generation is unavailable. Do not emit generateImages. Use library images or an image-free layout.";

  return `You are Amie's email art director and copywriter. Produce the ENTIRE designed block tree: block choice and order, imagery, section backgrounds, alignment, padding, type scale, and button variants.

Return STRICT JSON only with exactly this shape: {"subject":string,"previewText":string,"blocks":BlockSpec[],"generateImages"?:GenerateImageInstruction[]}.
Subject must be at most 60 characters and previewText must be non-empty. Use at most 12 blocks. A footer with addressLine and unsubscribe is mandatory. Put a clear CTA above the fold.

Block schema (every block also accepts optional style):
${JSON.stringify(AmieComposerModelOutput.properties.blocks)}

Style tokens ONLY: background ivory(#FAF8F5), blush(#F5E6E0), white(#FFFFFF), teal(#2D7A7A), or sage(#9CAF88); align left|center; padding tight|normal|loose; textSize s|m|l; buttonVariant primary|secondary|roseGold. sectionBreak changes the background for following blocks until another sectionBreak. Use buttonVariant only where a CTA exists.

Markdown-lite is allowed in paragraph, heroHeading, bulletList items, and quoteCallout: **bold**, *italic*, [text](https://url), and line breaks. Never emit HTML in those fields.

rawHtml is reserved for the server's failed-import fallback. Never emit rawHtml during compose, revision, or successful import conversion.

Block intent: header is brand chrome; heroHeading is the lead; paragraph is editorial copy; ctaButton is a primary action; productCard is a product feature; image is standalone; heroImage is full bleed; testimonial is a customer statement; divider separates; footer is mandatory compliance; twoColumn pairs image and copy with imageSide, optional heading and CTA; bulletList has heading and items; statsRow has 2-4 value/label items; quoteCallout is an editorial pull quote; spacer is 16|24|32|48px; sectionBreak starts a branded background section.

${RECIPE_SKELETONS}
Use recipe skeletons as priors and vary structure between composes. Convert the optional design brief into layout decisions: ${JSON.stringify(request.designBrief ?? {})}. If seedBlocks are supplied, preserve their broad skeleton while filling and styling the complete design: ${JSON.stringify(request.seedBlocks ?? [])}.

Amie's voice is warm, conversational, specific, empathetic, and practically clear for women ages 35–60. No corporate boilerplate, empty wellness language, pressure tactics, hype, or unsupported medical claims.

Liquid personalization rules:
- The workspace's exact user-property catalog is ${JSON.stringify(knownUserProperties)}.
- Reference only names in that catalog and always through user.*, never as a bare variable.
- Every user property must have a default. Exact syntax: {{ user.firstName | default: 'there' }}.
- Link examples, when those names exist in the catalog: {{ user.checkoutUrl | default: 'https://tryamie.com' }} and {{ user.paymentUpdateUrl | default: 'https://tryamie.com' }}.
- Never HTML-entity-encode quotes inside {{ ... }} or {% ... %}.

${imageInstruction}
${generationInstruction}

The footer unsubscribe field is its visible label; the server provides its URL and replaces addressLine with the configured mailing address. Never invent an address.

For revisions, preserve existing structure, images, and ALL style values unless the latest user explicitly asks to change styling or layout. Make only the requested changes. referenceSkeleton is a reserved extension point for future reference-design intake: ${JSON.stringify(request.referenceSkeleton ?? null)}.`;
}

function critiquePrompt(): string {
  return `You are a strict, inexpensive email design QA pass. Return STRICT JSON only: {"subject":string,"previewText":string,"blocks":BlockSpec[],"designNotes":string}. Keep good work unchanged and automatically fix only these issues: CTA present and above the fold, footer/address block present, no more than 12 blocks, non-empty alt text on every image, brand style tokens only, subject at most 60 characters, and non-empty preview text. designNotes is one short user-facing line. Schema: ${JSON.stringify(AmieCritiqueModelOutput)}.`;
}

function modelMessages(
  request: AmieComposeRequest,
): { role: "user" | "assistant"; content: string }[] {
  const isRevision = request.currentBlocks !== undefined;
  const context = isRevision
    ? [
        "This is a revision.",
        `Original brief: ${request.prompt}`,
        `Current blocks including user style edits: ${JSON.stringify(request.currentBlocks)}`,
        "Apply the latest conversation request minimally and return the complete revised design.",
      ].join("\n")
    : request.prompt;
  return [...(request.conversation ?? []), { role: "user", content: context }];
}

const QUICK_ACTION =
  /\b(shorten(?: it)?|add (?:an? )?offer|sms version|subject (?:line |tweak|option)|tweak (?:the )?subject)\b/i;

function wordCount(value: unknown): number {
  return JSON.stringify(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function selectComposerModelId(
  request: AmieComposeRequest,
  modelId: string,
  fastModelId: string,
): string {
  const latest = request.conversation?.at(-1)?.content ?? request.prompt;
  if (
    request.currentBlocks !== undefined ||
    QUICK_ACTION.test(latest) ||
    (request.seedBlocks !== undefined && wordCount(request.seedBlocks) < 2500)
  ) {
    return fastModelId;
  }
  return modelId;
}

function decodeModelText(body: Uint8Array | undefined): string {
  if (!body) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      new Error("Bedrock response did not include a body"),
    );
  }
  const bodyText = new TextDecoder().decode(body);
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      error,
      bodyText,
    );
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("content" in payload) ||
    !Array.isArray(payload.content)
  ) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      new Error("Bedrock response body did not contain a content array"),
      bodyText,
    );
  }
  const textPart = payload.content.find(
    (part: unknown): part is { type: "text"; text: string } =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string",
  );
  if (!textPart) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      new Error("Bedrock response did not contain a text output"),
      bodyText,
    );
  }
  return textPart.text;
}

function parsedJson(modelText: string): unknown {
  const jsonObject = extractFirstJsonObject(modelText);
  if (jsonObject === null) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      new SyntaxError("Model output did not contain a balanced JSON object"),
      modelText,
    );
  }
  try {
    return cleanAmieModelStyles(JSON.parse(jsonObject));
  } catch (error) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      error,
      modelText,
    );
  }
}

function validationFailure(
  modelText: string,
  errors: { path: string; message: string }[],
): never {
  const first = errors[0];
  const detail = first ? ` at ${first.path}: ${first.message}` : "";
  const error = new Error(`Model output failed schema validation${detail}`);
  error.name = "SchemaValidationError";
  throw new ComposerModelError(
    AmieComposerReasonCode.InvalidModelResponse,
    error,
    modelText,
  );
}

function parseComposeOutput(modelText: string): AmieComposerModelOutput {
  const validated = schemaValidate(
    parsedJson(modelText),
    AmieComposerModelOutput,
  );
  if (validated.isErr()) validationFailure(modelText, validated.error);
  return validated.value;
}

function parseCritiqueOutput(modelText: string): AmieCritiqueModelOutput {
  const validated = schemaValidate(
    parsedJson(modelText),
    AmieCritiqueModelOutput,
  );
  if (validated.isErr()) validationFailure(modelText, validated.error);
  return validated.value;
}

async function invokeModel({
  bedrockClient,
  modelId,
  system,
  messages,
  temperature = 0.3,
  previousModelOutput = "",
}: {
  bedrockClient: BedrockInvoker;
  modelId: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  temperature?: number;
  previousModelOutput?: string;
}): Promise<string> {
  try {
    const response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId,
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: MAX_MODEL_OUTPUT_TOKENS,
          temperature,
          system,
          messages,
        }),
      }),
    );
    return decodeModelText(response.body);
  } catch (error) {
    if (error instanceof ComposerModelError) throw error;
    throw new ComposerModelError(
      AmieComposerReasonCode.ModelFailure,
      error,
      previousModelOutput,
    );
  }
}

async function draftOutput({
  request,
  bedrockClient,
  modelId,
  imageGenerationAvailable,
  knownUserProperties,
}: {
  request: AmieComposeRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
  imageGenerationAvailable: boolean;
  knownUserProperties: readonly string[];
}): Promise<AmieComposerModelOutput> {
  const messages = modelMessages(request);
  const system = systemPrompt(
    request,
    imageGenerationAvailable,
    knownUserProperties,
  );
  const first = await invokeModel({ bedrockClient, modelId, system, messages });
  try {
    return parseComposeOutput(first);
  } catch (error) {
    if (!(error instanceof ComposerModelError)) throw error;
    const retry = await invokeModel({
      bedrockClient,
      modelId,
      system,
      previousModelOutput: first,
      messages: [
        ...messages,
        { role: "assistant", content: first },
        { role: "user", content: CORRECTIVE_INSTRUCTION },
      ],
    });
    return parseComposeOutput(retry);
  }
}

function imageUrl(block: AmieBlockSpec): string | undefined {
  if (block.type === "image" || block.type === "heroImage")
    return block.params.src;
  if (block.type === "twoColumn") return block.params.image.src;
  if (block.type === "productCard") return block.params.imageUrl;
  return undefined;
}

function withGeneratedImage(
  block: AmieBlockSpec,
  url: string,
  alt: string,
): AmieBlockSpec {
  if (block.type === "image" || block.type === "heroImage") {
    return { ...block, params: { ...block.params, src: url, alt } };
  }
  if (block.type === "twoColumn") {
    return {
      ...block,
      params: {
        ...block.params,
        image: { ...block.params.image, src: url, alt },
      },
    };
  }
  if (block.type === "productCard") {
    return { ...block, params: { ...block.params, imageUrl: url } };
  }
  return { type: "image", params: { src: url, alt }, style: block.style };
}

function removeUnavailablePendingBlocks(
  blocks: AmieBlockSpec[],
): AmieBlockSpec[] {
  return blocks.filter(
    (block) => imageUrl(block) !== PENDING_GENERATED_IMAGE_URL,
  );
}

async function fulfillGeneratedImages({
  output,
  workspaceId,
  storageClient,
  imageGenerator,
}: {
  output: AmieComposerModelOutput;
  workspaceId: string;
  storageClient: AssetStorageClient;
  imageGenerator?: AmieComposerControllerOptions["imageGenerator"];
}): Promise<{ blocks: AmieBlockSpec[]; urls: string[] }> {
  let blocks = [...output.blocks];
  const urls: string[] = [];
  const generated = await Promise.all(
    (output.generateImages?.slice(0, 3) ?? []).map(async (entry) => {
      const instruction = entry.generateImage;
      try {
        const asset = await generateAndStoreImage({
          workspaceId,
          prompt: instruction.prompt,
          aspect: instruction.aspect,
          storageClient,
          ...(imageGenerator ? { generate: imageGenerator } : {}),
        });
        return { asset, instruction };
      } catch {
        return null;
      }
    }),
  );
  for (const result of generated) {
    if (result) {
      const { asset, instruction } = result;
      urls.push(asset.url);
      const target = blocks[instruction.slot];
      if (target) {
        blocks[instruction.slot] = withGeneratedImage(
          target,
          asset.url,
          asset.alt,
        );
      }
    }
  }
  blocks = removeUnavailablePendingBlocks(blocks);
  return { blocks, urls };
}

function allowedImageBlocks(
  blocks: AmieBlockSpec[],
  allowedUrls: Set<string>,
): AmieBlockSpec[] {
  return blocks.flatMap((block) => {
    const url = imageUrl(block);
    if (!url || allowedUrls.has(url)) return [block];
    if (block.type === "productCard") {
      const params = { ...block.params };
      delete params.imageUrl;
      return [{ ...block, params }];
    }
    return [];
  });
}

function mentionsStyleChange(request: AmieComposeRequest): boolean {
  const latest = request.conversation?.at(-1)?.content ?? "";
  return /\b(style|design|layout|color|background|align|padding|spacing|button)\b/i.test(
    latest,
  );
}

function preserveRevisionStyles(
  request: AmieComposeRequest,
  blocks: AmieBlockSpec[],
): AmieBlockSpec[] {
  if (!request.currentBlocks || mentionsStyleChange(request)) return blocks;
  const matched = new Set<number>();
  return blocks.map((block) => {
    const priorIndex = request.currentBlocks?.findIndex(
      (candidate, index) =>
        candidate.type === block.type && !matched.has(index),
    );
    if (priorIndex === undefined || priorIndex < 0) return block;
    matched.add(priorIndex);
    const prior = request.currentBlocks?.[priorIndex];
    return prior?.style ? { ...block, style: prior.style } : block;
  });
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return fallback;
  return trimmed;
}

function semanticAudit(
  output: Omit<AmieCritiqueModelOutput, "designNotes"> & {
    designNotes?: string;
  },
  request: AmieComposeRequest,
): AmieCritiqueModelOutput {
  let blocks = output.blocks.slice(0, 12).map((block) => {
    if (
      (block.type === "image" || block.type === "heroImage") &&
      !block.params.alt.trim()
    ) {
      return {
        ...block,
        params: { ...block.params, alt: "Amie product and lifestyle" },
      };
    }
    if (block.type === "twoColumn" && !block.params.image.alt.trim()) {
      return {
        ...block,
        params: {
          ...block.params,
          image: { ...block.params.image, alt: "Amie product and lifestyle" },
        },
      };
    }
    return block;
  });
  if (!blocks.some((block) => block.type === "footer")) {
    const footer: AmieBlockSpec = {
      type: "footer",
      params: {
        addressLine: "Configured by server",
        unsubscribe: "Unsubscribe",
      },
    };
    blocks =
      blocks.length === 12
        ? [...blocks.slice(0, 11), footer]
        : [...blocks, footer];
  }
  const hasEarlyCta = blocks
    .slice(0, 6)
    .some(
      (block) =>
        block.type === "ctaButton" ||
        (block.type === "twoColumn" && block.params.cta),
    );
  if (!hasEarlyCta) {
    const cta: AmieBlockSpec = {
      type: "ctaButton",
      params: {
        label: nonEmpty(request.designBrief?.ctaText, "Learn more"),
        url: nonEmpty(request.designBrief?.ctaUrl, "https://tryamie.com"),
      },
      style: { align: "center", buttonVariant: "primary" },
    };
    const insertion = Math.min(
      4,
      Math.max(
        1,
        blocks.findIndex((block) => block.type === "footer"),
      ),
    );
    blocks.splice(insertion, 0, cta);
    blocks = blocks.slice(0, 12);
    if (!blocks.some((block) => block.type === "footer")) {
      blocks[blocks.length - 1] = {
        type: "footer",
        params: {
          addressLine: "Configured by server",
          unsubscribe: "Unsubscribe",
        },
      };
    }
  }
  return {
    subject: nonEmpty(
      output.subject.trim().slice(0, 60),
      "A thoughtful update from Amie",
    ),
    previewText: nonEmpty(output.previewText, "A thoughtful update from Amie."),
    blocks,
    designNotes: nonEmpty(
      output.designNotes,
      "Checked hierarchy, imagery, CTA placement, and compliance.",
    ),
  };
}

async function critiqueDesign({
  draft,
  request,
  bedrockClient,
  modelId,
}: {
  draft: AmieComposerModelOutput;
  request: AmieComposeRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
}): Promise<AmieCritiqueModelOutput> {
  try {
    const text = await invokeModel({
      bedrockClient,
      modelId,
      system: critiquePrompt(),
      temperature: 0.1,
      messages: [{ role: "user", content: JSON.stringify(draft) }],
    });
    return semanticAudit(parseCritiqueOutput(text), request);
  } catch {
    return semanticAudit({ ...draft }, request);
  }
}

function transformStringValues(
  value: unknown,
  transform: (text: string) => string,
): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) {
    return value.map((item) => transformStringValues(item, transform));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        transformStringValues(item, transform),
      ]),
    );
  }
  return value;
}

function transformBlockStrings(
  blocks: AmieBlockSpec[],
  transform: (text: string) => string,
): AmieBlockSpec[] {
  return blocks.map((block) => {
    const validated = schemaValidate(
      transformStringValues(block, transform),
      AmieBlockSpec,
    );
    if (validated.isErr()) {
      throw new Error("String-only block transformation changed its schema");
    }
    return validated.value;
  });
}

function normalizeBlocks(
  blocks: AmieBlockSpec[],
  knownUserProperties: readonly string[],
): AmieBlockSpec[] {
  return transformBlockStrings(blocks, (text) =>
    normalizeLiquid(text, knownUserProperties),
  );
}

function withoutLiquid(text: string): string {
  return text.replace(/{{[\s\S]*?}}|{%[\s\S]*?%}/g, "");
}

function checkedFallback(
  preferred: string | undefined,
  fallback: string,
  knownUserProperties: readonly string[],
): string {
  const normalized = normalizeLiquid(
    preferred ?? fallback,
    knownUserProperties,
  );
  return validateLiquid(normalized, knownUserProperties) === null
    ? normalized
    : fallback;
}

function finalizeLiquid(
  output: AmieCritiqueModelOutput,
  request: AmieComposeRequestWithFallback,
  knownUserProperties: readonly string[],
  onChecking?: () => void,
): AmieComposeResponse {
  let subject = normalizeLiquid(output.subject, knownUserProperties);
  let previewText = normalizeLiquid(output.previewText, knownUserProperties);
  let blocks = normalizeBlocks(output.blocks, knownUserProperties);
  const warnings: string[] = [];
  const assembledBody = assembleEmail(blocks, "");
  onChecking?.();

  const subjectError = validateLiquid(subject, knownUserProperties);
  if (subjectError) {
    subject = checkedFallback(
      request.currentSubject,
      "A thoughtful update from Amie",
      knownUserProperties,
    );
    warnings.push(
      `Liquid check failed for the subject; kept the last valid subject. ${subjectError}`,
    );
  }

  const previewError = validateLiquid(previewText, knownUserProperties);
  if (previewError) {
    previewText = checkedFallback(
      request.currentPreviewText,
      "A thoughtful update from Amie.",
      knownUserProperties,
    );
    warnings.push(
      `Liquid check failed for preview text; kept the last valid preview text. ${previewError}`,
    );
  }

  const bodyError = validateLiquid(assembledBody, knownUserProperties);
  if (bodyError) {
    const priorBlocks = request.currentBlocks
      ? normalizeBlocks(request.currentBlocks, knownUserProperties)
      : undefined;
    const priorError = priorBlocks
      ? validateLiquid(
          assembleEmail(priorBlocks, previewText),
          knownUserProperties,
        )
      : "No prior draft";
    blocks =
      priorBlocks && priorError === null
        ? priorBlocks
        : transformBlockStrings(blocks, withoutLiquid);
    warnings.push(
      `Liquid check failed for the body; kept the last valid body. ${bodyError}`,
    );
  }

  return {
    ...output,
    subject,
    previewText,
    blocks,
    html: assembleEmail(blocks, previewText),
    ...(warnings.length ? { warnings } : {}),
  };
}

export type AmieComposeStage = "Writing…" | "Assembling" | "Checking Liquid";

export async function composeAmieEmail({
  request,
  bedrockClient,
  modelId,
  imageGenerationAvailable = false,
  storageClient,
  imageGenerator,
  knownUserProperties = [],
  onStage,
}: {
  request: AmieComposeRequestWithFallback;
  bedrockClient: BedrockInvoker;
  modelId: string;
  imageGenerationAvailable?: boolean;
  storageClient?: AssetStorageClient;
  imageGenerator?: AmieComposerControllerOptions["imageGenerator"];
  knownUserProperties?: readonly string[];
  onStage?: (stage: AmieComposeStage) => void;
}): Promise<AmieComposeResponse> {
  onStage?.("Writing…");
  const drafted = await draftOutput({
    request,
    bedrockClient,
    modelId,
    imageGenerationAvailable,
    knownUserProperties,
  });
  const generated =
    imageGenerationAvailable && storageClient
      ? await fulfillGeneratedImages({
          output: drafted,
          workspaceId: request.workspaceId,
          storageClient,
          imageGenerator,
        })
      : { blocks: removeUnavailablePendingBlocks(drafted.blocks), urls: [] };
  const allowedUrls = new Set([
    ...(request.images?.map((item) => item.url) ?? []),
    ...generated.urls,
  ]);
  const safeDraft = {
    ...drafted,
    blocks: allowedImageBlocks(generated.blocks, allowedUrls),
  };
  const critiqued = await critiqueDesign({
    draft: safeDraft,
    request,
    bedrockClient,
    modelId,
  });
  const finalBlocks = preserveRevisionStyles(
    request,
    allowedImageBlocks(critiqued.blocks, allowedUrls),
  );
  const audited = semanticAudit({ ...critiqued, blocks: finalBlocks }, request);
  onStage?.("Assembling");
  return finalizeLiquid(audited, request, knownUserProperties, () =>
    onStage?.("Checking Liquid"),
  );
}

async function importHtml({
  request,
  bedrockClient,
  modelId,
  knownUserProperties,
}: {
  request: AmieImportHtmlRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
  knownUserProperties: readonly string[];
}): Promise<AmieComposeResponse> {
  const sanitized = sanitizeAmieHtml(request.html);
  const composeRequest: AmieComposeRequest = {
    workspaceId: request.workspaceId,
    prompt: `Convert this pasted email HTML into the closest editable Amie block design. Preserve meaning and links, use no invented image URLs, and include the mandatory footer. HTML:\n${sanitized}`,
  };
  try {
    return await composeAmieEmail({
      request: composeRequest,
      bedrockClient,
      modelId,
      knownUserProperties,
    });
  } catch {
    const blocks: AmieBlockSpec[] = [
      { type: "rawHtml", params: { html: sanitized } },
    ];
    return {
      subject: "Imported email",
      previewText: "Imported email content.",
      blocks,
      html: assembleEmail(blocks, "Imported email content."),
      designNotes: "Kept the original HTML as one safe fallback block.",
    };
  }
}

async function streamAssistantReply({
  request,
  bedrockClient,
  modelId,
  onChunk,
}: {
  request: AmieComposeRequest;
  bedrockClient: BedrockStreamInvoker;
  modelId: string;
  onChunk: (text: string) => void;
}): Promise<void> {
  const latest = request.conversation?.at(-1)?.content ?? request.prompt;
  const response = await bedrockClient.send(
    new InvokeModelWithResponseStreamCommand({
      modelId,
      accept: "application/json",
      contentType: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 80,
        temperature: 0.2,
        system:
          "Write one short, warm sentence acknowledging the requested email edit. Use present tense while work is in progress. Return only that sentence.",
        messages: [{ role: "user", content: latest }],
      }),
    }),
  );
  if (!response.body) throw new Error("Bedrock stream did not include a body");
  for await (const event of response.body) {
    if (!event.chunk?.bytes) continue;
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(event.chunk.bytes),
    );
    if (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      payload.type === "content_block_delta" &&
      "delta" in payload &&
      typeof payload.delta === "object" &&
      payload.delta !== null &&
      "type" in payload.delta &&
      payload.delta.type === "text_delta" &&
      "text" in payload.delta &&
      typeof payload.delta.text === "string" &&
      payload.delta.text.length > 0
    ) {
      onChunk(payload.delta.text);
    }
  }
}

async function defaultUserPropertyNames(
  workspaceId: string,
): Promise<string[]> {
  const resources = await findAllUserPropertyResources({ workspaceId });
  return resources.map((property) => property.name).sort();
}

// Fastify detects the returned promise and completes plugin registration.
// eslint-disable-next-line @typescript-eslint/require-await
export default async function amieComposerController(
  fastify: FastifyInstance,
  options: AmieComposerControllerOptions,
) {
  const configured = config();
  const backend = backendConfig();
  const enabled = options.enabled ?? configured.amieComposerEnabled;
  const modelId = options.modelId ?? configured.amieComposerModelId;
  const fastModelId = options.fastModelId ?? configured.amieComposerModelIdFast;
  const runtimeClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  const bedrockClient = options.bedrockClient ?? {
    send: (command: InvokeModelCommand) => runtimeClient.send(command),
  };
  const bedrockStreamClient = options.bedrockStreamClient ?? {
    send: (command: InvokeModelWithResponseStreamCommand) =>
      runtimeClient.send(command),
  };
  const userPropertyNames =
    options.userPropertyNames ?? defaultUserPropertyNames;
  const loadUserPropertyNames = async (workspaceId: string) => {
    try {
      return await userPropertyNames(workspaceId);
    } catch (error) {
      logger().warn(
        { workspaceId, errorMessage: errorMessage(error) },
        "Amie composer could not load the user-property catalog",
      );
      return [];
    }
  };
  const imageGenerationEnabled =
    options.imageGenerationEnabled ?? backend.amieImageGenEnabled;
  const providerHasKey =
    backend.amieImageGenProvider === "openai"
      ? Boolean(backend.openaiApiKey)
      : Boolean(backend.geminiApiKey);
  const imageGenerationAvailable =
    imageGenerationEnabled &&
    (Boolean(options.imageGenerator) || providerHasKey);
  /* eslint-disable @typescript-eslint/consistent-type-assertions -- AWS's
   * generic send overload satisfies the deliberately narrow storage seam. */
  const storageClient =
    options.storageClient ?? (storage() as unknown as AssetStorageClient);
  /* eslint-enable @typescript-eslint/consistent-type-assertions */

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/compose/config",
    {
      schema: {
        description: "Get the Amie composer feature configuration.",
        tags: ["Content"],
        response: { 200: AmieComposerConfigResponse },
      },
    },
    async (_request, reply) =>
      reply.status(200).send({
        enabled,
        imageGenerationEnabled: imageGenerationAvailable,
      }),
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/compose/assemble",
    {
      schema: {
        description: "Assemble Amie email blocks without invoking a model.",
        tags: ["Content"],
        body: AmieAssembleRequest,
        response: { 200: AmieAssembleResponse, 503: AmieComposerErrorResponse },
      },
    },
    async (request, reply) =>
      enabled
        ? reply.status(200).send({ html: assembleEmail(request.body.blocks) })
        : reply.status(503).send({
            message: "Amie composer is disabled.",
            reasonCode: AmieComposerReasonCode.Disabled,
          }),
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/compose/stream",
    {
      schema: {
        description:
          "Stream composer chat, progress, and the completed design.",
        tags: ["Content"],
        body: AmieComposeRequest,
      },
    },
    async (request, reply) => {
      if (!enabled) {
        return reply.status(503).send({
          message: "Amie composer is disabled.",
          reasonCode: AmieComposerReasonCode.Disabled,
        });
      }

      void reply.code(200);
      void reply.hijack();
      reply.raw.setHeader(
        "Content-Type",
        "application/x-ndjson; charset=utf-8",
      );
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      const sendEvent = (event: unknown) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      };
      const startedAt = Date.now();
      let stageStartedAt = startedAt;
      let currentStage = "thinking";
      const stageMs: Record<string, number> = {};
      const stageKey = (status: "Thinking…" | AmieComposeStage): string => {
        if (status === "Thinking…") return "thinking";
        if (status === "Writing…") return "writing";
        if (status === "Assembling") return "assemble";
        return "liquid";
      };
      const beginStage = (status: "Thinking…" | AmieComposeStage) => {
        const now = Date.now();
        if (status !== "Thinking…")
          stageMs[currentStage] = now - stageStartedAt;
        currentStage = stageKey(status);
        stageStartedAt = now;
        sendEvent({ type: "status", status });
      };

      try {
        beginStage("Thinking…");
        const knownUserProperties = await loadUserPropertyNames(
          request.body.workspaceId,
        );
        const selectedModelId = selectComposerModelId(
          request.body,
          modelId,
          fastModelId,
        );
        beginStage("Writing…");
        const composePromise = composeAmieEmail({
          request: request.body,
          bedrockClient,
          modelId: selectedModelId,
          imageGenerationAvailable,
          storageClient,
          imageGenerator: options.imageGenerator,
          knownUserProperties,
          onStage: (stage) => {
            if (stage !== "Writing…") beginStage(stage);
          },
        });
        const chatPromise = streamAssistantReply({
          request: request.body,
          bedrockClient: bedrockStreamClient,
          modelId: selectedModelId,
          onChunk: (text) => sendEvent({ type: "chunk", text }),
        }).catch((error: unknown) => {
          logger().warn(
            { errorMessage: errorMessage(error), model: selectedModelId },
            "Amie composer chat stream failed",
          );
        });
        const [response] = await Promise.all([composePromise, chatPromise]);
        stageMs[currentStage] = Date.now() - stageStartedAt;
        sendEvent({ type: "result", response });
        logger().info(
          {
            model: selectedModelId,
            ...stageMs,
            totalMs: Date.now() - startedAt,
          },
          "Amie composer timing",
        );
      } catch (error) {
        sendEvent({
          type: "error",
          message: "That change didn’t go through. Your draft is untouched.",
        });
        logger().error(
          {
            workspaceId: request.body.workspaceId,
            errorMessage: errorMessage(error),
          },
          "Amie composer stream failed",
        );
      } finally {
        reply.raw.end();
      }
      return reply;
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/compose/sanitize-html",
    {
      schema: {
        description: "Sanitize raw HTML for an Amie email template.",
        tags: ["Content"],
        body: AmieSanitizeHtmlRequest,
        response: {
          200: AmieSanitizeHtmlResponse,
          503: AmieComposerErrorResponse,
        },
      },
    },
    async (request, reply) =>
      enabled
        ? reply.status(200).send({ html: sanitizeAmieHtml(request.body.html) })
        : reply.status(503).send({
            message: "Amie composer is disabled.",
            reasonCode: AmieComposerReasonCode.Disabled,
          }),
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/compose/import-html",
    {
      schema: {
        description:
          "Best-effort conversion of pasted email HTML into Amie blocks.",
        tags: ["Content"],
        body: AmieImportHtmlRequest,
        response: { 200: AmieComposeResponse, 503: AmieComposerErrorResponse },
      },
    },
    async (request, reply) =>
      enabled
        ? reply.status(200).send(
            await importHtml({
              request: request.body,
              bedrockClient,
              modelId: fastModelId,
              knownUserProperties: await loadUserPropertyNames(
                request.body.workspaceId,
              ),
            }),
          )
        : reply.status(503).send({
            message: "Amie composer is disabled.",
            reasonCode: AmieComposerReasonCode.Disabled,
          }),
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/compose",
    {
      schema: {
        description: "Compose or revise a fully designed Amie email with AI.",
        tags: ["Content"],
        body: AmieComposeRequest,
        response: {
          200: AmieComposeResponse,
          502: AmieComposerErrorResponse,
          503: AmieComposerErrorResponse,
        },
      },
    },
    async (request, reply) => {
      if (!enabled) {
        return reply.status(503).send({
          message: "Amie composer is disabled.",
          reasonCode: AmieComposerReasonCode.Disabled,
        });
      }
      try {
        const startedAt = Date.now();
        const knownUserProperties = await loadUserPropertyNames(
          request.body.workspaceId,
        );
        const timings: Record<string, number> = {
          thinking: Date.now() - startedAt,
        };
        let stageStartedAt = Date.now();
        let currentStage = "writing";
        const selectedModelId = selectComposerModelId(
          request.body,
          modelId,
          fastModelId,
        );
        const response = await composeAmieEmail({
          request: request.body,
          bedrockClient,
          modelId: selectedModelId,
          imageGenerationAvailable,
          storageClient,
          imageGenerator: options.imageGenerator,
          knownUserProperties,
          onStage: (stage) => {
            if (stage === "Writing…") return;
            const now = Date.now();
            timings[currentStage] = now - stageStartedAt;
            currentStage = stage === "Assembling" ? "assemble" : "liquid";
            stageStartedAt = now;
          },
        });
        timings[currentStage] = Date.now() - stageStartedAt;
        logger().info(
          {
            model: selectedModelId,
            ...timings,
            totalMs: Date.now() - startedAt,
          },
          "Amie composer timing",
        );
        return reply.status(200).send(response);
      } catch (error) {
        const reasonCode =
          error instanceof ComposerModelError
            ? error.reasonCode
            : AmieComposerReasonCode.ModelFailure;
        const underlyingError =
          error instanceof ComposerModelError ? error.underlyingError : error;
        const rawModelOutput =
          error instanceof ComposerModelError ? error.rawModelOutput : "";
        logger().error(
          {
            reasonCode,
            workspaceId: request.body.workspaceId,
            errorName: errorName(underlyingError),
            errorMessage: errorMessage(underlyingError),
            rawModelOutputSample: rawModelOutput.slice(
              0,
              RAW_MODEL_OUTPUT_LOG_LENGTH,
            ),
          },
          "Amie composer request failed",
        );
        return reply.status(502).send({
          message:
            reasonCode === AmieComposerReasonCode.InvalidModelResponse
              ? "The composer returned an invalid response."
              : "The composer model request failed.",
          reasonCode,
        });
      }
    },
  );
}
