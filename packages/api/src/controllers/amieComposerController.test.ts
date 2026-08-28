import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import fastify from "fastify";
import {
  AmieComposerErrorResponse,
  AmieComposerReasonCode,
  AmieComposeResponse,
} from "isomorphic-lib/src/amieComposer";

import amieComposerController, {
  BedrockInvoker,
} from "./amieComposerController";

function bedrockSendMock() {
  return jest.fn<
    ReturnType<BedrockInvoker["send"]>,
    Parameters<BedrockInvoker["send"]>
  >();
}

function bedrockBody(value: unknown): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(value) }],
    }),
  );
}

describe("amieComposerController", () => {
  it("invokes Bedrock and returns validated blocks with assembled HTML", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        subject: "A calmer evening routine",
        previewText: "One small change for tonight.",
        blocks: [
          { type: "header", params: {} },
          {
            type: "heroHeading",
            params: { title: "A gentler way to wind down" },
          },
          {
            type: "footer",
            params: {
              addressLine: "123 Main St, New York, NY",
              unsubscribe: "Unsubscribe",
            },
          },
        ],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      modelId: "test-model",
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose",
      payload: {
        workspaceId: "workspace-1",
        prompt: "Write a warm note about an evening routine.",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieComposeResponse>();
    expect(body.subject).toBe("A calmer evening routine");
    expect(body.blocks).toHaveLength(3);
    expect(body.html).toContain("<!doctype html>");
    expect(body.html).toContain("A gentler way to wind down");
    expect(body.html).toContain("{% unsubscribe_url %}");
    expect(send).toHaveBeenCalledTimes(1);
    const command: InvokeModelCommand | undefined = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(InvokeModelCommand);
    expect(command?.input.modelId).toBe("test-model");
  });

  it("rejects unknown model block parameters without rendering them", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        subject: "Unsafe response",
        previewText: "Should not render",
        blocks: [
          {
            type: "paragraph",
            params: { text: "Safe text", rawHtml: "<script>bad()</script>" },
          },
        ],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose",
      payload: { workspaceId: "workspace-1", prompt: "Compose an email" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json<AmieComposerErrorResponse>()).toEqual({
      message: "The composer returned an invalid response.",
      reasonCode: AmieComposerReasonCode.InvalidModelResponse,
    });
    expect(response.body).not.toContain("<script>");
  });

  it("returns a clean reason code when Bedrock fails", async () => {
    const send = bedrockSendMock().mockRejectedValue(
      new Error("AWS secret details"),
    );
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose",
      payload: { workspaceId: "workspace-1", prompt: "Compose an email" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json<AmieComposerErrorResponse>()).toEqual({
      message: "The composer model request failed.",
      reasonCode: AmieComposerReasonCode.ModelFailure,
    });
    expect(response.body).not.toContain("AWS secret details");
  });

  it("honors the disabled kill switch", async () => {
    const send = bedrockSendMock();
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: false,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose",
      payload: { workspaceId: "workspace-1", prompt: "Compose an email" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<AmieComposerErrorResponse>().reasonCode).toBe(
      AmieComposerReasonCode.Disabled,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
