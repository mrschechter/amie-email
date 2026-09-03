import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import fastify from "fastify";
import {
  AMIE_COMPOSER_COPY_LIMITS,
  AMIE_MAX_BLOCKS,
  AmieAssembleResponse,
  AmieComposerConfigResponse,
  AmieComposerErrorResponse,
  AmieComposeResponse,
  AmieComposerModelOutput,
  AmieComposerReasonCode,
  AmieEditResponse,
  AmieSanitizeHtmlResponse,
} from "isomorphic-lib/src/amieComposer";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  ChannelType,
  MessageTemplateResourceDefinition,
} from "isomorphic-lib/src/types";

import amieComposerController, {
  BedrockInvoker,
  composeAmieEmail,
  decodeModelText,
  normalizeLengthLimitedModelStrings,
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
  describe("Bedrock responses", () => {
    it("returns a text part that follows a thinking part", () => {
      const body = new TextEncoder().encode(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "Working through the draft" },
            { type: "text", text: "{}" },
          ],
          stop_reason: "end_turn",
        }),
      );

      expect(decodeModelText(body)).toBe("{}");
    });

    it("includes the stop reason when only thinking is returned", () => {
      const body = new TextEncoder().encode(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "Working through the draft" },
          ],
          stop_reason: "max_tokens",
        }),
      );

      expect(() => decodeModelText(body)).toThrow(
        "Bedrock response did not contain a text output (stop_reason=max_tokens, parts=thinking)",
      );
    });
  });

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

  it("clamps an overlong model subject at a word boundary without retrying", async () => {
    const subject =
      "A kinder way to feel supported through every step of your wellness journey today";
    const blocks = [
      {
        type: "ctaButton",
        params: { label: "Learn more", url: "https://tryamie.com" },
      },
      {
        type: "footer",
        params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
      },
    ];
    const send = bedrockSendMock()
      .mockResolvedValueOnce({
        body: bedrockBody({ subject, previewText: "A warm preview.", blocks }),
      })
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject,
          previewText: "A warm preview.",
          blocks,
          designNotes: "Checked the draft.",
        }),
      });

    const response = await composeAmieEmail({
      request: { workspaceId: "workspace-1", prompt: "Compose an email" },
      bedrockClient: { send },
      modelId: "fast-model",
    });

    expect(response.subject).toBe(
      "A kinder way to feel supported through every step of your",
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("clamps overlong preview text at a word boundary", async () => {
    const previewText =
      "This preview text has intentionally been written with many extra words so that it exceeds the schema limit while still offering a clean and natural word boundary for the composer to use safely today and tomorrow";
    const blocks = [
      {
        type: "ctaButton",
        params: { label: "Learn more", url: "https://tryamie.com" },
      },
      {
        type: "footer",
        params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
      },
    ];
    const send = bedrockSendMock()
      .mockResolvedValueOnce({
        body: bedrockBody({ subject: "A warm note", previewText, blocks }),
      })
      .mockResolvedValueOnce({
        body: bedrockBody({
          subject: "A warm note",
          previewText,
          blocks,
          designNotes: "Checked the draft.",
        }),
      });

    const response = await composeAmieEmail({
      request: { workspaceId: "workspace-1", prompt: "Compose an email" },
      bedrockClient: { send },
      modelId: "fast-model",
    });

    expect(response.previewText).toBe(
      "This preview text has intentionally been written with many extra words so that it exceeds the schema limit while still offering a clean and",
    );
  });

  it("leaves already-valid length-limited model output untouched", async () => {
    const blocks = [
      {
        type: "heroHeading",
        params: { title: "A gentler way forward", subtitle: "Made for you" },
      },
      {
        type: "ctaButton",
        params: { label: "See what’s new", url: "https://tryamie.com" },
      },
      {
        type: "footer",
        params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
      },
    ];
    const output = {
      subject: "A thoughtful hello",
      previewText: "A note for your day.",
      blocks,
    };
    const send = bedrockSendMock()
      .mockResolvedValueOnce({ body: bedrockBody(output) })
      .mockResolvedValueOnce({
        body: bedrockBody({ ...output, designNotes: "Checked the draft." }),
      });

    const response = await composeAmieEmail({
      request: { workspaceId: "workspace-1", prompt: "Compose an email" },
      bedrockClient: { send },
      modelId: "fast-model",
    });

    expect(response).toMatchObject(output);
  });

  it("accepts legacy copy lengths in stored message-template definitions", () => {
    const heading = "h".repeat(120);
    const ctaLabel = "c".repeat(60);
    const alt = "a".repeat(200);
    const previewText = "p".repeat(200);
    const definition = {
      type: ChannelType.Email,
      from: "hello@tryamie.com",
      subject: "s".repeat(120),
      body: `<div data-amie-preview-text>${previewText}</div>`,
      amieBlocks: [
        { type: "heroHeading", params: { title: heading } },
        {
          type: "ctaButton",
          params: { label: ctaLabel, url: "https://tryamie.com" },
        },
        {
          type: "image",
          params: { src: "https://assets.tryamie.com/product.jpg", alt },
        },
      ],
    };

    expect(
      schemaValidate(definition, MessageTemplateResourceDefinition).isOk(),
    ).toBe(true);
  });

  it("clamps model copy with the exported limits instead of schema maxLength", () => {
    const output = {
      subject: "subject ".repeat(12).trim(),
      previewText: "p ".repeat(100),
      blocks: [
        {
          type: "heroHeading",
          params: { title: "h ".repeat(60) },
        },
        {
          type: "ctaButton",
          params: {
            label: "c ".repeat(30),
            url: "https://tryamie.com",
          },
        },
        {
          type: "image",
          params: {
            src: "https://assets.tryamie.com/product.jpg",
            alt: "a ".repeat(100),
          },
        },
      ],
    };

    const normalized = normalizeLengthLimitedModelStrings({
      value: output,
      schema: AmieComposerModelOutput,
    });

    expect(AMIE_COMPOSER_COPY_LIMITS).toEqual({
      subject: 60,
      previewText: 140,
      heading: 80,
      cta: 40,
      alt: 125,
    });
    expect(normalized).toMatchObject({
      subject: "subject subject subject subject subject subject subject",
      previewText: "p ".repeat(70).trim(),
      blocks: [
        { params: { title: "h ".repeat(40).trim() } },
        { params: { label: "c ".repeat(20).trim() } },
        { params: { alt: "a ".repeat(63).trim() } },
      ],
    });
  });

  it("clamps a revision with 21 blocks and preserves its trailing footer", async () => {
    const footer = {
      type: "footer" as const,
      params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
    };
    const blocks = [
      {
        type: "ctaButton" as const,
        params: { label: "Learn more", url: "https://tryamie.com" },
      },
      ...Array.from({ length: AMIE_MAX_BLOCKS - 1 }, (_, index) => ({
        type: "paragraph" as const,
        params: { text: `Section ${index + 1}` },
      })),
      footer,
    ];
    const output = {
      subject: "A detailed update",
      previewText: "Everything you need to know.",
      blocks,
    };
    const send = bedrockSendMock()
      .mockResolvedValueOnce({ body: bedrockBody(output) })
      .mockResolvedValueOnce({
        body: bedrockBody({ ...output, designNotes: "Checked the draft." }),
      });

    const response = await composeAmieEmail({
      request: {
        workspaceId: "workspace-1",
        prompt: "Original brief",
        currentBlocks: [
          { type: "paragraph", params: { text: "Current draft" } },
        ],
        conversation: [{ role: "user", content: "Add more detail" }],
      },
      bedrockClient: { send },
      modelId: "fast-model",
    });

    expect(response.blocks).toHaveLength(AMIE_MAX_BLOCKS);
    expect(response.blocks.at(-1)).toEqual(footer);
    expect(response.blocks).not.toContainEqual({
      type: "paragraph",
      params: { text: `Section ${AMIE_MAX_BLOCKS - 1}` },
    });
  });

  it("keeps the first 20 blocks when 25 model blocks have no footer", () => {
    const blocks = Array.from({ length: AMIE_MAX_BLOCKS + 5 }, (_, index) => ({
      type: "paragraph",
      params: { text: `Section ${index + 1}` },
    }));

    const normalized = normalizeLengthLimitedModelStrings({
      value: blocks,
      schema: AmieComposerModelOutput.properties.blocks,
      path: "/blocks",
    });

    expect(normalized).toEqual(blocks.slice(0, AMIE_MAX_BLOCKS));
  });

  it("leaves eight model blocks untouched", () => {
    const blocks = Array.from({ length: 8 }, (_, index) => ({
      type: "paragraph",
      params: { text: `Section ${index + 1}` },
    }));

    const normalized = normalizeLengthLimitedModelStrings({
      value: blocks,
      schema: AmieComposerModelOutput.properties.blocks,
      path: "/blocks",
    });

    expect(normalized).toEqual(blocks);
  });

  it("uses safe fallbacks for required bounded strings that trim empty", async () => {
    const imageUrl = "https://assets.tryamie.com/product.jpg";
    const output = {
      subject: " \n ",
      previewText: "\t",
      blocks: [
        {
          type: "heroHeading",
          params: { title: "  A calm   update  " },
        },
        {
          type: "heroImage",
          params: { src: imageUrl, alt: " \n" },
        },
        {
          type: "ctaButton",
          params: { label: "  ", url: "https://tryamie.com" },
        },
        {
          type: "footer",
          params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
        },
      ],
    };
    const send = bedrockSendMock()
      .mockResolvedValueOnce({ body: bedrockBody(output) })
      .mockResolvedValueOnce({
        body: bedrockBody({ ...output, designNotes: "Checked the draft." }),
      });

    const response = await composeAmieEmail({
      request: {
        workspaceId: "workspace-1",
        prompt: "Compose an email",
        images: [{ url: imageUrl }],
      },
      bedrockClient: { send },
      modelId: "fast-model",
    });

    expect(response.subject).toBe("A calm update");
    expect(response.previewText).toBe("A thoughtful update from Amie.");
    const heroImage = response.blocks.find(
      (block) => block.type === "heroImage",
    );
    const cta = response.blocks.find((block) => block.type === "ctaButton");
    expect(heroImage).toMatchObject({
      params: { alt: "Amie product and lifestyle" },
    });
    expect(cta).toMatchObject({ params: { label: "Learn more" } });
  });

  it("clamps length-limited output on the edit path", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        reply: "I tightened the subject.",
        ops: [
          {
            type: "set_subject",
            value:
              "Learn about the simplest possible way to support your everyday wellness goals",
          },
          {
            type: "set_block_props",
            blockId: "hero",
            props: {
              params: {
                title:
                  "A steady and supportive everyday approach to feeling more comfortable confident and completely ready",
              },
            },
          },
        ],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      fastModelId: "fast-model",
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/edit",
      payload: {
        workspaceId: "workspace-1",
        templateId: "template-1",
        message: "Update the subject",
        conversation: [],
        document: {
          subject: "Original subject",
          previewText: "Original preview",
          blocks: [
            {
              id: "hero",
              type: "heroHeading",
              params: { title: "Everyday wellness" },
            },
          ],
        },
        renderedText: "Everyday wellness",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieEditResponse>();
    expect(body.ops[0]).toEqual({
      type: "set_subject",
      value: "Learn about the simplest possible way to support your",
    });
    expect(body.document.subject).toBe(
      "Learn about the simplest possible way to support your",
    );
    expect(body.document.blocks[0]).toMatchObject({
      params: {
        title:
          "A steady and supportive everyday approach to feeling more comfortable confident",
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
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

  it("uses the fast 1,200-token editor and applies a widow fix", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        reply: "I joined the final two headline words.",
        ops: [
          {
            type: "replace_text",
            blockId: "hero",
            find: "completely ready",
            replace: "completely&nbsp;ready",
          },
        ],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      modelId: "primary-model",
      fastModelId: "fast-model",
      bedrockClient: { send },
      userPropertyNames: () => Promise.resolve(["firstName"]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose/edit",
      payload: {
        workspaceId: "workspace-1",
        templateId: "template-1",
        message: "Fix ready being on its own line",
        conversation: [],
        document: {
          subject: "Subject",
          previewText: "Preview",
          blocks: [
            {
              id: "hero",
              type: "heroHeading",
              params: { title: "Feel completely ready" },
            },
          ],
        },
        renderedText: "Feel completely\nready",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieEditResponse>();
    expect(body.document.blocks[0]).toMatchObject({
      id: "hero",
      params: { title: "Feel completely&nbsp;ready" },
    });
    expect(body.html).toContain("completely&nbsp;ready");
    const command = send.mock.calls[0]?.[0];
    expect(command?.input.modelId).toBe("fast-model");
    expect(String(command?.input.body)).toContain('"max_tokens":1200');
    expect(String(command?.input.body)).toContain("WIDOW CANDIDATE");
    expect(String(command?.input.body)).toContain(
      "Never answer with a checklist",
    );
  });

  it("rejects an invalid model edit-op schema", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        reply: "Changed it.",
        ops: [{ type: "replace_text", blockId: "hero", replace: "ready" }],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      fastModelId: "fast-model",
      bedrockClient: { send },
    });
    const response = await app.inject({
      method: "POST",
      url: "/compose/edit",
      payload: {
        workspaceId: "workspace-1",
        templateId: "template-1",
        message: "Fix it",
        conversation: [],
        document: {
          subject: "Subject",
          previewText: "Preview",
          blocks: [
            { id: "hero", type: "heroHeading", params: { title: "Ready" } },
          ],
        },
        renderedText: "Ready",
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<AmieComposerErrorResponse>().reasonCode).toBe(
      AmieComposerReasonCode.InvalidModelResponse,
    );
  });

  it("returns a no_op with the unchanged document", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        reply: "The heading already wraps cleanly; try a shorter subject next.",
        ops: [{ type: "no_op", reason: "The heading already wraps cleanly." }],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      bedrockClient: { send },
    });
    const document = {
      subject: "Subject",
      previewText: "Preview",
      blocks: [{ id: "body", type: "paragraph", params: { text: "Fine" } }],
    };
    const response = await app.inject({
      method: "POST",
      url: "/compose/edit",
      payload: {
        workspaceId: "workspace-1",
        templateId: "template-1",
        message: "Improve it",
        conversation: [],
        document,
        renderedText: "Fine",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AmieEditResponse>().document).toEqual(document);
  });

  it("returns a no_op when an edit inserts a block past the cap", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        reply: "I could not add another section.",
        ops: [
          {
            type: "insert_block",
            afterBlockId: "footer",
            block: {
              id: "extra",
              type: "paragraph",
              params: { text: "One more section" },
            },
          },
        ],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      fastModelId: "fast-model",
      bedrockClient: { send },
    });
    const document = {
      subject: "Subject",
      previewText: "Preview",
      blocks: [
        ...Array.from({ length: AMIE_MAX_BLOCKS - 1 }, (_, index) => ({
          id: `section-${index + 1}`,
          type: "paragraph" as const,
          params: { text: `Section ${index + 1}` },
        })),
        {
          id: "footer",
          type: "footer" as const,
          params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
        },
      ],
    };

    const response = await app.inject({
      method: "POST",
      url: "/compose/edit",
      payload: {
        workspaceId: "workspace-1",
        templateId: "template-1",
        message: "Add one more section",
        conversation: [],
        document,
        renderedText: "Current email",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<AmieEditResponse>();
    expect(body.ops).toEqual([
      {
        type: "no_op",
        reason:
          "The email already has the maximum of 20 blocks, so another block was not inserted.",
      },
    ]);
    expect(body.document).toEqual(document);
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
    const requestBody: unknown = JSON.parse(String(command?.input.body));
    expect(requestBody).toMatchObject({ max_tokens: 8192, temperature: 0.3 });
    expect(requestBody).not.toHaveProperty("thinking");
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

  it("disables thinking and omits temperature for Claude 5 requests", async () => {
    const send = bedrockSendMock().mockResolvedValue({
      body: bedrockBody({
        subject: "A complete draft",
        previewText: "A preview.",
        blocks: [
          { type: "paragraph", params: { text: "Draft body." } },
          {
            type: "footer",
            params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
          },
        ],
      }),
    });
    const app = fastify();
    await app.register(amieComposerController, {
      enabled: true,
      modelId: "us.anthropic.claude-sonnet-5",
      bedrockClient: { send },
    });

    const response = await app.inject({
      method: "POST",
      url: "/compose",
      payload: { workspaceId: "workspace-1", prompt: "Compose an email" },
    });

    expect(response.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [command] of send.mock.calls) {
      const requestBody: unknown = JSON.parse(String(command.input.body));
      expect(requestBody).toMatchObject({
        thinking: { type: "disabled" },
      });
      expect(requestBody).not.toHaveProperty("temperature");
    }
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
