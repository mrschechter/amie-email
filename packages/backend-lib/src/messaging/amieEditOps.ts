import {
  AMIE_MAX_BLOCKS,
  AmieBlockSpec,
  AmieBlockStyle,
  AmieEditDocument,
  AmieEditOp,
} from "isomorphic-lib/src/amieComposer";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";

import { assembleEmail } from "./amieBlocks";
import {
  mapOutsideLiquid,
  normalizeLiquid,
  validateLiquid,
} from "./amieLiquid";

const STYLE_VALUES: {
  [K in keyof AmieBlockStyle]-?: readonly NonNullable<AmieBlockStyle[K]>[];
} = {
  background: ["ivory", "blush", "white", "teal", "sage", "custom"],
  backgroundHex: [],
  align: ["left", "center"],
  padding: ["tight", "normal", "loose", "none"],
  textSize: ["s", "m", "l"],
  buttonVariant: ["primary", "secondary", "roseGold"],
  width: ["full", "inset"],
};

function replacePlainText(
  value: string,
  find: string,
  replace: string,
): string {
  return mapOutsideLiquid(value, (plain) => plain.split(find).join(replace));
}

function transformStrings(
  value: unknown,
  transform: (text: string) => string,
): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value))
    return value.map((item) => transformStrings(item, transform));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        transformStrings(item, transform),
      ]),
    );
  }
  return value;
}

function validatedBlock(value: unknown): AmieBlockSpec {
  const result = schemaValidate(value, AmieBlockSpec);
  if (result.isErr()) {
    const first = result.error[0];
    throw new Error(
      `Edit produced an invalid block${first ? ` at ${first.path}: ${first.message}` : ""}`,
    );
  }
  return result.value;
}

function normalizeBlock(
  block: AmieBlockSpec,
  knownUserProperties: readonly string[],
): AmieBlockSpec {
  return validatedBlock(
    transformStrings(block, (text) =>
      normalizeLiquid(text, knownUserProperties),
    ),
  );
}

function blockIndex(blocks: AmieBlockSpec[], id: string): number {
  const index = blocks.findIndex((block) => block.id === id);
  if (index === -1) throw new Error(`Unknown block id: ${id}`);
  return index;
}

function insertionIndex(blocks: AmieBlockSpec[], afterBlockId: string | null) {
  return afterBlockId === null ? 0 : blockIndex(blocks, afterBlockId) + 1;
}

export function normalizeBlockLimitedAmieEditOps(
  document: AmieEditDocument,
  ops: AmieEditOp[],
): AmieEditOp[] {
  const blockIds = new Set(document.blocks.map((block) => block.id));
  let blockCount = document.blocks.length;
  return ops.map((op): AmieEditOp => {
    if (op.type === "remove_block" && blockIds.delete(op.blockId)) {
      blockCount -= 1;
      return op;
    }
    if (op.type !== "insert_block") return op;
    if (blockIds.has(op.block.id)) return op;
    if (blockCount >= AMIE_MAX_BLOCKS) {
      return {
        type: "no_op",
        reason: `The email already has the maximum of ${AMIE_MAX_BLOCKS} blocks, so another block was not inserted.`,
      };
    }
    blockIds.add(op.block.id);
    blockCount += 1;
    return op;
  });
}

export function validateEditDocumentIds(
  document: AmieEditDocument,
): string | null {
  const ids = document.blocks.map((block) => block.id);
  if (ids.some((id) => !id))
    return "Every edit document block must have an id.";
  if (new Set(ids).size !== ids.length)
    return "Edit document block ids must be unique.";
  return null;
}

function applyOne(blocks: AmieBlockSpec[], op: AmieEditOp): AmieBlockSpec[] {
  if (
    op.type === "no_op" ||
    op.type === "set_subject" ||
    op.type === "set_preview_text"
  ) {
    return blocks;
  }
  if (op.type === "insert_block") {
    if (!op.block.id) throw new Error("An inserted block must have an id.");
    if (blocks.some((block) => block.id === op.block.id))
      throw new Error(`Duplicate block id: ${op.block.id}`);
    const next = [...blocks];
    next.splice(insertionIndex(next, op.afterBlockId), 0, op.block);
    if (next.length > AMIE_MAX_BLOCKS)
      throw new Error(
        `An edit cannot create more than ${AMIE_MAX_BLOCKS} blocks.`,
      );
    return next;
  }
  if (op.type === "remove_block") {
    const index = blockIndex(blocks, op.blockId);
    return [...blocks.slice(0, index), ...blocks.slice(index + 1)];
  }
  if (op.type === "move_block") {
    if (op.afterBlockId === op.blockId)
      throw new Error("A block cannot be moved after itself.");
    const from = blockIndex(blocks, op.blockId);
    const next = [...blocks];
    const [moving] = next.splice(from, 1);
    if (!moving) throw new Error(`Unknown block id: ${op.blockId}`);
    next.splice(insertionIndex(next, op.afterBlockId), 0, moving);
    return next;
  }
  if (op.type === "set_style_token") {
    const allowed = STYLE_VALUES[op.name];
    const validHex =
      op.name === "backgroundHex" && /^#[0-9A-Fa-f]{6}$/.test(op.value);
    if (!validHex && !allowed.some((value) => value === op.value))
      throw new Error(`Invalid ${op.name} style token: ${op.value}`);
    return blocks.map((block) =>
      validatedBlock({
        ...block,
        style: { ...block.style, [op.name]: op.value },
      }),
    );
  }

  const index = blockIndex(blocks, op.blockId);
  const target = blocks[index];
  if (!target) throw new Error(`Unknown block id: ${op.blockId}`);
  let updated: AmieBlockSpec;
  if (op.type === "replace_text") {
    const params = transformStrings(target.params, (text) =>
      replacePlainText(text, op.find, op.replace),
    );
    if (JSON.stringify(params) === JSON.stringify(target.params))
      throw new Error(`Text not found in block ${op.blockId}: ${op.find}`);
    updated = validatedBlock({
      ...target,
      params,
    });
  } else {
    const { props } = op;
    updated = validatedBlock({
      ...target,
      ...props,
      id: target.id,
      type: target.type,
      params:
        typeof props.params === "object" && props.params !== null
          ? { ...target.params, ...props.params }
          : target.params,
      style:
        typeof props.style === "object" && props.style !== null
          ? { ...target.style, ...props.style }
          : target.style,
    });
  }
  const next = [...blocks];
  next[index] = updated;
  return next;
}

export function applyAmieEditOps({
  document,
  ops,
  knownUserProperties = [],
}: {
  document: AmieEditDocument;
  ops: AmieEditOp[];
  knownUserProperties?: readonly string[];
}): { document: AmieEditDocument; html: string; warnings: string[] } {
  const idError = validateEditDocumentIds(document);
  if (idError) throw new Error(idError);
  if (ops.every((op) => op.type === "no_op")) {
    return {
      document,
      html:
        document.rawHtml ??
        assembleEmail(document.blocks, document.previewText),
      warnings: [],
    };
  }
  let { previewText, subject } = document;
  let blocks = [...document.blocks];
  let { rawHtml } = document;
  for (const op of ops) {
    if (op.type === "set_subject") subject = op.value;
    else if (op.type === "set_preview_text") previewText = op.value;
    else if (
      rawHtml !== undefined &&
      op.type === "replace_text" &&
      document.blocks.find((block) => block.id === op.blockId)?.type ===
        "rawHtml"
    ) {
      const updatedRawHtml = replacePlainText(rawHtml, op.find, op.replace);
      if (updatedRawHtml === rawHtml)
        throw new Error(`Text not found in block ${op.blockId}: ${op.find}`);
      rawHtml = updatedRawHtml;
      blocks = blocks.map((block) =>
        block.id === op.blockId && block.type === "rawHtml"
          ? { ...block, params: { html: updatedRawHtml } }
          : block,
      );
    } else {
      blocks = applyOne(blocks, op);
    }
  }

  subject = normalizeLiquid(subject, knownUserProperties);
  previewText = normalizeLiquid(previewText, knownUserProperties);
  blocks = blocks.map((block) => normalizeBlock(block, knownUserProperties));
  if (rawHtml !== undefined)
    rawHtml = normalizeLiquid(rawHtml, knownUserProperties);
  const nextDocument: AmieEditDocument = {
    subject,
    previewText,
    blocks,
    ...(rawHtml === undefined ? {} : { rawHtml }),
  };
  const html = rawHtml ?? assembleEmail(blocks, previewText);
  const liquidError = validateLiquid(
    [subject, previewText, html].join("\n"),
    knownUserProperties,
  );
  if (liquidError) {
    const originalHtml =
      document.rawHtml ?? assembleEmail(document.blocks, document.previewText);
    return {
      document,
      html: originalHtml,
      warnings: [
        `Liquid check failed; no changes were applied. ${liquidError}`,
      ],
    };
  }
  return { document: nextDocument, html, warnings: [] };
}

function blockText(block: AmieBlockSpec): string[] {
  const values: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") values.push(value.replace(/<[^>]+>/g, " "));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === "object" && value !== null)
      Object.values(value).forEach(visit);
  };
  visit(block.params);
  return values;
}

function wrapText(text: string, width: number): string {
  const words = text
    .replace(/&nbsp;/gi, "\u00a0")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    if (!line || `${line} ${word}`.length <= width)
      line = line ? `${line} ${word}` : word;
    else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.join("\n");
}

function blockHeadings(block: AmieBlockSpec): string[] {
  if (block.type === "heroHeading") return [block.params.title];
  if (block.type === "heroImage" && block.params.headline)
    return [block.params.headline];
  if (block.type === "productCard") return [block.params.title];
  if (block.type === "twoColumn" && block.params.heading)
    return [block.params.heading];
  if (block.type === "imageText" && block.params.heading)
    return [block.params.heading];
  if (block.type === "columns")
    return block.params.columns.map((column) => column.heading);
  if (block.type === "bulletList" && block.params.heading)
    return [block.params.heading];
  return [];
}

/** A deterministic 600px preview approximation supplied to the edit model. */
export function renderAmieDocumentText(document: AmieEditDocument): string {
  return document.blocks
    .map((block) => {
      const headings = blockHeadings(block);
      const text = blockText(block)
        .map((value) => wrapText(value, headings.includes(value) ? 31 : 68))
        .join("\n");
      const widowCandidates = headings.map((heading) =>
        heading.trim().split(/\s+/).slice(-2).join(" "),
      );
      return [
        `[${block.id ?? "missing-id"}:${block.type}]`,
        text,
        ...widowCandidates.map((words) => `WIDOW CANDIDATE: ${words}`),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
