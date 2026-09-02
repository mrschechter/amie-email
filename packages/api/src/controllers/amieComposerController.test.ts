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
  composeAmieEmail,
  selectComposerModelId,
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
  describe("model routing", () => {
    it("uses the primary model for a full first draft", () => {
      expect(
        selectComposerModelId(
          { workspaceId: "workspace-1", prompt: "Draft a win-back email" },
          "primary-model",
          "fast-model",
        ),
      ).toBe("primary-model");
    });

    it.each([
      {
        label: "revision",
        request: {
          workspaceId: "workspace-1",
          prompt: "Original",
          currentBlocks: [
            { type: "paragraph" as const, params: { text: "Current draft" } },
          ],
          conversation: [{ role: "user" as const, content: "Make it warmer" }],
        },
      },
      {
        label: "quick action",
        request: {
          workspaceId: "workspace-1",
          prompt: "Shorten it",
        },
      },
      {
        label: "small seeded draft",
        request: {
          workspaceId: "workspace-1",
          prompt: "Fill this design",
          seedBlocks: [
            { type: "paragraph" as const, params: { text: "Short seed" } },
          ],
        },
      },
    ])("uses the fast model for a $label", ({ request }) => {
      expect(
        selectComposerModelId(request, "primary-model", "fast-model"),
      ).toBe("fast-model");
    });
  });

  it("normalizes invalid subject and body Liquid before returning a draft", async () => {
    const invalidLiquid = {
      subject: "Come back, {{ firstName }}",
      previewText: "A note for {{ user.firstName }}",
      blocks: [
        {
          type: "paragraph",
          params: {
            text: "Hi {{ user.firstName | default: &#39;Queen&#39; }}",
          },
        },
        {
          type: "footer",
          params: { addressLine: "Configured", unsubscribe: "Unsubscribe" },
        },
      ],
    };
    const send = bedrockSendMock()
      .mockResolvedValueOnce({ body: bedrockBody(invalidLiquid) })
      .mockResolvedValueOnce({
        body: bedrockBody({
          ...invalidLiquid,
          designNotes: "Liquid checked.",
        }),
      });

    const response = await composeAmieEmail({
      request: { workspaceId: "workspace-1", prompt: "Draft a win-back" },
      bedrockClient: { send },
      modelId: "fast-model",
      knownUserProperties: ["firstName"],
    });

    expect(response.subject).toBe(
      "Come back, {{ user.firstName | default: '' }}",
    );
    expect(response.previewText).toBe(
      "A note for {{ user.firstName | default: '' }}",
    );
    expect(response.html).toContain("{{ user.firstName | default: 'Queen' }}");
    expect(response.html).not.toContain("default: &#39;Queen&#39;");
    expect(
      "warnings" in response ? response.warnings : undefined,
    ).toBeUndefined();
  });

  it("warns and keeps the last valid revision when Liquid still fails", async () => {
    const broken = {
      subject: "Hello {{ unknownName }}",
      previewText: "Broken {{ unknownPreview }}",
      blocks: [
        {
          type: "paragraph",
          params: { text: "Broken {{ unknownBody }}" },
        },
      ],
    };
    const send = bedrockSendMock()
      .mockResolvedValueOnce({ body: bedrockBody(broken) })
      .mockResolvedValueOnce({
        body: bedrockBody({ ...broken, designNotes: "Attempted revision." }),
      });

    const response = await composeAmieEmail({
      request: {
        workspaceId: "workspace-1",
        prompt: "Original brief",
        currentSubject: "Last valid subject",
        currentPreviewText: "Last valid preview",
        currentBlocks: [
          { type: "paragraph", params: { text: "Last valid body" } },
        ],
        conversation: [{ role: "user", content: "Personalize it" }],
      },
      bedrockClient: { send },
      modelId: "fast-model",
      knownUserProperties: ["firstName"],
    });

    expect(response.subject).toBe("Last valid subject");
    expect(response.previewText).toBe("Last valid preview");
    expect(response.html).toContain("Last valid body");
    expect("warnings" in response ? response.warnings : []).toHaveLength(3);
  });

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
      imageGenerationEnabled: false,
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
      userPropertyNames: () =>
        Promise.resolve(["firstName", "checkoutUrl", "paymentUpdateUrl"]),
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
    expect(body.blocks).toHaveLength(4);
    expect(body.html).toContain("<!doctype html>");
    expect(body.html).toContain("A gentler way to wind down");
    expect(body.html).toContain("{% unsubscribe_url %}");
    expect(body.html).not.toContain("123 Main St, New York, NY");
    expect(send).toHaveBeenCalledTimes(2);
    const command: InvokeModelCommand | undefined = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(InvokeModelCommand);
    expect(command?.input.modelId).toBe("test-model");
    expect(String(command?.input.body)).toContain('"max_tokens":4096');
    expect(String(command?.input.body)).toContain(
      "replaces addressLine with the configured mailing address",
    );
    expect(String(command?.input.body)).toContain(
      '[\\"firstName\\",\\"checkoutUrl\\",\\"paymentUpdateUrl\\"]',
    );
    expect(String(command?.input.body)).toContain(
      "{{ user.firstName | default: 'there' }}",
    );
  });

  it("includes only the supplied image URLs in the model instructions", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        subject: "With a hero",
        previewText: "See what’s new.",
        blocks: [
          {
            type: "heroImage",
            params: {
              src: "https://assets.tryamie.com/public/workspace/image.jpg",
              alt: "Amie product",
            },
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
      payload: {
        workspaceId: "workspace-1",
        prompt: "Use the product image as a hero.",
        images: [
          {
            url: "https://assets.tryamie.com/public/workspace/image.jpg",
            alt: "Amie product",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const command: InvokeModelCommand | undefined = send.mock.calls[0]?.[0];
    const requestBody = String(command?.input.body);
    expect(requestBody).toContain("Use ONLY those exact image URLs");
    expect(requestBody).toContain(
      "https://assets.tryamie.com/public/workspace/image.jpg",
    );
    expect(response.json<AmieComposeResponse>().html).toContain(
      'src="https://assets.tryamie.com/public/workspace/image.jpg"',
    );
  });

  it("keeps http images and strips unsafe image sources from pasted HTML", async () => {
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
        html: '<img src="https://assets.tryamie.com/good.jpg"><img src="javascript:bad()">',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AmieSanitizeHtmlResponse>().html).toBe(
      '<img src="https://assets.tryamie.com/good.jpg"><img>',
    );
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
    expect(send).toHaveBeenCalledTimes(2);
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
    expect(send).toHaveBeenCalledTimes(3);
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

  it("runs the critique pass and returns its automatic design fix", async () => {
    const send = bedrockSendMock()
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "Draft subject",
          previewText: "Draft preview",
          blocks: [
            { type: "header", params: {} },
            { type: "paragraph", params: { text: "Draft body" } },
            {
              type: "footer",
              params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "Reviewed subject",
          previewText: "Reviewed preview",
          blocks: [
            { type: "header", params: {} },
            {
              type: "ctaButton",
              params: { label: "Start now", url: "https://tryamie.com" },
              style: { align: "center", buttonVariant: "primary" },
            },
            {
              type: "paragraph",
              params: { text: "Reviewed body" },
              style: { background: "ivory", padding: "loose" },
            },
            {
              type: "footer",
              params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
            },
          ],
          designNotes: "Moved the CTA up and clarified the hierarchy.",
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
      payload: { workspaceId: "workspace-1", prompt: "Design a welcome email" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieComposeResponse>();
    expect(body.subject).toBe("Reviewed subject");
    expect(body.designNotes).toBe(
      "Moved the CTA up and clarified the hierarchy.",
    );
    expect(body.blocks[1]).toMatchObject({ type: "ctaButton" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("preserves user style edits through copy-only revisions and critique reordering", async () => {
    const revisedBlocks = [
      { type: "paragraph", params: { text: "Revised copy" } },
      {
        type: "ctaButton",
        params: { label: "Keep going", url: "https://tryamie.com" },
      },
      {
        type: "footer",
        params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
      },
    ];
    const send = bedrockSendMock()
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "Revised",
          previewText: "Updated copy.",
          blocks: revisedBlocks,
        }),
      })
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "Revised",
          previewText: "Updated copy.",
          blocks: [{ type: "header", params: {} }, ...revisedBlocks],
          designNotes: "Copy reviewed.",
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
      payload: {
        workspaceId: "workspace-1",
        prompt: "Original brief",
        currentBlocks: [
          {
            type: "paragraph",
            params: { text: "Original copy" },
            style: { background: "blush", padding: "loose", align: "center" },
          },
          ...revisedBlocks.slice(1),
        ],
        conversation: [{ role: "user", content: "Change only the wording" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const paragraph = response
      .json<AmieComposeResponse>()
      .blocks.find((block) => block.type === "paragraph");
    expect(paragraph?.style).toEqual({
      background: "blush",
      padding: "loose",
      align: "center",
    });
  });

  it("cleans unknown style tokens without failing the compose", async () => {
    const output = {
      subject: "Clean style",
      previewText: "Invalid tokens are ignored.",
      blocks: [
        {
          type: "paragraph",
          params: { text: "Keep this design." },
          style: { background: "chartreuse", align: "center" },
        },
        {
          type: "footer",
          params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
        },
      ],
    };
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody(output),
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
    const paragraph = response
      .json<AmieComposeResponse>()
      .blocks.find((block) => block.type === "paragraph");
    expect(paragraph?.style).toEqual({ align: "center" });
  });

  it("fulfills a generated-image slot before assembling", async () => {
    const send = bedrockSendMock()
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "Generated hero",
          previewText: "A new visual.",
          blocks: [
            {
              type: "heroImage",
              params: {
                src: "https://generated.amie.invalid/pending",
                alt: "Pending image",
              },
            },
            {
              type: "ctaButton",
              params: { label: "Learn more", url: "https://tryamie.com" },
            },
            {
              type: "footer",
              params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
            },
          ],
          generateImages: [
            {
              generateImage: {
                prompt: "A warm bedside routine",
                aspect: "16:9",
                slot: 0,
              },
            },
          ],
        }),
      })
      .mockRejectedValueOnce(new Error("critique unavailable"));
    const storageSend = jest.fn(() => Promise.resolve({}));
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      imageGenerationEnabled: true,
      bedrockClient: { send },
      storageClient: { send: storageSend },
      imageGenerator: jest.fn(() =>
        Promise.resolve({
          bytes: Buffer.from("generated-image"),
          contentType: "image/png" as const,
        }),
      ),
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose",
      payload: { workspaceId: "workspace-1", prompt: "Use a generated hero" },
    });

    expect(response.statusCode).toBe(200);
    const hero = response
      .json<AmieComposeResponse>()
      .blocks.find((block) => block.type === "heroImage");
    expect(hero?.type === "heroImage" ? hero.params.src : "").toMatch(
      /public\/workspace-1\/generated\/.+\.png$/,
    );
    expect(storageSend).toHaveBeenCalledTimes(1);
  });

  it("falls back to one sanitized raw HTML block when import conversion fails", async () => {
    const send = bedrockSendMock().mockRejectedValue(new Error("model down"));
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/import-html",
      payload: {
        workspaceId: "workspace-1",
        html: '<p onclick="bad()">Keep me</p><script>bad()</script>',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieComposeResponse>();
    expect(body.blocks).toEqual([
      { type: "rawHtml", params: { html: "<p>Keep me</p>" } },
    ]);
    expect(body.html).not.toContain("<script>");
    expect(body.designNotes).toContain("fallback block");
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
