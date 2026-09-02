import {
  BedrockRuntimeClient,
  InvokeModelCommand,
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

export interface BedrockInvoker {
  send(command: InvokeModelCommand): Promise<{ body?: Uint8Array }>;
}

export interface AmieComposerControllerOptions {
  bedrockClient?: BedrockInvoker;
  enabled?: boolean;
  modelId?: string;
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
}: {
  request: AmieComposeRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
  imageGenerationAvailable: boolean;
}): Promise<AmieComposerModelOutput> {
  const messages = modelMessages(request);
  const system = systemPrompt(request, imageGenerationAvailable);
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
          asset.alt ?? instruction.prompt,
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

export async function composeAmieEmail({
  request,
  bedrockClient,
  modelId,
  imageGenerationAvailable = false,
  storageClient,
  imageGenerator,
}: {
  request: AmieComposeRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
  imageGenerationAvailable?: boolean;
  storageClient?: AssetStorageClient;
  imageGenerator?: AmieComposerControllerOptions["imageGenerator"];
}): Promise<AmieComposeResponse> {
  const drafted = await draftOutput({
    request,
    bedrockClient,
    modelId,
    imageGenerationAvailable,
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
  return {
    ...audited,
    html: assembleEmail(audited.blocks, audited.previewText),
  };
}

async function importHtml({
  request,
  bedrockClient,
  modelId,
}: {
  request: AmieImportHtmlRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
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
  const bedrockClient =
    options.bedrockClient ??
    new BedrockRuntimeClient({ region: BEDROCK_REGION });
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
              modelId,
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
        const response = await composeAmieEmail({
          request: request.body,
          bedrockClient,
          modelId,
          imageGenerationAvailable,
          storageClient,
          imageGenerator: options.imageGenerator,
        });
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
