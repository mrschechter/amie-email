/**
 * Friendly, MJML-style names for HTML-mode components (Layer Manager, the
 * selected-component badge). Imported emails are plain table HTML, so
 * GrapesJS would otherwise call things "Table", "Cell", "Div", "Row".
 *
 * Display-only: names are computed in `getName()` from the component's
 * current structure. Nothing is stored on the component, so the project data
 * and the saved HTML are byte-identical with or without this.
 */
import type { Component, Editor } from "grapesjs";

export type FriendlyName =
  | "Body"
  | "Section"
  | "Columns"
  | "Column"
  | "Rows"
  | "Text"
  | "Image"
  | "Button"
  | "Link"
  | "Divider"
  | "Spacer";

function tagOf(component: Component | undefined): string {
  return String(component?.get("tagName") ?? "").toLowerCase();
}

function kids(component: Component): Component[] {
  return component.components().models;
}

function isBlankText(component: Component): boolean {
  return (
    component.get("type") === "textnode" &&
    !String(component.get("content") ?? "")
      .replace(/\u00a0|&nbsp;/g, "")
      .trim()
  );
}

/** Children that matter (whitespace / &nbsp; text nodes and <br> ignored). */
function content(component: Component): Component[] {
  return kids(component).filter((c) => !isBlankText(c) && tagOf(c) !== "br");
}

function styleOf(component: Component): Record<string, string> {
  const style: Record<string, unknown> = component.getStyle();
  const out: Record<string, string> = {};
  Object.entries(style).forEach(([k, v]) => {
    if (typeof v === "string") out[k.toLowerCase()] = v;
  });
  return out;
}

function hasBorderLine(style: Record<string, string>): boolean {
  return [
    "border-top",
    "border-bottom",
    "border-top-width",
    "border-bottom-width",
  ].some((k) => Boolean(style[k]) && !/^(0|none)/.test(style[k] ?? ""));
}

function hasHeight(
  component: Component,
  style: Record<string, string>,
): boolean {
  return Boolean(
    style.height ??
      style["line-height"] ??
      style["min-height"] ??
      component.getAttributes().height,
  );
}

function isEmpty(component: Component): boolean {
  // GrapesJS keeps a text-only element's text in `content`, not as children
  const ownText = String(component.get("content") ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\u00a0|&nbsp;/g, "")
    .trim();
  return content(component).length === 0 && !ownText;
}

function isSpacer(component: Component): boolean {
  return isEmpty(component) && hasHeight(component, styleOf(component));
}

function isDivider(component: Component): boolean {
  if (tagOf(component) === "hr") return true;
  return isEmpty(component) && hasBorderLine(styleOf(component));
}

export function isButtonLink(component: Component): boolean {
  if (tagOf(component) !== "a") return false;
  const style = styleOf(component);
  const classes = component.getClasses().join(" ");
  return (
    /\b(btn|button)\b/i.test(classes) ||
    Boolean(style["background-color"] ?? style.background) ||
    (/inline-block|block/.test(style.display ?? "") && Boolean(style.padding))
  );
}

/** One row, one cell: the table is a wrapper around a single thing. */
function singleCell(table: Component): Component | undefined {
  const body = kids(table).find((c) => tagOf(c) === "tbody") ?? table;
  const rows = kids(body).filter((c) => tagOf(c) === "tr");
  if (rows.length !== 1 || !rows[0]) return undefined;
  const cells = kids(rows[0]).filter((c) => ["td", "th"].includes(tagOf(c)));
  return cells.length === 1 ? cells[0] : undefined;
}

/** What a cell holds when it holds exactly one "block" (button/divider/spacer). */
function cellBlock(cell: Component): FriendlyName | undefined {
  if (isSpacer(cell)) return "Spacer";
  if (isDivider(cell)) return "Divider";
  const inner = content(cell);
  if (inner.length !== 1 || !inner[0]) return undefined;
  const only = inner[0];
  if (isButtonLink(only)) return "Button";
  if (isDivider(only)) return "Divider";
  if (isSpacer(only)) return "Spacer";
  return undefined;
}

function cellsInRow(row: Component | undefined): Component[] {
  return row ? kids(row).filter((c) => ["td", "th"].includes(tagOf(c))) : [];
}

/** The friendly name for an HTML-mode component, or undefined to keep GrapesJS's. */
export function htmlComponentName(
  component: Component,
): FriendlyName | undefined {
  const type = String(component.get("type") ?? "");
  const tag = tagOf(component);
  if (type === "wrapper") return "Body";
  if (type === "image" || tag === "img") return "Image";
  if (tag === "a") return isButtonLink(component) ? "Button" : "Link";
  if (tag === "hr") return "Divider";
  if (tag === "table") {
    const cell = singleCell(component);
    return (cell && cellBlock(cell)) ?? "Section";
  }
  if (["tbody", "thead", "tfoot"].includes(tag)) return "Rows";
  if (tag === "tr")
    return cellsInRow(component).length > 1 ? "Columns" : "Section";
  if (tag === "td" || tag === "th") {
    const block = cellBlock(component);
    if (block === "Spacer" || block === "Divider") return block;
    if (type === "amie-text-cell") return "Text";
    // MJML vocabulary: every cell of a section row is a column, whether it
    // is one of several, has its own width, or spans the full row.
    return "Column";
  }
  if (type === "text") {
    if (isDivider(component)) return "Divider";
    if (isSpacer(component)) return "Spacer";
    return "Text";
  }
  if (/^(p|h[1-6]|blockquote|li|ul|ol)$/.test(tag)) return "Text";
  if (
    ["div", "center", "section", "article", "header", "footer"].includes(tag)
  ) {
    if (isDivider(component)) return "Divider";
    if (isSpacer(component)) return "Spacer";
    return "Section";
  }
  return undefined;
}

const NAMED_TYPES = [
  "default",
  "wrapper",
  "text",
  "amie-text-cell",
  "link",
  "image",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "row",
  "cell",
];

type GetName = (this: Component, opts?: { noCustom?: boolean }) => string;

/**
 * Override `getName()` on the HTML-mode component types. A name the user gave
 * a layer (custom-name) still wins. Call after installTextCells.
 */
export function installFriendlyNames(editor: Editor): void {
  for (const typeId of NAMED_TYPES) {
    const type = editor.Components.getType(typeId);
    if (!type) continue;
    // getType returns the class; its prototype holds the current getName
    const proto: { getName?: GetName } = type.model.prototype;
    const original = proto.getName;
    if (!original) continue;
    editor.Components.addType(typeId, {
      model: {
        getName(this: Component, opts?: { noCustom?: boolean }) {
          const custom: unknown = this.get("custom-name");
          if (!opts?.noCustom && typeof custom === "string" && custom) {
            return custom;
          }
          return htmlComponentName(this) ?? original.call(this, opts);
        },
      },
    });
  }
}
