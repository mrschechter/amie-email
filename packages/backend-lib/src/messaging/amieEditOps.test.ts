import { AmieEditDocument, AmieEditOp } from "isomorphic-lib/src/amieComposer";

import {
  applyAmieEditOps,
  renderAmieDocumentText,
  validateEditDocumentIds,
} from "./amieEditOps";

const document: AmieEditDocument = {
  subject: "Original subject",
  previewText: "Original preview",
  blocks: [
    {
      id: "hero",
      type: "heroHeading",
      params: { title: "Feel completely ready" },
    },
    { id: "body", type: "paragraph", params: { text: "Original body" } },
    {
      id: "footer",
      type: "footer",
      params: { addressLine: "Configured", unsubscribe: "Unsubscribe" },
    },
  ],
};

describe("Amie edit operations", () => {
  it("applies each edit operation atomically and assembles once", () => {
    const ops: AmieEditOp[] = [
      { type: "set_subject", value: "New subject" },
      { type: "set_preview_text", value: "New preview" },
      {
        type: "replace_text",
        blockId: "hero",
        find: "completely ready",
        replace: "completely&nbsp;ready",
      },
      {
        type: "set_block_props",
        blockId: "body",
        props: { params: { text: "Updated body" }, style: { align: "center" } },
      },
      {
        type: "insert_block",
        afterBlockId: "body",
        block: { id: "divider", type: "divider", params: {} },
      },
      { type: "move_block", blockId: "divider", afterBlockId: "hero" },
      { type: "remove_block", blockId: "footer" },
      { type: "set_style_token", name: "padding", value: "tight" },
    ];

    const result = applyAmieEditOps({ document, ops });

    expect(result.document.subject).toBe("New subject");
    expect(result.document.previewText).toBe("New preview");
    expect(result.document.blocks.map((block) => block.id)).toEqual([
      "hero",
      "divider",
      "body",
    ]);
    expect(result.html).toContain("completely&nbsp;ready");
    expect(result.html).toContain("Updated body");
    expect(
      result.document.blocks.every((block) => block.style?.padding === "tight"),
    ).toBe(true);
  });

  it("does not alter Liquid while replacing nearby raw HTML text", () => {
    const rawDocument: AmieEditDocument = {
      subject: "Hello",
      previewText: "Preview",
      rawHtml: "<p>Hello {{ user.firstName | default: 'there' }}</p>",
      blocks: [
        {
          id: "raw",
          type: "rawHtml",
          params: {
            html: "<p>Hello {{ user.firstName | default: 'there' }}</p>",
          },
        },
      ],
    };
    const result = applyAmieEditOps({
      document: rawDocument,
      ops: [
        {
          type: "replace_text",
          blockId: "raw",
          find: "Hello",
          replace: "Hi",
        },
      ],
      knownUserProperties: ["firstName"],
    });
    expect(result.html).toBe(
      "<p>Hi {{ user.firstName | default: 'there' }}</p>",
    );
  });

  it("keeps the document unchanged for no_op", () => {
    const result = applyAmieEditOps({
      document,
      ops: [{ type: "no_op", reason: "The copy is already concise." }],
    });
    expect(result.document).toEqual(document);
  });

  it("rolls back the complete op set when Liquid is unsafe", () => {
    const result = applyAmieEditOps({
      document,
      ops: [
        { type: "set_subject", value: "Broken {{ unknownProperty }}" },
        { type: "set_preview_text", value: "This must also roll back" },
      ],
    });
    expect(result.document).toEqual(document);
    expect(result.warnings[0]).toMatch(/Liquid check failed/);
  });

  it("rejects missing block ids and invalid style tokens", () => {
    expect(() =>
      applyAmieEditOps({
        document,
        ops: [
          {
            type: "replace_text",
            blockId: "missing",
            find: "a",
            replace: "b",
          },
        ],
      }),
    ).toThrow("Unknown block id");
    expect(() =>
      applyAmieEditOps({
        document,
        ops: [{ type: "set_style_token", name: "padding", value: "enormous" }],
      }),
    ).toThrow("Invalid padding style token");
  });

  it("validates block ids and flags heading widow candidates", () => {
    expect(
      validateEditDocumentIds({
        ...document,
        blocks: [{ type: "header", params: {} }],
      }),
    ).toMatch(/must have an id/);
    expect(renderAmieDocumentText(document)).toContain(
      "WIDOW CANDIDATE: completely ready",
    );
  });
});
