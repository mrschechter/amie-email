/**
 * Component behaviour for the visual email editor:
 * - image settings (src with the asset manager, alt, link URL, target) for
 *   plain `<img>` in HTML mode and `<mj-image>` in MJML mode;
 * - editable text directly inside table cells (common in Mautic emails);
 * - placing dropped blocks so they fit table-based layouts in HTML mode.
 */
import type { Component, Editor } from "grapesjs";

const LINK_TARGET_OPTIONS = [
  { id: "_blank", label: "New tab" },
  { id: "", label: "Same tab" },
];

function isMjImage(component: Component): boolean {
  return component.get("type") === "mj-image";
}

/** The `<a>` that wraps only this image (the image's link), if any. */
export function imageLinkParent(image: Component): Component | undefined {
  const parent = image.parent();
  if (!parent || parent.get("tagName") !== "a") return undefined;
  return parent;
}

export interface ImageLink {
  href: string;
  target: string;
}

export function getImageLink(image: Component): ImageLink {
  const attrs: Record<string, unknown> = isMjImage(image)
    ? image.getAttributes()
    : imageLinkParent(image)?.getAttributes() ?? {};
  return {
    href: typeof attrs.href === "string" ? attrs.href : "",
    target: typeof attrs.target === "string" ? attrs.target : "",
  };
}

/**
 * Set the link around an image. HTML mode wraps the `<img>` in an `<a>` (or
 * edits/unwraps the existing one); MJML mode uses `mj-image`'s own href and
 * target attributes. `href` is written exactly as typed (Liquid allowed).
 * Returns the image component (it is re-created when wrapping/unwrapping).
 */
export function setImageLink(
  image: Component,
  link: Partial<ImageLink>,
): Component {
  const current = getImageLink(image);
  const href = (link.href ?? current.href).trim();
  const target = link.target ?? current.target;
  if (isMjImage(image)) {
    if (href) image.addAttributes({ href });
    else image.removeAttributes("href");
    if (target) image.addAttributes({ target });
    else image.removeAttributes("target");
    return image;
  }
  const parentLink = imageLinkParent(image);
  if (parentLink) {
    if (href) {
      parentLink.addAttributes({ href });
      if (target) parentLink.addAttributes({ target });
      else parentLink.removeAttributes("target");
      return image;
    }
    if (parentLink.components().length > 1) {
      // the link also wraps other content; keep it, just drop the href
      parentLink.removeAttributes(["href", "target"]);
      return image;
    }
    const replaced = parentLink.replaceWith(image.toJSON());
    return Array.isArray(replaced) ? replaced[0] ?? image : replaced;
  }
  if (!href) return image;
  const wrapped = image.replaceWith({
    type: "link",
    tagName: "a",
    attributes: target ? { href, target } : { href },
    components: [image.toJSON()],
  });
  const linkComponent = Array.isArray(wrapped) ? wrapped[0] : wrapped;
  return linkComponent?.components().at(0) ?? image;
}

export function getImageSrc(image: Component): string {
  const src: unknown = isMjImage(image)
    ? image.getAttributes().src
    : image.get("src");
  return typeof src === "string" ? src : "";
}

export function setImageSrc(image: Component, src: string): void {
  // `src` lives both as a property (GrapesJS image) and, for mj-image, as
  // the MJML attribute; the canvas re-syncs one from the other, so set both.
  image.set("src", src);
  if (isMjImage(image)) image.addAttributes({ src });
}

function openImagePicker(editor: Editor, image: Component): void {
  editor.Assets.open({
    types: ["image"],
    accept: "image/*",
    select: (asset, complete) => {
      setImageSrc(image, asset.getSrc());
      if (complete) editor.Assets.close();
    },
  });
}

/**
 * Image settings panel: Image URL (+ choose/upload from the asset manager),
 * alt text, link URL and link target. Works on images in imported HTML and
 * in MJML.
 */
export function imageTraits() {
  return [
    {
      type: "text",
      name: "amie-image-src",
      label: "Image URL",
      getValue: ({ component }: { component: Component }) =>
        getImageSrc(component),
      setValue: ({
        component,
        value,
      }: {
        component: Component;
        value: unknown;
      }) => setImageSrc(component, String(value ?? "").trim()),
    },
    {
      type: "button",
      name: "amie-choose-image",
      label: " ",
      text: "Choose or upload image",
      full: true,
      command: (editor: Editor) => {
        const image = editor.getSelected();
        if (image) openImagePicker(editor, image);
      },
    },
    { type: "text", name: "alt", label: "Alt text" },
    {
      type: "text",
      name: "amie-link-href",
      label: "Link URL",
      placeholder: "https://… or {% unsubscribe_url %}",
      getValue: ({ component }: { component: Component }) =>
        getImageLink(component).href,
      setValue: ({
        component,
        value,
        editor,
      }: {
        component: Component;
        value: unknown;
        editor: Editor;
      }) => {
        const next = setImageLink(component, { href: String(value ?? "") });
        if (next !== component) editor.select(next);
      },
    },
    {
      type: "select",
      name: "amie-link-target",
      label: "Open link in",
      options: LINK_TARGET_OPTIONS,
      getValue: ({ component }: { component: Component }) =>
        getImageLink(component).target,
      setValue: ({
        component,
        value,
        editor,
      }: {
        component: Component;
        value: unknown;
        editor: Editor;
      }) => {
        const next = setImageLink(component, { target: String(value ?? "") });
        if (next !== component) editor.select(next);
      },
    },
  ];
}

export function installImageSettings(
  editor: Editor,
  mode: "mjml" | "html",
): void {
  const type = mode === "mjml" ? "mj-image" : "image";
  const traits: Record<string, unknown>[] = [...imageTraits()];
  // keep mj-image's own title trait after ours
  if (mode === "mjml")
    traits.push({ type: "text", name: "title", label: "Title" });
  editor.Components.addType(type, {
    model: { defaults: { traits } },
  });
}

/* ------------------------------------------------------------------ */
/* Text directly in table cells (HTML mode)                             */
/* ------------------------------------------------------------------ */

const INLINE_TAGS = new Set([
  "A",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "SPAN",
  "FONT",
  "BR",
  "SUB",
  "SUP",
  "SMALL",
  "BIG",
  "MARK",
]);

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

function inlineOnly(el: Element): boolean {
  return Array.from(el.childNodes).every((node) => {
    if (node.nodeType === 3 || node.nodeType === 8) return true;
    if (!isElementNode(node)) return false;
    return INLINE_TAGS.has(node.tagName) && inlineOnly(node);
  });
}

/** Text (with only inline formatting/links) and nothing else. */
function onlyInlineText(el: Element): boolean {
  return Boolean(el.textContent?.trim()) && inlineOnly(el);
}

/**
 * Mautic emails often put text straight into `<td>`. GrapesJS treats those as
 * table cells with uneditable text nodes; make them text components (same
 * tag and attributes) so the rich text toolbar works on them.
 */
export function installTextCells(editor: Editor): void {
  editor.Components.addType("amie-text-cell", {
    extend: "text",
    isComponent: (el: HTMLElement) =>
      (el.tagName === "TD" || el.tagName === "TH") && onlyInlineText(el)
        ? { type: "amie-text-cell", tagName: el.tagName.toLowerCase() }
        : undefined,
    model: {
      defaults: { name: "Text cell", draggable: ["tr"], droppable: false },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Dropped block placement (HTML mode)                                  */
/* ------------------------------------------------------------------ */

const TABLE_SECTION_TAGS = new Set(["table", "tbody", "thead", "tfoot"]);

function tagOf(component: Component | undefined): string {
  return String(component?.get("tagName") ?? "").toLowerCase();
}

function children(component: Component): Component[] {
  return component.components().models;
}

/** The rows container of a table (its tbody, or the table itself). */
function rowsOf(table: Component): Component {
  return children(table).find((c) => tagOf(c) === "tbody") ?? table;
}

function rows(table: Component): Component[] {
  return children(rowsOf(table)).filter((c) => tagOf(c) === "tr");
}

function cellsOf(row: Component): Component[] {
  return children(row).filter((c) => ["td", "th"].includes(tagOf(c)));
}

function isWrapper(component: Component, editor: Editor): boolean {
  return component === editor.getWrapper();
}

/** A container that only holds layout tables (besides `except`). */
function isLayoutContainer(component: Component, except: Component): boolean {
  const others = children(component).filter(
    (c) =>
      c !== except &&
      !(c.get("type") === "textnode" && !String(c.get("content") ?? "").trim()),
  );
  return others.length > 0 && others.every((c) => tagOf(c) === "table");
}

/**
 * Descend through single-cell wrapper tables (the 100%-wide background table
 * around the 600px card) to the table whose rows hold the content.
 */
export function contentTableOf(table: Component, fromEnd: boolean): Component {
  let current = table;
  for (;;) {
    const [onlyRow, ...otherRows] = rows(current);
    if (!onlyRow || otherRows.length) return current;
    const [cell, ...otherCells] = cellsOf(onlyRow);
    if (!cell || otherCells.length) return current;
    const content = children(cell).filter(
      (c) =>
        !(
          c.get("type") === "textnode" && !String(c.get("content") ?? "").trim()
        ),
    );
    if (!content.length || !content.every((c) => tagOf(c) === "table")) {
      return current;
    }
    const next = fromEnd ? content[content.length - 1] : content[0];
    if (!next) return current;
    current = next;
  }
}

function paddingFrom(row: Component | undefined): string {
  const cell = row ? cellsOf(row)[0] : undefined;
  const style = cell?.getStyle() ?? {};
  const left = style["padding-left"] ?? undefined;
  const right = style["padding-right"] ?? undefined;
  const shorthand =
    typeof style.padding === "string" ? style.padding.split(/\s+/) : [];
  // padding shorthand: 1 value = all sides; 2+ = top right [bottom [left]]
  let horizontalFromShorthand: (string | undefined)[] = [];
  if (shorthand.length === 1) {
    horizontalFromShorthand = [shorthand[0], shorthand[0]];
  } else if (shorthand.length >= 2) {
    horizontalFromShorthand = [shorthand[1], shorthand[3] ?? shorthand[1]];
  }
  const r = String(right ?? horizontalFromShorthand[0] ?? "24px");
  const l = String(left ?? horizontalFromShorthand[1] ?? "24px");
  return `8px ${r} 8px ${l}`;
}

/** Wrap `component` in a full-width row/cell inside `table` at `at`. */
function insertAsRow(
  table: Component,
  component: Component,
  at: number,
): Component {
  const container = rowsOf(table);
  const existing = rows(table);
  const neighbour =
    existing[Math.min(Math.max(at - 1, 0), existing.length - 1)];
  const colspan = Math.max(1, ...existing.map((r) => cellsOf(r).length));
  const added = container.components().add(
    {
      tagName: "tr",
      type: "row",
      components: [
        {
          tagName: "td",
          type: "cell",
          attributes: colspan > 1 ? { colspan: String(colspan) } : {},
          style: { padding: paddingFrom(neighbour) },
        },
      ],
    },
    { at },
  );
  const row = Array.isArray(added) ? added[0] : added;
  const cell = row?.components().at(0);
  if (!cell) return component;
  // move the dropped component itself (keeps its children and identity)
  component.move(cell, { at: 0 });
  return component;
}

/**
 * After a block is dropped in HTML mode, make sure it sits inside a content
 * cell. Drops between layout tables (outside the email's content card), or
 * straight into a table/row, become a new full-width row of the nearest
 * content table, padded like its neighbouring rows. Returns the (possibly
 * re-created) component.
 */
export function placeDroppedComponent(
  editor: Editor,
  component: Component,
): Component {
  const parent = component.parent();
  if (!parent) return component;
  const parentTag = tagOf(parent);

  if (TABLE_SECTION_TAGS.has(parentTag)) {
    const table = parentTag === "table" ? parent : parent.parent();
    if (!table) return component;
    const siblings = children(parent);
    const rowsBefore = siblings
      .slice(0, siblings.indexOf(component))
      .filter((c) => tagOf(c) === "tr" || tagOf(c) === "tbody").length;
    let at = rowsBefore;
    // dropped next to the table's <tbody>: before it = first row, after = last
    if (parentTag === "table" && rowsOf(table) !== table) {
      at = rowsBefore > 0 ? rows(table).length : 0;
    }
    return insertAsRow(table, component, at);
  }
  if (parentTag === "tr") {
    const container = parent.parent();
    const table =
      tagOf(container) === "table" ? container : container?.parent();
    if (table) {
      return insertAsRow(table, component, rows(table).indexOf(parent) + 1);
    }
  }
  const layout =
    (isWrapper(parent, editor) ||
      ["td", "th", "div", "center"].includes(parentTag)) &&
    isLayoutContainer(parent, component);
  if (!layout) return component;
  const siblings = children(parent);
  const index = siblings.indexOf(component);
  const before = siblings
    .slice(0, index)
    .reverse()
    .find((c) => tagOf(c) === "table");
  const after = siblings.slice(index + 1).find((c) => tagOf(c) === "table");
  if (before) {
    const table = contentTableOf(before, true);
    return insertAsRow(table, component, rows(table).length);
  }
  if (after) {
    const table = contentTableOf(after, false);
    return insertAsRow(table, component, 0);
  }
  return component;
}

export function installBlockPlacement(editor: Editor): void {
  editor.on("block:drag:stop", (dropped?: Component | Component[]) => {
    let list: Component[] = [];
    if (Array.isArray(dropped)) list = dropped;
    else if (dropped) list = [dropped];
    list.forEach((component) => {
      const placed = placeDroppedComponent(editor, component);
      if (placed !== component) editor.select(placed);
    });
  });
}

/** Everything HTML mode adds to plain GrapesJS. Call before loading content. */
export function configureHtmlModeComponents(editor: Editor): void {
  installTextCells(editor);
  installImageSettings(editor, "html");
  installBlockPlacement(editor);
}
