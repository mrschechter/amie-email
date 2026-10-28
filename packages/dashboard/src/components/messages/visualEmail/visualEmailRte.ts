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
import { repairLiquidHref } from "./visualEmailLinks";

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

function isText(node: Node): node is Text {
  return node.nodeType === 3;
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
        // the attribute, never `a.href` (which resolves Liquid into a URL);
        // a link broken that way before is shown repaired
        href: repairLiquidHref(a.getAttribute("href") ?? ""),
        target: a.getAttribute("target") ?? "",
      }
    : null;
}

function setLinkAttributes(
  a: Element,
  { href: raw, target }: LinkOptions,
): void {
  const href = repairLiquidHref(raw);
  a.setAttribute("href", href);
  if (target) a.setAttribute("target", target);
  else a.removeAttribute("target");
}

// letters (incl. accented Latin), digits, apostrophes and hyphens
const WORD_CHAR_RE = /[\w'\u2019\u00C0-\u024F-]/;

/**
 * Grow a collapsed caret that sits in or at the edge of a word to cover that
 * word. Returns false (range unchanged) when there's no word at the caret.
 */
export function expandToWord(range: Range): boolean {
  if (!range.collapsed) return false;
  const node = range.startContainer;
  if (node.nodeType !== 3) return false;
  const text = node.textContent ?? "";
  let start = range.startOffset;
  let end = start;
  while (start > 0 && WORD_CHAR_RE.test(text.charAt(start - 1))) start -= 1;
  while (end < text.length && WORD_CHAR_RE.test(text.charAt(end))) end += 1;
  if (start === end) return false;
  range.setStart(node, start);
  range.setEnd(node, end);
  return true;
}

/**
 * Text for a link inserted with nothing selected: the variable's label
 * ("Unsubscribe"), "Link" for other Liquid, or the web address itself.
 * Never the raw Liquid tag, which would be shown to the reader.
 */
export function linkTextFor(href: string): string {
  const value = href.trim();
  const known = VISUAL_EMAIL_VARIABLES.find((v) => v.value === value);
  if (known?.linkText) return known.linkText;
  if (/\{%|\{\{/.test(value)) return "Link";
  return value.replace(/^mailto:|^tel:|^sms:/i, "");
}

/**
 * Insert or edit a link. `href` is written exactly (Liquid allowed). With
 * nothing selected, the word at the caret is linked; with no word there, a
 * link labelled by `linkTextFor` is inserted.
 */
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
  if (range.collapsed && !expandToWord(range)) {
    a.textContent = linkTextFor(options.href);
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

/** Bubbles from the edited element after any toolbar/paste edit. */
export const RTE_CHANGE_EVENT = "amie-rte-change";

function finish(rte: RteLike, range: Range, root: HTMLElement = rte.el): void {
  const sel = rte.selection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Let GrapesJS know the content changed (it syncs the model from the DOM)
  // and tell the editor UI an edit happened: toolbar actions change the DOM
  // without typing, which GrapesJS doesn't count as an unsaved change.
  const EventCtor = rte.doc.defaultView?.Event ?? Event;
  root.dispatchEvent(new EventCtor("input", { bubbles: true }));
  root.dispatchEvent(new EventCtor(RTE_CHANGE_EVENT, { bubbles: true }));
}

/**
 * A selection remembered as character offsets into the edited text, not as a
 * live `Range`.
 *
 * Why: the link dialog, color picker and toolbar dropdowns take focus, which
 * makes GrapesJS stop editing and, if the text changed since editing started,
 * rebuild the block's DOM from its model. A saved `Range` then points at
 * removed nodes and collapses to the start of the block, so the link was
 * inserted there (with its URL as the text) instead of around the words.
 * The rebuilt DOM has the same text, so offsets still find the words.
 */
export interface SavedSelection {
  start: number;
  end: number;
}

function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const before = root.ownerDocument.createRange();
  before.setStart(root, 0);
  before.setEnd(node, offset);
  return before.toString().length;
}

export function saveSelection(root: HTMLElement, range: Range): SavedSelection {
  return {
    start: textOffset(root, range.startContainer, range.startOffset),
    end: textOffset(root, range.endContainer, range.endOffset),
  };
}

/** The range for `saved` in `root`'s current DOM (clamped to its text). */
export function restoreSelection(
  root: HTMLElement,
  saved: SavedSelection,
): Range {
  const doc = root.ownerDocument;
  const range = doc.createRange();
  range.setStart(root, 0);
  range.collapse(true);
  const walker = doc.createTreeWalker(root, 4 /* text */);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (isText(node)) texts.push(node);
  }
  // `atEnd`: a boundary between two text nodes belongs to the earlier one
  // for the end of the selection and to the later one for its start, so the
  // range covers exactly the selected text.
  const locate = (target: number, atEnd: boolean): [Node, number] | null => {
    let seen = 0;
    for (const text of texts) {
      const len = text.data.length;
      if (target < seen + len || (atEnd && target === seen + len)) {
        return [text, target - seen];
      }
      seen += len;
    }
    const last = texts[texts.length - 1];
    return last ? [last, last.data.length] : null;
  };
  const start = locate(saved.start, saved.start === saved.end);
  const end = locate(saved.end, true);
  if (start) range.setStart(start[0], start[1]);
  if (end) range.setEnd(end[0], end[1]);
  return range;
}

/**
 * Where a deferred edit goes: the element being edited when the dialog
 * opened, or — if GrapesJS re-rendered that text block meanwhile — the
 * block's current element.
 */
function editedRoot(
  rte: RteLike,
  component: Component | undefined,
): HTMLElement | null {
  if (rte.el.isConnected) return rte.el;
  const el = component?.getView()?.getChildrenContainer();
  return el?.isConnected ? el : null;
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
 * Apply (or, with an empty value, clear) a color on the selection saved when
 * the picker opened: find it again, then style it inline. Returns false if
 * that text is no longer on the page.
 */
export function applySavedColor(
  rte: RteLike,
  saved: SavedSelection,
  prop: "color" | "background-color",
  color: string,
  root: HTMLElement | null = rte.el,
): boolean {
  if (!root?.isConnected) return false;
  const range = restoreSelection(root, saved);
  if (range.collapsed) return false;
  finish(rte, applyInlineStyle(root, range, prop, color), root);
  return true;
}

/**
 * Apply the link dialog's result (`null` removes the link) to the selection
 * saved when it opened. Returns false if that text is no longer on the page.
 */
export function applySavedLink(
  rte: RteLike,
  saved: SavedSelection,
  link: LinkOptions | null,
  root: HTMLElement | null = rte.el,
): boolean {
  if (!root?.isConnected) return false;
  const range = restoreSelection(root, saved);
  finish(
    rte,
    link ? applyLink(root, range, link) : removeLink(root, range),
    root,
  );
  return true;
}

export function hasSyncContent(view: unknown): view is {
  syncContent: (opts?: { force?: boolean; content?: string }) => Promise<void>;
} {
  return (
    typeof view === "object" &&
    view !== null &&
    "syncContent" in view &&
    typeof view.syncContent === "function"
  );
}

/**
 * Dialogs and pickers take focus, which makes GrapesJS stop editing the text
 * (and sync it) *before* the user's choice is applied. Write the element's
 * content back to its component so that late edit isn't lost.
 */
export function syncAfterDeferredEdit(editor: Editor, el: HTMLElement): void {
  const find = (component: Component): Component | undefined => {
    const view = component.getView();
    // HTML text cells edit their own element; MJML text (mj-text) edits an
    // inner container, which is what the RTE's `el` is.
    if (view && (view.el === el || view.getChildrenContainer() === el)) {
      return component;
    }
    for (const child of component.components().models) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  const wrapper = editor.getWrapper();
  const component = wrapper ? find(wrapper) : undefined;
  const view: unknown = component?.getView();
  const editing =
    typeof view === "object" &&
    view !== null &&
    "rteEnabled" in view &&
    Boolean(view.rteEnabled);
  if (!editing && hasSyncContent(view)) {
    void view.syncContent({ force: true, content: el.innerHTML });
  }
}

/** The text component whose RTE is active (for component-level alignment). */
function editingComponent(editor: Editor): Component | undefined {
  return editor.getSelected();
}

const DROP_ON_PASTE =
  "script, style, meta, link, title, base, iframe, object, embed, form, input, button, select, textarea";

/**
 * Insert clipboard content at `range`: HTML is cleaned (no scripts/styles/
 * classes/editor ids; Liquid hrefs repaired), plain text keeps line breaks.
 */
export function insertPasted(
  root: HTMLElement,
  range: Range,
  html: string,
  text: string,
): Range {
  const doc = root.ownerDocument;
  const fragment = doc.createDocumentFragment();
  if (html) {
    const Parser = doc.defaultView?.DOMParser ?? DOMParser;
    const parsed = new Parser().parseFromString(html, "text/html");
    parsed.querySelectorAll(DROP_ON_PASTE).forEach((el) => el.remove());
    const walker = parsed.createTreeWalker(parsed.body, 128 /* comments */);
    const comments: Node[] = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((c) => c.parentNode?.removeChild(c));
    parsed.body.querySelectorAll("*").forEach((el) => {
      el.removeAttribute("class");
      el.removeAttribute("id");
      Array.from(el.attributes)
        .filter((a) => /^(on|data-gjs)/i.test(a.name))
        .forEach((a) => el.removeAttribute(a.name));
      const href = el.getAttribute("href");
      if (href !== null) el.setAttribute("href", repairLiquidHref(href));
    });
    Array.from(parsed.body.childNodes).forEach((node) =>
      fragment.appendChild(doc.importNode(node, true)),
    );
  } else {
    text.split(/\r\n|\r|\n/).forEach((line, i) => {
      if (i > 0) fragment.appendChild(doc.createElement("br"));
      fragment.appendChild(doc.createTextNode(line));
    });
  }
  range.deleteContents();
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
  }
  return range;
}

/**
 * Insert a variable from the toolbar. URL variables ({% unsubscribe_url %} …)
 * become a link — around the selected text, or labelled "Unsubscribe" etc. —
 * because as plain text the tag would render as a bare, unclickable URL.
 * Other variables are inserted as text, exactly.
 */
export function insertVariable(
  root: HTMLElement,
  range: Range,
  value: string,
): Range {
  const variable = VISUAL_EMAIL_VARIABLES.find((v) => v.value === value);
  if (variable?.linkText) {
    return applyLink(root, range, { href: value, target: "_blank" });
  }
  return insertTextAt(root, range, value);
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
  // Pasting HTML (including copy/paste inside the canvas) goes through our
  // sanitizer: Chrome resolves hrefs on copy, which mangles Liquid links.
  const rteConfig: {
    onPaste?: (data: { ev: ClipboardEvent; rte: RichTextEditor }) => void;
  } = rteModule.getConfig();
  rteConfig.onPaste = ({ ev, rte }) => {
    const range = currentRange(rte);
    const data = ev.clipboardData;
    if (!range || !data) return;
    const html = data.getData("text/html");
    const text = data.getData("text");
    if (!html && !text) return;
    ev.preventDefault();
    finish(rte, insertPasted(rte.el, range, html, text));
  };

  // GrapesJS's own link/wrap actions create links without an href prompt and
  // styling wrappers with editor ids; ours replace them.
  rteModule.remove("link");
  rteModule.remove("wrap");

  // Toolbar dropdowns take focus when opened, which can end editing (and
  // rebuild the text) before `change` fires; remember the selection first.
  let activeRte: RichTextEditor | null = null;
  editor.on("rte:enable", (_view: unknown, rte: RichTextEditor) => {
    activeRte = rte;
  });
  const snapshotOn = (select: HTMLSelectElement) => {
    let snapshot: {
      rte: RichTextEditor;
      saved: SavedSelection;
      component: Component | undefined;
    } | null = null;
    const take = () => {
      const range = activeRte ? currentRange(activeRte) : null;
      snapshot =
        activeRte && range
          ? {
              rte: activeRte,
              saved: saveSelection(activeRte.el, range),
              component: editingComponent(editor),
            }
          : null;
    };
    select.addEventListener("mousedown", take);
    select.addEventListener("focus", take);
    /** Run `edit` on the remembered selection (or the live one). */
    return (
      rte: RichTextEditor,
      edit: (root: HTMLElement, range: Range) => Range,
    ) => {
      const snap = snapshot && snapshot.rte === rte ? snapshot : null;
      snapshot = null;
      const live = currentRange(rte);
      let root: HTMLElement | null = rte.el;
      let range: Range | null = live;
      if (snap) {
        root = editedRoot(rte, snap.component);
        range = root ? restoreSelection(root, snap.saved) : null;
      }
      if (!root || !range) return;
      finish(rte, edit(root, range), root);
      // the dropdown took focus, so editing may already have stopped
      syncAfterDeferredEdit(editor, root);
    };
  };

  const styleSelect = (
    name: string,
    title: string,
    placeholder: string,
    prop: string,
    options: { label: string; value: string }[],
  ) => {
    const select = selectIcon(title, placeholder, options);
    const run = snapshotOn(select);
    rteModule.add(name, {
      icon: select,
      event: "change",
      attributes: { title },
      result: (rte) => {
        const { value } = select;
        if (value) {
          run(rte, (root, range) => applyInlineStyle(root, range, prop, value));
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
        const range = currentRange(rte);
        if (!range || range.collapsed) return;
        const saved = saveSelection(rte.el, range);
        const component = editingComponent(editor);
        openColorPopover({
          anchor: action.btn ?? icon,
          title,
          initial: selectionColor(rte, range, prop),
          closeOn: [rte.doc],
          onApply: (color) => {
            const root = editedRoot(rte, component);
            if (!root || !applySavedColor(rte, saved, prop, color ?? "", root))
              return;
            syncAfterDeferredEdit(editor, root);
            if (color && bar) bar.style.background = color;
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
      const range = currentRange(rte);
      if (!range) return;
      // offsets, not the Range: see SavedSelection
      const saved = saveSelection(rte.el, range);
      const component = editingComponent(editor);
      openLinkDialog(readLink(rte.el, range), (link) => {
        const root = editedRoot(rte, component);
        if (!root || !applySavedLink(rte, saved, link, root)) return;
        syncAfterDeferredEdit(editor, root);
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
    VISUAL_EMAIL_VARIABLES.map((v) => ({
      label: v.linkText ? `${v.linkText} link` : v.label,
      value: v.value,
    })),
  );
  const runVariable = snapshotOn(variables);
  rteModule.add("amie-variables", {
    icon: variables,
    event: "change",
    attributes: { title: "Insert variable" },
    result: (rte) => {
      const { value } = variables;
      if (value) {
        runVariable(rte, (root, range) => insertVariable(root, range, value));
      }
      variables.value = "";
    },
  });
}
