/**
 * HTML mode for the visual email editor: plain GrapesJS (no MJML plugin) over
 * a hand-written HTML document, e.g. templates imported from Mautic.
 *
 * Only the content between `<body>` and `</body>` goes through GrapesJS.
 * Everything around it (doctype, `<html>`/`<head>`/`<body>` tags and their
 * attributes, meta, title, `<style>`, head comments) is kept byte-for-byte and
 * re-wrapped around the editor's output on save. Opening never writes; only an
 * explicit save calls `exportHtmlDocument`.
 */
import type { Component, Editor } from "grapesjs";
import {
  AMIE_HOME_URL,
  AMIE_PLACEHOLDER_IMAGE_URL,
} from "isomorphic-lib/src/amieLinks";
import juice from "juice";

import { VISUAL_BRAND, VISUAL_FONT } from "./visualEmailDesign";

/**
 * Marks the one `<style>` block the visual editor owns: CSS that can't be
 * inlined (media queries, :hover states) created in the editor. It's replaced
 * on every save, never appended to, and never mistaken for the document's own
 * head CSS.
 */
export const EDITOR_STYLE_ATTR = "data-amie-visual-editor";

// Protect Liquid `{% ... %}` tags from juice's HTML parser the same way juice
// already protects `{{ ... }}`: they are swapped for placeholders while it
// works and restored verbatim afterwards.
juice.codeBlocks.LIQUID = { start: "{%", end: "%}" };

export interface HtmlShell {
  /** Everything up to and including the `<body ...>` open tag, byte-exact. */
  before: string;
  /** `</body>` and everything after it, byte-exact. */
  after: string;
  /** The document's own `<style>` CSS (not Outlook-only conditional CSS). */
  headCss: string;
  /** CSS from the editor-owned style block written by a previous save. */
  editorCss: string;
  /** Attributes of the `<body>` tag (shown on the canvas, kept on save). */
  bodyAttributes: Record<string, string>;
  /**
   * `id`s present in the source content. GrapesJS gives every styled element
   * an id (and keeps it in project data); only these, plus ids CSS needs, are
   * written back, so saving doesn't sprinkle generated ids through the email.
   */
  contentIds: string[];
}

export interface SplitHtml {
  shell: HtmlShell;
  /** The body content GrapesJS edits. */
  content: string;
}

const EDITOR_STYLE_RE = new RegExp(
  `<style\\b[^>]*\\s${EDITOR_STYLE_ATTR}\\b[^>]*>([\\s\\S]*?)<\\/style>`,
  "gi",
);
const BODY_OPEN_RE = /<body\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const ATTR_RE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(tag: string): Record<string, string> {
  const inner = tag.replace(/^<\w+/, "").replace(/\/?>$/, "");
  const attrs: Record<string, string> = {};
  for (const m of inner.matchAll(ATTR_RE)) {
    const name = m[1];
    if (name) attrs[name.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Split a stored body into the preserved document shell and editable content. */
export function splitHtmlDocument(html: string): SplitHtml {
  let editorCss = "";
  const withoutEditorStyle = html.replace(
    EDITOR_STYLE_RE,
    (_m, css: string) => {
      editorCss += css;
      return "";
    },
  );
  const open = BODY_OPEN_RE.exec(withoutEditorStyle);
  let before = "";
  let after = "";
  let content = withoutEditorStyle;
  let bodyAttributes: Record<string, string> = {};
  if (open) {
    const start = open.index + open[0].length;
    const lower = withoutEditorStyle.toLowerCase();
    const close = lower.lastIndexOf("</body");
    const end = close >= start ? close : withoutEditorStyle.length;
    before = withoutEditorStyle.slice(0, start);
    content = withoutEditorStyle.slice(start, end);
    after = withoutEditorStyle.slice(end);
    bodyAttributes = parseAttributes(open[0]);
  }
  // Styles inside conditional comments (`<!--[if mso]><style>`) are for
  // Outlook only — they must not be inlined into every client's markup.
  const headCss = Array.from(
    before
      .replace(COMMENT_RE, "")
      .matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
  )
    .map((m) => m[1] ?? "")
    .join("\n");
  const contentIds = Array.from(
    content.matchAll(/<[a-zA-Z][^>]*?\sid\s*=\s*["']?([^"'\s>]+)/g),
  ).map((m) => m[1] ?? "");
  return {
    shell: { before, after, headCss, editorCss, bodyAttributes, contentIds },
    content,
  };
}

const LIQUID_CONTROL_RE =
  /\{%-?\s*(?:if|elsif|else|endif|unless|endunless|for|endfor|case|when|endcase|capture|endcapture|raw|endraw|comment|endcomment|tablerow|endtablerow|liquid|break|continue)\b[\s\S]*?-?%\}/g;

function isTagBoundary(side: string, direction: "left" | "right"): boolean {
  let s = side;
  // Skip whitespace and neighbouring Liquid control tags (`{% endif %}{% endfor %}`).
  for (;;) {
    const trimmed = direction === "left" ? s.trimEnd() : s.trimStart();
    const next =
      direction === "left"
        ? trimmed.replace(/\{%-?[\s\S]*?-?%\}$/, "")
        : trimmed.replace(/^\{%-?[\s\S]*?-?%\}/, "");
    if (next === trimmed) {
      s = trimmed;
      break;
    }
    s = next;
  }
  if (!s) return true;
  return direction === "left" ? s.endsWith(">") : s.startsWith("<");
}

/** True when Liquid sits inside an HTML tag but outside any attribute value. */
function hasLiquidInsideTag(html: string): boolean {
  const tagStart = /<[a-zA-Z]/g;
  for (const m of html.matchAll(tagStart)) {
    let quote: string | null = null;
    for (let i = m.index + 1; i < html.length; i += 1) {
      const ch = html[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      } else if (ch === "{" && (html[i + 1] === "%" || html[i + 1] === "{")) {
        return true;
      }
    }
  }
  return false;
}

export interface HtmlImportRisk {
  id:
    | "msoConditional"
    | "comments"
    | "script"
    | "bodyStyle"
    | "liquidControl"
    | "liquidInTag";
  message: string;
}

/**
 * Content in the editable body that GrapesJS drops, moves or rewrites. The
 * user sees these before opening and chooses whether to continue. The head is
 * never listed: it is preserved byte-for-byte.
 */
export function detectHtmlImportRisks(body: string): HtmlImportRisk[] {
  const { content } = splitHtmlDocument(body);
  const risks: HtmlImportRisk[] = [];
  const comments = content.match(COMMENT_RE) ?? [];
  const conditional = comments.filter((c) =>
    /^<!--\s*(\[if\b|<!\[endif\])|<!\[endif\]\s*-->$/i.test(c),
  ).length;
  if (conditional || /<!\[endif\]/i.test(content)) {
    risks.push({
      id: "msoConditional",
      message:
        "Outlook-only conditional code (<!--[if mso]> … <![endif]-->) in the body. The visual editor can drop or move it, so Outlook may render the email differently after saving.",
    });
  }
  const plain = comments.length - conditional;
  if (plain > 0) {
    risks.push({
      id: "comments",
      message: `${plain} HTML comment${plain === 1 ? "" : "s"} in the body. Comments may be dropped or moved when saved.`,
    });
  }
  const stripped = content.replace(COMMENT_RE, "");
  if (/<script\b/i.test(stripped)) {
    risks.push({
      id: "script",
      message:
        "A <script> tag in the body. The visual editor removes scripts (email clients ignore them anyway).",
    });
  }
  if (/<style\b/i.test(stripped)) {
    risks.push({
      id: "bodyStyle",
      message:
        "A <style> tag inside the body. Its rules are inlined on save but the tag itself (and any media queries in it) is not kept. Styles in <head> are kept.",
    });
  }
  const controlHits = Array.from(stripped.matchAll(LIQUID_CONTROL_RE)).filter(
    (m) => {
      const { index } = m;
      return (
        isTagBoundary(stripped.slice(0, index), "left") &&
        isTagBoundary(stripped.slice(index + m[0].length), "right")
      );
    },
  );
  if (controlHits.length) {
    risks.push({
      id: "liquidControl",
      message:
        "Liquid logic ({% if %}, {% for %} …) wraps whole elements. The editor can move it out of place (for example outside a table), which changes what recipients see. Liquid inside text, links and attributes is kept exactly.",
    });
  }
  if (hasLiquidInsideTag(stripped)) {
    risks.push({
      id: "liquidInTag",
      message:
        "Liquid inside an HTML tag outside an attribute value (e.g. <td {% if %}…>). The editor can't keep it.",
    });
  }
  return risks;
}

/** Load body content and its document CSS into a fresh GrapesJS editor. */
export function importHtmlIntoEditor(editor: Editor, split: SplitHtml): void {
  // Styles first: setComponents adds the rules for each element's inline style.
  editor.setStyle(split.shell.editorCss);
  editor.setComponents(split.content);
}

const CANVAS_STYLE_ID = "amie-document-css";

/**
 * Make the editor canvas look like the document: its head CSS, plus the
 * `<body>` tag's background and inline style. Canvas-only — none of this is
 * written into the editor's project or the saved body.
 */
export function applyShellToCanvas(doc: Document, shell: HtmlShell): void {
  let style = doc.getElementById(CANVAS_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = CANVAS_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = shell.headCss;
  const { bgcolor, style: bodyStyle } = shell.bodyAttributes;
  if (bgcolor) doc.body.style.backgroundColor = bgcolor;
  for (const declaration of (bodyStyle ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0) {
      const value = declaration.slice(colon + 1).trim();
      const important = /!\s*important$/i.test(value);
      doc.body.style.setProperty(
        declaration.slice(0, colon).trim(),
        value.replace(/!\s*important$/i, "").trim(),
        important ? "important" : "",
      );
    }
  }
}

const ENTITY_CHARS: Record<string, string> = {
  "&quot;": '"',
  "&#34;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};

function decodeLiquid(span: string): string {
  return span.replace(
    /&(?:quot|#34|#0?39|apos|amp|lt|gt);/g,
    (entity) => ENTITY_CHARS[entity] ?? entity,
  );
}

function liquidSpanEnd(html: string, i: number): number {
  if (html[i] !== "{" || (html[i + 1] !== "{" && html[i + 1] !== "%")) {
    return -1;
  }
  const end = html.indexOf(html[i + 1] === "{" ? "}}" : "%}", i + 2);
  return end === -1 ? -1 : end + 2;
}

/**
 * Re-quote one attribute value. Liquid inside it is restored verbatim, so a
 * value like `Picks for {{ x | default: "you" }}` must use single quotes.
 */
function quoteAttribute(
  parts: { text: string; liquid: boolean }[],
  original: string,
): string {
  const liquidText = parts
    .filter((p) => p.liquid)
    .map((p) => p.text)
    .join("");
  let quote = original;
  if (liquidText.includes('"') && !liquidText.includes("'")) quote = "'";
  else if (liquidText.includes("'") && !liquidText.includes('"')) quote = '"';
  const escaped = quote === '"' ? "&quot;" : "&#39;";
  const value = parts
    .map((p) => {
      if (p.liquid) return p.text;
      const text = p.text.replace(
        /&quot;|&#0?39;/g,
        (e) => ENTITY_CHARS[e] ?? e,
      );
      return text
        .split(quote)
        .join(escaped)
        .replace(/\u00a0/g, "&nbsp;");
    })
    .join("");
  return `${quote}${value}${quote}`;
}

/**
 * GrapesJS and juice serialize text and attribute values HTML-escaped and
 * re-quoted, which would turn `{{ a | append: "&b" }}`, `{% if a > b %}` or
 * `title='{{ x | default: "you" }}'` into broken Liquid. Restore Liquid spans
 * verbatim (choosing attribute quotes that keep them valid), and write
 * non-breaking spaces back as `&nbsp;` (GrapesJS emits the raw character).
 */
export function restoreLiquidAndEntities(html: string): string {
  let out = "";
  let inTag = false;
  let i = 0;
  while (i < html.length) {
    const ch = html[i] ?? "";
    if (!inTag && html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      const stop = end === -1 ? html.length : end + 3;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    const liquidEnd = liquidSpanEnd(html, i);
    if (liquidEnd !== -1) {
      out += decodeLiquid(html.slice(i, liquidEnd));
      i = liquidEnd;
      continue;
    }
    if (!inTag) {
      if (ch === "<" && /[a-zA-Z/!]/.test(html[i + 1] ?? "")) inTag = true;
      out += ch === "\u00a0" ? "&nbsp;" : ch;
      i += 1;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const parts: { text: string; liquid: boolean }[] = [];
      let text = "";
      let j = i + 1;
      while (j < html.length && html[j] !== ch) {
        const end = liquidSpanEnd(html, j);
        if (end !== -1) {
          parts.push({ text, liquid: false });
          parts.push({ text: decodeLiquid(html.slice(j, end)), liquid: true });
          text = "";
          j = end;
        } else {
          text += html[j];
          j += 1;
        }
      }
      parts.push({ text, liquid: false });
      out += quoteAttribute(parts, ch);
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function styleToString(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}:${String(v)};`)
    .join("");
}

const JUICE_OPTIONS: juice.Options = {
  applyWidthAttributes: false,
  applyHeightAttributes: false,
  applyAttributesTableElements: false,
  inlinePseudoElements: false,
  preserveImportant: true,
  removeStyleTags: false,
  insertPreservedExtraCss: false,
};

/**
 * Rebuild the full email document from the editor: preserved shell + body
 * HTML with CSS inlined into `style` attributes. Head `<style>` stays as-is,
 * so media queries and client hacks keep working; editor-made CSS that can't
 * be inlined goes into the single editor-owned style block.
 */
export function exportHtmlDocument(editor: Editor, shell: HtmlShell): string {
  const inlinable: string[] = [];
  const preserved: string[] = [];
  for (const rule of editor.Css.getRules()) {
    const css = rule.toCSS();
    if (!css.trim()) continue;
    const mediaText: unknown = rule.get("mediaText");
    const atRuleType: unknown = rule.get("atRuleType");
    const atRule = Boolean(mediaText) || Boolean(atRuleType);
    const state = Boolean(rule.get("state"));
    const selectors = rule.getSelectors();
    const componentRule =
      !atRule &&
      !state &&
      !rule.get("selectorsAdd") &&
      selectors.length === 1 &&
      selectors.at(0).get("type") === 2; // Selector.TYPE_ID
    if (atRule || state) preserved.push(css);
    else if (!componentRule) inlinable.push(css);
  }
  // ids that other CSS still needs (e.g. a mobile-only style for one element)
  const keptIds = new Set([
    ...shell.contentIds,
    ...[...preserved, ...inlinable].flatMap((css) =>
      Array.from(css.matchAll(/#([\w-]+)/g)).map((m) => m[1] ?? ""),
    ),
  ]);

  const attributes = (
    component: Component,
    attrs: Record<string, unknown>,
  ): Record<string, unknown> => {
    const next = { ...attrs };
    const style = styleToString(component.getStyle());
    if (style) next.style = style;
    if (typeof next.id === "string" && !keptIds.has(next.id)) {
      delete next.id;
    }
    return next;
  };

  const wrapper = editor.getWrapper();
  let content =
    wrapper?.getInnerHTML({
      altQuoteAttr: true,
      // GrapesJS's types say Record<string, any>; our callback is narrower.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      attributes: attributes as never,
    }) ?? "";
  // `body {}` / `html {}` rules match nothing in the body fragment, so page
  // styles stay in the head and are not copied onto content elements.
  const inlineCss = [shell.headCss, ...inlinable]
    .filter((css) => css.trim())
    .join("\n");
  if (inlineCss) {
    content = juice.inlineContent(content, inlineCss, JUICE_OPTIONS);
  }
  content = restoreLiquidAndEntities(content);

  const editorStyle = preserved.length
    ? `<style ${EDITOR_STYLE_ATTR}>${preserved.join("")}</style>`
    : "";
  let { before } = shell;
  if (editorStyle) {
    const headClose = before.toLowerCase().lastIndexOf("</head");
    if (headClose !== -1) {
      before = `${before.slice(0, headClose)}${editorStyle}${before.slice(headClose)}`;
    } else {
      content = `${editorStyle}${content}`;
    }
  }
  return `${before}${content}${shell.after}`;
}

const TEXT_STYLE = `font-family:${VISUAL_FONT};font-size:16px;line-height:26px;color:${VISUAL_BRAND.text};margin:0 0 16px;`;

/** Email-safe HTML blocks for HTML mode (tables for layout, inline styles). */
export const HTML_BLOCKS: {
  id: string;
  label: string;
  category: string;
  content: string;
}[] = [
  {
    id: "amie-html-section",
    label: "Section",
    category: "Layout",
    content: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;"><tr><td style="padding:16px 24px;"><p style="${TEXT_STYLE}">Section content</p></td></tr></table>`,
  },
  {
    id: "amie-html-2-columns",
    label: "2 Columns",
    category: "Layout",
    content: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="50%" valign="top" style="padding:8px 12px;"><p style="${TEXT_STYLE}">Left column</p></td><td width="50%" valign="top" style="padding:8px 12px;"><p style="${TEXT_STYLE}">Right column</p></td></tr></table>`,
  },
  {
    id: "amie-html-heading",
    label: "Heading",
    category: "Basic",
    content: `<h2 style="font-family:Georgia, 'Times New Roman', serif;font-size:26px;line-height:32px;color:${VISUAL_BRAND.text};margin:0 0 16px;">Heading</h2>`,
  },
  {
    id: "amie-html-text",
    label: "Text",
    category: "Basic",
    content: `<p style="${TEXT_STYLE}">Write something here.</p>`,
  },
  {
    id: "amie-html-image",
    label: "Image",
    category: "Basic",
    content: `<img src="${AMIE_PLACEHOLDER_IMAGE_URL}" alt="Describe this image" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0;">`,
  },
  {
    id: "amie-html-button",
    label: "Button",
    category: "Basic",
    content: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:16px auto;"><tr><td style="border-radius:999px;background-color:${VISUAL_BRAND.teal};"><a href="${AMIE_HOME_URL}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${VISUAL_FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:999px;">Shop now</a></td></tr></table>`,
  },
  {
    id: "amie-html-link",
    label: "Link",
    category: "Basic",
    content: `<a href="${AMIE_HOME_URL}" target="_blank" style="color:${VISUAL_BRAND.teal};text-decoration:underline;">Link text</a>`,
  },
  {
    id: "amie-html-divider",
    label: "Divider",
    category: "Basic",
    content: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px 0;"><div style="border-top:1px solid #E3DAD1;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>`,
  },
  {
    id: "amie-html-spacer",
    label: "Spacer",
    category: "Basic",
    content: `<div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>`,
  },
  {
    id: "amie-html-unsubscribe",
    label: "Unsubscribe",
    category: "Basic",
    content: `<p style="font-family:${VISUAL_FONT};font-size:12px;line-height:20px;color:${VISUAL_BRAND.muted};text-align:center;margin:0;"><a href="{% unsubscribe_url %}" target="_blank" style="color:${VISUAL_BRAND.teal};text-decoration:underline;">Unsubscribe</a></p>`,
  },
];
