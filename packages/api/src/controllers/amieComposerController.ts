import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { assembleEmail } from "backend-lib/src/messaging/amieBlocks";
import logger from "backend-lib/src/logger";
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

export interface BedrockInvoker {
  send(command: InvokeModelCommand): Promise<{ body?: Uint8Array }>;
}

export interface AmieComposerControllerOptions {
  bedrockClient?: BedrockInvoker;
  enabled?: boolean;
  modelId?: string;
}

class ComposerModelError extends Error {
  constructor(public readonly reasonCode: AmieComposerReasonCode) {
    super(reasonCode);
  }
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
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
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
    );
  }
  return textPart.text;
}

function parseModelOutput(modelText: string): AmieComposerModelOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(modelText);
  } catch {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
    );
  }

  const validated = schemaValidate(parsed, AmieComposerModelOutput);
  if (validated.isErr()) {
    throw new ComposerModelError(
      AmieComposerReasonCode.InvalidModelResponse,
    );
  }
  return validated.value;
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
  let response: { body?: Uint8Array };
  try {
    response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId,
        accept: "application/json",
        contentType: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 4096,
          temperature: 0.3,
          system: systemPrompt(),
          messages: modelMessages(request),
        }),
      }),
    );
  } catch {
    throw new ComposerModelError(AmieComposerReasonCode.ModelFailure);
  }

  const output = parseModelOutput(decodeModelText(response.body));
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
        logger().error(
          { reasonCode, workspaceId: request.body.workspaceId },
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
