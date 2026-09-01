import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import fastify from "fastify";
import {
  AmieAssembleResponse,
  AmieComposerConfigResponse,
  AmieComposerErrorResponse,
  AmieComposeResponse,
  AmieComposerReasonCode,
  AmieSanitizeHtmlResponse,
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

function bedrockText(text: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      content: [{ type: "text", text }],
    }),
  );
}

function bedrockBody(value: unknown): Uint8Array {
  return bedrockText(JSON.stringify(value));
}

describe("amieComposerController", () => {
  it("exposes the enabled flag without invoking Bedrock", async () => {
    const send = bedrockSendMock();
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "GET",
      url: "/compose/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieComposerConfigResponse>()).toEqual({
      enabled: true,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("assembles validated blocks without invoking Bedrock", async () => {
    const send = bedrockSendMock();
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/assemble",
      payload: {
        workspaceId: "workspace-1",
        blocks: [{ type: "paragraph", params: { text: "Edited locally." } }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieAssembleResponse>().html).toContain(
      "Edited locally.",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("sanitizes pasted HTML without invoking Bedrock", async () => {
    const send = bedrockSendMock();
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/sanitize-html",
      payload: {
        workspaceId: "workspace-1",
        html: [
          '<table onclick="bad()" onfocus=alsoBad onblur style="width:100%" data-onclick="keep">',
          "<tr><td>{{ user.firstName }}</td></tr>",
          "<script>bad()</script>",
          "</table>",
        ].join(""),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieSanitizeHtmlResponse>()).toEqual({
      html: [
        '<table style="width:100%" data-onclick="keep">',
        "<tr><td>{{ user.firstName }}</td></tr>",
        "</table>",
      ].join(""),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("removes unclosed script contents from pasted HTML", async () => {
    const send = bedrockSendMock();
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/sanitize-html",
      payload: {
        workspaceId: "workspace-1",
        html: "<p>Safe</p><script>alert('bad')",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieSanitizeHtmlResponse>()).toEqual({
      html: "<p>Safe</p>",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("applies the composer kill switch to HTML sanitization", async () => {
    const send = bedrockSendMock();
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: false,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/sanitize-html",
      payload: {
        workspaceId: "workspace-1",
        html: "<p>Hello</p>",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<AmieComposerErrorResponse>().reasonCode).toBe(
      AmieComposerReasonCode.Disabled,
    );
    expect(send).not.toHaveBeenCalled();
  });

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
    expect(String(command?.input.body)).toContain('"max_tokens":4096');
  });

  it("accepts a fence-wrapped model response with surrounding prose", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockText(
        [
          "Here is the requested email:",
          "```json",
          JSON.stringify({
            subject: "A thoughtful hello",
            previewText: "A note for your day.",
            blocks: [{ type: "paragraph", params: { text: "Hello there." } }],
          }),
          "```",
        ].join("\n"),
      ),
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

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieComposeResponse>().subject).toBe(
      "A thoughtful hello",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries once with the failed output and corrective instruction", async () => {
    const failedOutput = "I could not format the response.";
    const send = bedrockSendMock()
      .mockResolvedValueOnce({ body: bedrockText(failedOutput) })
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "Corrected response",
          previewText: "Now valid JSON.",
          blocks: [{ type: "paragraph", params: { text: "Corrected." } }],
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

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieComposeResponse>().subject).toBe(
      "Corrected response",
    );
    expect(send).toHaveBeenCalledTimes(2);
    const retryCommand: InvokeModelCommand | undefined =
      send.mock.calls[1]?.[0];
    const failedOutputMessage = JSON.stringify({
      role: "assistant",
      content: failedOutput,
    });
    const correctiveMessage = JSON.stringify({
      role: "user",
      content: "Return ONLY the JSON object, no fences, matching the schema",
    });
    expect(String(retryCommand?.input.body)).toContain(
      `${failedOutputMessage},${correctiveMessage}`,
    );
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
    expect(send).toHaveBeenCalledTimes(2);
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
