import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import logger from "backend-lib/src/logger";
import { assembleEmail } from "backend-lib/src/messaging/amieBlocks";
import { extractFirstJsonObject } from "backend-lib/src/messaging/amieComposer";
import { FastifyInstance } from "fastify";
import {
  AmieComposeRequest,
  AmieComposerErrorResponse,
  AmieComposerModelOutput,
  AmieComposerReasonCode,
  AmieComposeResponse,
} from "isomorphic-lib/src/amieComposer";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";

import config from "../config";

const BEDROCK_REGION = "us-east-1";
const MAX_MODEL_OUTPUT_TOKENS = 4096;
const RAW_MODEL_OUTPUT_LOG_LENGTH = 300;
const CORRECTIVE_INSTRUCTION =
  "Return ONLY the JSON object, no fences, matching the schema";

export interface BedrockInvoker {
  send(command: InvokeModelCommand): Promise<{ body?: Uint8Array }>;
}

export interface AmieComposerControllerOptions {
  bedrockClient?: BedrockInvoker;
  enabled?: boolean;
  modelId?: string;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function systemPrompt(): string {
  return `You compose polished marketing emails for Amie using only the supplied block schema.

Amie's voice is warm, conversational, and specific. Speak to women ages 35–60 about health with empathy and practical clarity. Never use corporate boilerplate, empty wellness language, pressure tactics, or hype. Do not make unsupported medical claims.

Return STRICT JSON and nothing else. The response must have exactly this shape: {"subject": string, "previewText": string, "blocks": BlockSpec[]}.

BlockSpec JSON Schema:
${JSON.stringify(AmieComposerModelOutput.properties.blocks)}

Use only schema-defined block types and parameters. Include a header and footer unless the user's request explicitly says otherwise. Paragraph values are plain text, not HTML. All links and image URLs must begin with http:// or https://. The footer's unsubscribe parameter is the visible link label; the server supplies the platform unsubscribe URL.

For a revision, preserve the existing structure and wording wherever possible. Make only the changes requested by the latest user message.`;
}

function modelMessages(
  request: AmieComposeRequest,
): { role: "user" | "assistant"; content: string }[] {
  const isRevision =
    request.currentBlocks !== undefined && request.conversation !== undefined;
  const context = isRevision
    ? [
        "This is a revision.",
        `Original brief: ${request.prompt}`,
        `Current blocks: ${JSON.stringify(request.currentBlocks)}`,
        "Apply the latest user request in the conversation minimally. Return the complete revised email JSON.",
      ].join("\n")
    : request.prompt;

  return [
    ...(request.conversation ?? []),
    {
      role: "user",
      content: context,
    },
  ];
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

function parseModelOutput(modelText: string): AmieComposerModelOutput {
  const jsonObject = extractFirstJsonObject(modelText);
  if (jsonObject === null) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      new SyntaxError("Model output did not contain a balanced JSON object"),
      modelText,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonObject);
  } catch (error) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      error,
      modelText,
    );
  }

  const validated = schemaValidate(parsed, AmieComposerModelOutput);
  if (validated.isErr()) {
    const [firstValidationError] = validated.error;
    const validationDetails = firstValidationError
      ? ` at ${firstValidationError.path}: ${firstValidationError.message}`
      : "";
    const validationError = new Error(
      `Model output failed schema validation${validationDetails}`,
    );
    validationError.name = "SchemaValidationError";
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
      validationError,
      modelText,
    );
  }
  return validated.value;
}

async function invokeComposerModel({
  bedrockClient,
  modelId,
  messages,
  previousModelOutput = "",
}: {
  bedrockClient: BedrockInvoker;
  modelId: string;
  messages: ReturnType<typeof modelMessages>;
  previousModelOutput?: string;
}): Promise<string> {
  let response: { body?: Uint8Array };
  try {
    response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId,
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: MAX_MODEL_OUTPUT_TOKENS,
          temperature: 0.3,
          system: systemPrompt(),
          messages,
        }),
      }),
    );
  } catch (error) {
    throw new ComposerModelError(
      AmieComposerReasonCode.ModelFailure,
      error,
      previousModelOutput,
    );
  }

  return decodeModelText(response.body);
}

export async function composeAmieEmail({
  request,
  bedrockClient,
  modelId,
}: {
  request: AmieComposeRequest;
  bedrockClient: BedrockInvoker;
  modelId: string;
}): Promise<AmieComposeResponse> {
  const messages = modelMessages(request);
  const firstModelOutput = await invokeComposerModel({
    bedrockClient,
    modelId,
    messages,
  });

  let output: AmieComposerModelOutput;
  try {
    output = parseModelOutput(firstModelOutput);
  } catch (error) {
    if (!(error instanceof ComposerModelError)) {
      throw error;
    }

    const retryModelOutput = await invokeComposerModel({
      bedrockClient,
      modelId,
      previousModelOutput: firstModelOutput,
      messages: [
        ...messages,
        { role: "assistant", content: firstModelOutput },
        { role: "user", content: CORRECTIVE_INSTRUCTION },
      ],
    });
    output = parseModelOutput(retryModelOutput);
  }

  return {
    ...output,
    html: assembleEmail(output.blocks, output.previewText),
  };
}

export default async function amieComposerController(
  fastify: FastifyInstance,
  options: AmieComposerControllerOptions,
) {
  const configured = config();
  const enabled = options.enabled ?? configured.amieComposerEnabled;
  const modelId = options.modelId ?? configured.amieComposerModelId;
  const bedrockClient =
    options.bedrockClient ??
    new BedrockRuntimeClient({ region: BEDROCK_REGION });

  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/compose",
    {
      schema: {
        description: "Compose or revise an Amie email with AI.",
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
