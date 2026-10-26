/**
 * Rich text toolbar for the visual email editor (both MJML and HTML mode).
 *
 * GrapesJS 0.23's built-in RTE only ships bold/italic/underline/strike/link
 * and runs `document.execCommand`, whose output varies by browser (`<font>`
 * tags, `size="4"`) and can't be unit tested. Everything beyond the four
 * built-ins is implemented here with plain DOM Range operations, so the
 * output is always email-safe: semantic tags (`<a>`, `<ul>`, `<b>`) or
 * `<span style="...">` with inline styles — never classes that depend on
 * editor CSS. Liquid is inserted as a literal text node, byte-for-byte.
 */
import type { Component, Editor, RichTextEditorAction } from "grapesjs";

import {
  COLOR_POPOVER_CSS,
  openColorPopover,
  rgbToHex,
} from "./visualEmailColor";
import { VISUAL_EMAIL_VARIABLES } from "./visualEmailDesign";
import { MONTSERRAT_STACK } from "./visualEmailFonts";

/** GrapesJS doesn't export its RTE class type; take it from the action API. */
type RichTextEditor = Parameters<RichTextEditorAction["result"]>[0];

/** Email-safe font stacks (web-safe fonts every major client has). */
export const RTE_FONTS: { label: string; value: string }[] = [
  { label: "Helvetica / Arial", value: "Helvetica, Arial, sans-serif" },
  // web font: loaded in the canvas, linked in the email head when used;
  // clients without web fonts fall back to Arial/Helvetica
  { label: "Montserrat", value: MONTSERRAT_STACK },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Verdana, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
];

export const RTE_FONT_SIZES = [
  10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 48,
];

const FORMATTING_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "SPAN",
  "FONT",
  "MARK",
  "SUB",
  "SUP",
  "SMALL",
  "BIG",
]);

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "TD",
  "TH",
  "BLOCKQUOTE",
]);

/** Roots that can't legally contain a list (`<ul>` inside `<p>` is invalid). */
const PHRASING_ROOTS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SPAN",
  "A",
]);

function isElement(node: Node | null | undefined): node is HTMLElement {
  return Boolean(node) && node?.nodeType === 1;
}

function isParentNode(node: Node): node is Element | DocumentFragment {
  return node.nodeType === 1 || node.nodeType === 11;
}

function closest(
  root: HTMLElement,
  node: Node | null,
  match: (el: HTMLElement) => boolean,
): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (isElement(current) && match(current)) return current;
    current = current.parentNode;
  }
  return null;
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function selectContents(range: Range, el: Node): Range {
  range.selectNodeContents(el);
  return range;
}

function parseStyle(style: string | null): [string, string][] {
  const entries: [string, string][] = [];
  for (const declaration of (style ?? "").split(";")) {
    const i = declaration.indexOf(":");
    const value = i > 0 ? declaration.slice(i + 1).trim() : "";
    if (value)
      entries.push([declaration.slice(0, i).trim().toLowerCase(), value]);
  }
  return entries;
}

function writeStyle(el: Element, entries: [string, string][]): void {
  if (entries.length) {
    el.setAttribute("style", entries.map(([k, v]) => `${k}:${v};`).join(""));
  } else {
    el.removeAttribute("style");
  }
}

function setStyleProperty(el: Element, prop: string, value: string): void {
  const entries = parseStyle(el.getAttribute("style")).filter(
    ([k]) => k !== prop,
  );
  if (value) entries.push([prop, value]);
  writeStyle(el, entries);
}

/** Remove `prop` from every element in `node` and drop spans left without styling. */
function stripStyleProperty(node: Node, prop: string): void {
  // nodeType, not instanceof: canvas nodes come from the iframe's realm
  if (!isParentNode(node)) return;
  const elements = Array.from(node.querySelectorAll("[style]"));
  for (const el of elements) {
    setStyleProperty(el, prop, "");
    if (el.tagName === "SPAN" && !el.attributes.length) unwrap(el);
  }
}

/** The span whose whole content is exactly the selection, if there is one. */
function exactSpan(root: HTMLElement, range: Range): HTMLElement | null {
  const text = range.toString();
  if (!text) return null;
  const span = closest(
    root,
    range.commonAncestorContainer,
    (el) => el.tagName === "SPAN",
  );
  return span && span.textContent === text ? span : null;
}

/**
 * Apply one CSS property (color, font-size …) to the selection as an inline
 * style. Re-applying to the same selection updates the span instead of
 * nesting another; an empty value removes the property.
 */
export function applyInlineStyle(
  root: HTMLElement,
  range: Range,
  prop: string,
  value: string,
): Range {
  if (range.collapsed) return range;
  const existing = exactSpan(root, range);
  if (existing) {
    stripStyleProperty(existing, prop);
    setStyleProperty(existing, prop, value);
    if (!existing.attributes.length) {
      const parent = existing.parentNode;
      const first = existing.firstChild;
      const last = existing.lastChild;
      unwrap(existing);
      if (parent && first && last) {
        range.setStartBefore(first);
        range.setEndAfter(last);
      }
      return range;
    }
    return selectContents(range, existing);
  }
  const doc = root.ownerDocument;
  const fragment = range.extractContents();
  stripStyleProperty(fragment, prop);
  if (!value) {
    range.insertNode(fragment);
    return range;
  }
  const span = doc.createElement("span");
  setStyleProperty(span, prop, value);
  span.appendChild(fragment);
  range.insertNode(span);
  return selectContents(range, span);
}

export interface LinkOptions {
  href: string;
  /** `_blank` opens in a new tab; empty means the same tab (no attribute). */
  target: string;
}

export function linkAt(root: HTMLElement, range: Range): HTMLElement | null {
  return closest(
    root,
    range.commonAncestorContainer,
    (el) => el.tagName === "A",
  );
}

export function readLink(root: HTMLElement, range: Range): LinkOptions | null {
  const a = linkAt(root, range);
  return a
    ? {
        href: a.getAttribute("href") ?? "",
        target: a.getAttribute("target") ?? "",
      }
    : null;
}

function setLinkAttributes(a: Element, { href, target }: LinkOptions): void {
  a.setAttribute("href", href);
  if (target) a.setAttribute("target", target);
  else a.removeAttribute("target");
}

/** Insert or edit a link. `href` is written exactly (Liquid allowed). */
export function applyLink(
  root: HTMLElement,
  range: Range,
  options: LinkOptions,
): Range {
  const existing = linkAt(root, range);
  if (existing) {
    setLinkAttributes(existing, options);
    return selectContents(range, existing);
  }
  const doc = root.ownerDocument;
  const a = doc.createElement("a");
  setLinkAttributes(a, options);
  if (range.collapsed) {
    a.textContent = options.href;
  } else {
    const fragment = range.extractContents();
    // links can't nest
    fragment.querySelectorAll("a").forEach((inner) => unwrap(inner));
    a.appendChild(fragment);
  }
  range.insertNode(a);
  return selectContents(range, a);
}

/** Remove the link around (or inside) the selection, keeping its text. */
export function removeLink(root: HTMLElement, range: Range): Range {
  const existing = linkAt(root, range);
  if (existing) {
    const first = existing.firstChild;
    const last = existing.lastChild;
    unwrap(existing);
    if (first && last) {
      range.setStartBefore(first);
      range.setEndAfter(last);
    }
    return range;
  }
  if (range.collapsed) return range;
  const fragment = range.extractContents();
  fragment.querySelectorAll("a").forEach((a) => unwrap(a));
  const first = fragment.firstChild;
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (first && last) {
    range.setStartBefore(first);
    range.setEndAfter(last);
  }
  return range;
}

/**
 * Move the range's insertion point out of any formatting elements (b, span…)
 * between it and `root`, splitting them, so inserted content is unformatted.
 */
function splitFormattingAt(root: HTMLElement, range: Range): void {
  const doc = root.ownerDocument;
  let ancestor = closest(root, range.startContainer, (el) =>
    FORMATTING_TAGS.has(el.tagName),
  );
  while (ancestor) {
    const tail = doc.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(ancestor, ancestor.childNodes.length);
    const clone = ancestor.cloneNode(false);
    clone.appendChild(tail.extractContents());
    const parent = ancestor.parentNode;
    if (!parent) return;
    parent.insertBefore(clone, ancestor.nextSibling);
    if (!ancestor.textContent) parent.removeChild(ancestor);
    const index = Array.from<Node>(parent.childNodes).indexOf(clone);
    if (!clone.textContent) parent.removeChild(clone);
    range.setStart(parent, Math.max(index, 0));
    range.collapse(true);
    ancestor = closest(root, range.startContainer, (el) =>
      FORMATTING_TAGS.has(el.tagName),
    );
  }
}

/** Strip bold/italic/colors/fonts from the selection; links and line breaks stay. */
export function clearFormatting(root: HTMLElement, range: Range): Range {
  if (range.collapsed) return range;
  const fragment = range.extractContents();
  Array.from(fragment.querySelectorAll("*"))
    .reverse()
    .forEach((el) => {
      if (FORMATTING_TAGS.has(el.tagName)) unwrap(el);
      else el.removeAttribute("style");
    });
  splitFormattingAt(root, range);
  const first = fragment.firstChild;
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (first && last) {
    range.setStartBefore(first);
    range.setEndAfter(last);
  }
  return range;
}

/** Insert text (a Liquid tag) exactly as given, replacing the selection. */
export function insertTextAt(
  root: HTMLElement,
  range: Range,
  text: string,
): Range {
  range.deleteContents();
  const node = root.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  return range;
}

export type Alignment = "left" | "center" | "right" | "justify";

/**
 * Align the block containing the selection. Returns false when the selection
 * is directly in the editable root (e.g. a `<p>` or `<mj-text>` component):
 * then the caller aligns the component itself, so the style is kept on save.
 */
export function alignBlock(
  root: HTMLElement,
  range: Range,
  align: Alignment,
): boolean {
  const block = closest(root, range.commonAncestorContainer, (el) =>
    BLOCK_TAGS.has(el.tagName),
  );
  if (!block) return false;
  setStyleProperty(block, "text-align", align);
  return true;
}

export type ListType = "ul" | "ol";

export function canInsertList(root: HTMLElement): boolean {
  return !PHRASING_ROOTS.has(root.tagName);
}

/**
 * Toggle a bulleted/numbered list. Lines (split on `<br>`) in the selection
 * become `<li>` items; toggling inside the same list type turns it back into
 * lines. Lists get inline spacing so they look the same in every client.
 */
export function toggleList(
  root: HTMLElement,
  range: Range,
  type: ListType,
): Range {
  const doc = root.ownerDocument;
  const tag = type.toUpperCase();
  const list = closest(
    root,
    range.commonAncestorContainer,
    (el) => el.tagName === tag,
  );
  if (list) {
    const fragment = doc.createDocumentFragment();
    const items = Array.from(list.children).filter((el) => el.tagName === "LI");
    items.forEach((li, i) => {
      while (li.firstChild) fragment.appendChild(li.firstChild);
      if (i < items.length - 1) fragment.appendChild(doc.createElement("br"));
    });
    const first = fragment.firstChild;
    const last = fragment.lastChild;
    list.parentNode?.replaceChild(fragment, list);
    if (first && last) {
      range.setStartBefore(first);
      range.setEndAfter(last);
    }
    return range;
  }
  if (!canInsertList(root)) return range;
  if (range.collapsed) {
    // whole root content becomes the list
    range.selectNodeContents(root);
  }
  const fragment = range.extractContents();
  const el = doc.createElement(type);
  el.setAttribute("style", "margin:0 0 16px;padding-left:24px;");
  let li = doc.createElement("li");
  const pushItem = () => {
    if (li.childNodes.length) el.appendChild(li);
    li = doc.createElement("li");
  };
  Array.from(fragment.childNodes).forEach((node) => {
    if (isElement(node) && node.tagName === "BR") pushItem();
    else if (
      isElement(node) &&
      BLOCK_TAGS.has(node.tagName) &&
      node.tagName !== "LI"
    ) {
      pushItem();
      while (node.firstChild) li.appendChild(node.firstChild);
      pushItem();
    } else li.appendChild(node);
  });
  pushItem();
  if (!el.childNodes.length) el.appendChild(doc.createElement("li"));
  range.insertNode(el);
  return selectContents(range, el);
}

/* ------------------------------------------------------------------ */
/* Toolbar wiring                                                       */
/* ------------------------------------------------------------------ */

export interface RteToolbarOptions {
  mode: "mjml" | "html";
  /** Open the link dialog; `apply(null)` removes the link. */
  openLinkDialog: (
    current: LinkOptions | null,
    apply: (link: LinkOptions | null) => void,
  ) => void;
}

/** CSS for the GrapesJS RTE toolbar (rendered in the editor UI, not the email). */
export const RTE_TOOLBAR_CSS = `
.gjs-rte-toolbar { max-width: 620px; }
.gjs-rte-actionbar { flex-wrap: wrap; }
.gjs-rte-action { width: auto; min-width: 26px; height: 28px; box-sizing: border-box; font-size: 13px; }
.gjs-rte-action select, .gjs-rte-action input { font-size: 12px; color: #333; background: #fff; border: 0; border-radius: 3px; height: 20px; }
.gjs-rte-action .amie-color-icon { display: inline-flex; flex-direction: column; align-items: center; line-height: 14px; }
.gjs-rte-action .amie-color-bar { display: block; width: 16px; height: 3px; margin-top: 1px; border: 1px solid rgba(255,255,255,.4); }
.gjs-rte-action.amie-rte-disabled { opacity: 0.35; cursor: not-allowed; }
${COLOR_POPOVER_CSS}`;

/** The parts of the RTE the actions touch (lets tests use a plain element). */
export type RteLike = Pick<RichTextEditor, "el" | "doc" | "selection">;

function currentRange(rte: RteLike): Range | null {
  const sel = rte.selection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return rte.el.contains(range.commonAncestorContainer) ? range : null;
}

function finish(rte: RteLike, range: Range): void {
  const sel = rte.selection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Let GrapesJS know the content changed (it syncs the model from the DOM).
  const EventCtor = rte.doc.defaultView?.Event ?? Event;
  rte.el.dispatchEvent(new EventCtor("input", { bubbles: true }));
}

function selectIcon(
  title: string,
  placeholder: string,
  options: { label: string; value: string }[],
): HTMLSelectElement {
  const select = document.createElement("select");
  select.title = title;
  const opts = [{ label: placeholder, value: "" }, ...options];
  opts.forEach(({ label, value }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  return select;
}

/** The selection's current color for `prop`, as #RRGGBB (to prefill the picker). */
export function selectionColor(
  rte: RteLike,
  range: Range,
  prop: "color" | "background-color",
): string | null {
  const node = range.startContainer;
  const el = node.nodeType === 1 ? node : node.parentNode;
  const view = rte.doc.defaultView;
  if (!el || el.nodeType !== 1 || !view) return null;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- nodeType 1 is an Element
  const style = view.getComputedStyle(el as Element);
  return rgbToHex(prop === "color" ? style.color : style.backgroundColor);
}

/**
 * Apply (or, with an empty value, clear) a color on a range saved when the
 * picker opened: put the selection back, then style it inline. Returns false
 * if that text is no longer being edited.
 */
export function applySavedColor(
  rte: RteLike,
  range: Range,
  prop: "color" | "background-color",
  color: string,
): boolean {
  if (!rte.el.isConnected || !rte.el.contains(range.commonAncestorContainer)) {
    return false;
  }
  const sel = rte.selection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  finish(rte, applyInlineStyle(rte.el, range, prop, color));
  return true;
}

function hasSyncContent(
  view: unknown,
): view is { syncContent: () => Promise<void> } {
  return (
    typeof view === "object" &&
    view !== null &&
    "syncContent" in view &&
    typeof view.syncContent === "function"
  );
}

/** The text component whose RTE is active (for component-level alignment). */
function editingComponent(editor: Editor): Component | undefined {
  return editor.getSelected();
}

/**
 * Install the Mautic-like toolbar. Call once per editor, before content loads.
 * The variables picker is its own action at the end of the toolbar.
 */
export function installRichTextToolbar(
  editor: Editor,
  { mode, openLinkDialog }: RteToolbarOptions,
): void {
  const rteModule = editor.RichTextEditor;
  // GrapesJS's own link/wrap actions create links without an href prompt and
  // styling wrappers with editor ids; ours replace them.
  rteModule.remove("link");
  rteModule.remove("wrap");

  const styleSelect = (
    name: string,
    title: string,
    placeholder: string,
    prop: string,
    options: { label: string; value: string }[],
  ) => {
    const select = selectIcon(title, placeholder, options);
    rteModule.add(name, {
      icon: select,
      event: "change",
      attributes: { title },
      result: (rte) => {
        const range = currentRange(rte);
        if (range && select.value) {
          finish(rte, applyInlineStyle(rte.el, range, prop, select.value));
        }
        select.value = "";
      },
    });
  };
  styleSelect("amie-font", "Font", "Font", "font-family", RTE_FONTS);
  styleSelect(
    "amie-size",
    "Font size",
    "Size",
    "font-size",
    RTE_FONT_SIZES.map((s) => ({ label: `${s}px`, value: `${s}px` })),
  );

  const colorAction = (
    name: string,
    title: string,
    label: string,
    prop: "color" | "background-color",
    initial: string,
  ) => {
    const icon = document.createElement("span");
    icon.className = "amie-color-icon";
    icon.innerHTML = `${label}<span class="amie-color-bar"></span>`;
    const bar = icon.querySelector<HTMLElement>(".amie-color-bar");
    if (bar) bar.style.background = initial;
    rteModule.add(name, {
      icon,
      attributes: { title },
      result: (rte, action) => {
        const range = currentRange(rte)?.cloneRange();
        if (!range || range.collapsed) return;
        openColorPopover({
          anchor: action.btn ?? icon,
          title,
          initial: selectionColor(rte, range, prop),
          closeOn: [rte.doc],
          onApply: (color) => {
            if (
              applySavedColor(rte, range, prop, color ?? "") &&
              color &&
              bar
            ) {
              bar.style.background = color;
            }
          },
        });
      },
    });
  };
  colorAction("amie-color", "Text color", "<b>A</b>", "color", "#3E3733");
  colorAction(
    "amie-highlight",
    "Highlight color",
    '<span style="padding:0 2px">ab</span>',
    "background-color",
    "#FFF3A3",
  );

  rteModule.add("amie-link", {
    icon: "🔗",
    attributes: { title: "Insert or edit link" },
    result: (rte) => {
      const range = currentRange(rte)?.cloneRange();
      if (!range) return;
      openLinkDialog(readLink(rte.el, range), (link) => {
        const next = link
          ? applyLink(rte.el, range, link)
          : removeLink(rte.el, range);
        finish(rte, next);
      });
    },
  });
  rteModule.add("amie-unlink", {
    icon: '<span style="text-decoration:line-through">🔗</span>',
    attributes: { title: "Remove link" },
    result: (rte) => {
      const range = currentRange(rte);
      if (range) finish(rte, removeLink(rte.el, range));
    },
  });

  (["ul", "ol"] as const).forEach((type) => {
    rteModule.add(`amie-${type}`, {
      icon: type === "ul" ? "•≡" : "1≡",
      attributes: { title: type === "ul" ? "Bulleted list" : "Numbered list" },
      result: (rte) => {
        const range = currentRange(rte);
        if (range && canInsertList(rte.el))
          finish(rte, toggleList(rte.el, range, type));
      },
      update: (rte, action) => {
        action.btn?.classList.toggle(
          "amie-rte-disabled",
          !canInsertList(rte.el),
        );
        return canInsertList(rte.el) ? 0 : -1;
      },
    });
  });

  const alignIcons: Record<Alignment, string> = {
    left: "⇤",
    center: "↔",
    right: "⇥",
    justify: "☰",
  };
  const alignments: Alignment[] = ["left", "center", "right", "justify"];
  alignments.forEach((align) => {
    rteModule.add(`amie-align-${align}`, {
      icon: alignIcons[align],
      attributes: { title: `Align ${align}` },
      result: (rte) => {
        const range = currentRange(rte);
        if (range && alignBlock(rte.el, range, align)) {
          finish(rte, range);
          return;
        }
        const component = editingComponent(editor);
        if (!component) return;
        const apply = () => {
          if (mode === "mjml" && component.get("type") === "mj-text") {
            component.addStyle({ align });
          } else {
            component.addStyle({ "text-align": align });
          }
        };
        // Changing the component re-renders it (MJML), so write the text
        // being edited back to the model first or those edits are lost.
        const view: unknown = component.getView();
        if (hasSyncContent(view)) {
          void view.syncContent().then(apply);
        } else {
          apply();
        }
      },
    });
  });

  rteModule.add("amie-clear", {
    icon: "T<sub>x</sub>",
    attributes: { title: "Clear formatting" },
    result: (rte) => {
      const range = currentRange(rte);
      if (range) finish(rte, clearFormatting(rte.el, range));
    },
  });

  const variables = selectIcon(
    "Insert variable",
    "{ } Variables",
    VISUAL_EMAIL_VARIABLES,
  );
  rteModule.add("amie-variables", {
    icon: variables,
    event: "change",
    attributes: { title: "Insert variable" },
    result: (rte) => {
      const range = currentRange(rte);
      if (range && variables.value) {
        finish(rte, insertTextAt(rte.el, range, variables.value));
      }
      variables.value = "";
    },
  });
}
