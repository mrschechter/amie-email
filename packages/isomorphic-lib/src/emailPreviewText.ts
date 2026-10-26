/**
 * Email preview text ("preheader"): the line Gmail/Apple Mail show after the
 * subject. Amie Send keeps it inside the email body, so it travels with the
 * template and needs no extra field:
 *
 * - MJML bodies: `<mj-preview>` in `<mj-head>` (MJML compiles it into the
 *   standard hidden div right after `<body>`).
 * - HTML bodies: a hidden `<div data-amie-preview-text>` right after
 *   `<body>`, or — for imported emails — the email's own existing preheader
 *   (e.g. Mautic's), whose text is edited in place.
 *
 * In both, the text is followed by zero-width-joiner padding so the first
 * words of the body don't leak into the inbox preview. Writes are
 * idempotent: one preheader, never duplicated.
 */

/** `&#847;&zwnj;&nbsp;` repeated: invisible, stops body text filling the preview. */
const PADDING_UNIT = "&#847;&zwnj;&nbsp;";
export const PREVIEW_PADDING = PADDING_UNIT.repeat(90);

const PREHEADER_STYLE =
  "display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:transparent;";

/** The composer's (amieBlocks) preheader cell: `<td …mso-hide:all;">TEXT</td></tr>`. */
const COMPOSER_CELL_RE = /(<td\b[^>]*mso-hide:all;">)([^<]*)(<\/td><\/tr>)/i;

const LIQUID_SPLIT = /({{[\s\S]*?}}|{%[\s\S]*?%})/g;

/** Escape text for HTML, leaving Liquid tags untouched. */
export function escapePreviewText(value: string): string {
  return value
    .split(LIQUID_SPLIT)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
    )
    .join("");
}

/** Trailing preheader padding (ours or MJML-decoded), not user text. */
const TRAILING_PADDING_RE =
  /(?:&#847;|&#x34f;|\u034f|&zwnj;|&#8204;|\u200c|&nbsp;|&#160;|\u00a0)+$/i;

function stripPadding(inner: string): string {
  return inner
    .replace(/<span\b[^>]*data-amie-preview-padding[\s\S]*?<\/span>/gi, "")
    .replace(TRAILING_PADDING_RE, "");
}

/** Text as the user typed it (no trimming, so spaces survive typing). */
function decodeText(value: string): string {
  return stripPadding(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|\u00a0/g, " ")
    .replace(/&zwnj;|&#8204;|\u200c|&#847;|\u034f/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[\r\n\t]+/g, " ");
}

export function isMjml(body: string): boolean {
  return /<mjml[\s>]/i.test(body);
}

// our div holds only text and a padding <span>, so its first </div> closes it
const AMIE_DIV_RE =
  /<div\b[^>]*\bdata-amie-preview-text\b[^>]*>[\s\S]*?<\/div>/gi;

/** Our div, including its nested padding span. */
function amieDivs(html: string): RegExpMatchArray[] {
  return Array.from(
    html.matchAll(
      /<div\b[^>]*\bdata-amie-preview-text\b[^>]*>([\s\S]*?)<\/div>/gi,
    ),
  );
}

function amieDivText(inner: string): string {
  return decodeText(inner);
}

const BODY_OPEN_RE = /<body\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;

/**
 * An imported email's own preheader: the first element inside `<body>` (or
 * a wrapper's first cell), hidden with display:none, holding only text.
 */
function foreignPreheader(
  html: string,
): { start: number; end: number; open: string; inner: string } | null {
  const open = BODY_OPEN_RE.exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  // look only at the start of the body (before the first visible text)
  const head = html.slice(from, from + 4000);
  const m =
    /^((?:\s|<!--[\s\S]*?-->)*)<(div|span|p|td)\b([^>]*\bstyle\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*)>((?:(?!<\/?\2\b)[\s\S])*?)<\/\2>/i.exec(
      head,
    );
  if (!m || /data-amie-preview-text/i.test(m[3] ?? "")) return null;
  const inner = m[4] ?? "";
  if (/<(table|img|a)\b/i.test(inner) || !decodeText(inner).trim()) return null;
  const start = from + (m[1] ?? "").length;
  const openTag = `<${m[2]}${m[3]}>`;
  return { start, end: from + m[0].length, open: openTag, inner };
}

/** The preview text currently in a body ("" if none). */
export function readPreviewText(body: string): string {
  if (isMjml(body)) {
    const m = /<mj-preview\b[^>]*>([\s\S]*?)<\/mj-preview>/i.exec(body);
    if (m) return decodeText(m[1] ?? "");
    // bodies saved before this fix: a div placed before <mjml> (ignored by
    // MJML, so never sent) — shown so it can be re-saved correctly
    const legacy = amieDivs(body.slice(0, body.search(/<mjml[\s>]/i)))[0];
    return legacy ? amieDivText(legacy[1] ?? "") : "";
  }
  const composer = COMPOSER_CELL_RE.exec(body);
  if (composer) return decodeText(composer[2] ?? "");
  const ours = amieDivs(body)[0];
  if (ours) return amieDivText(ours[1] ?? "");
  const foreign = foreignPreheader(body);
  return foreign ? decodeText(foreign.inner).trim() : "";
}

function amiePreheaderHtml(text: string): string {
  return `<div data-amie-preview-text style="${PREHEADER_STYLE}">${escapePreviewText(text)}<span data-amie-preview-padding>${PREVIEW_PADDING}</span></div>`;
}

function writeMjml(body: string, text: string): string {
  // drop pre-fix divs before <mjml>: MJML never sent them
  const mjmlAt = body.search(/<mjml[\s>]/i);
  let out =
    mjmlAt > 0
      ? `${body.slice(0, mjmlAt).replace(AMIE_DIV_RE, "")}${body.slice(mjmlAt)}`
      : body;
  out = out.replace(/\s*<mj-preview\b[^>]*>[\s\S]*?<\/mj-preview>/gi, "");
  // a head left empty by removing the preview meant nothing
  out = out.replace(/<mj-head>\s*<\/mj-head>/i, "");
  if (!text) return out;
  const preview = `<mj-preview>${escapePreviewText(text)}${PREVIEW_PADDING}</mj-preview>`;
  if (/<mj-head\b[^>]*>/i.test(out)) {
    return out.replace(/<mj-head\b[^>]*>/i, (open) => `${open}${preview}`);
  }
  return out.replace(
    /<mjml\b[^>]*>/i,
    (open) => `${open}<mj-head>${preview}</mj-head>`,
  );
}

function writeHtml(body: string, text: string): string {
  if (COMPOSER_CELL_RE.test(body)) {
    return body.replace(
      COMPOSER_CELL_RE,
      (_m, open: string, _old: string, close: string) =>
        `${open}${escapePreviewText(text)}${close}`,
    );
  }
  const ours = amieDivs(body);
  if (ours.length) {
    // keep the first (in place), drop duplicates left by older versions
    const first = ours[0];
    const index = first?.index ?? 0;
    const end = index + (first?.[0]?.length ?? 0);
    const rest = `${body.slice(0, index)}\u0000${body.slice(end)}`.replace(
      AMIE_DIV_RE,
      "",
    );
    return rest.replace("\u0000", text ? amiePreheaderHtml(text) : "");
  }
  const foreign = foreignPreheader(body);
  if (foreign) {
    // an imported email's own preheader: change its text, keep its markup
    const padding = /&zwnj;|\u200c|&#847;/.test(foreign.inner)
      ? PREVIEW_PADDING
      : "";
    const tag = /^<(\w+)/.exec(foreign.open)?.[1] ?? "div";
    return `${body.slice(0, foreign.start)}${foreign.open}${escapePreviewText(text)}${padding}</${tag}>${body.slice(foreign.end)}`;
  }
  if (!text) return body;
  const open = BODY_OPEN_RE.exec(body);
  if (!open) return `${amiePreheaderHtml(text)}${body}`;
  const at = open.index + open[0].length;
  return `${body.slice(0, at)}${amiePreheaderHtml(text)}${body.slice(at)}`;
}

/**
 * Set (or with "" remove) the preview text of an MJML or HTML body.
 * Idempotent; never adds a second preheader.
 */
export function writePreviewText(body: string, text: string): string {
  // keep what was typed (spaces included); line breaks become spaces
  const value = text.replace(/[\r\n\t]+/g, " ");
  const set = value.trim() ? value : "";
  return isMjml(body) ? writeMjml(body, set) : writeHtml(body, set);
}

/** The body without its preview text (for comparing visual designs). */
export function withoutPreviewText(body: string): string {
  return writePreviewText(body, "");
}

/**
 * Remove preview divs saved before `<mjml>` by older versions (MJML ignored
 * them, so they were never sent). For loading MJML into the editor only.
 */
export function stripLegacyMjmlPreview(body: string): string {
  const mjmlAt = body.search(/<mjml[\s>]/i);
  if (mjmlAt <= 0) return body;
  return `${body.slice(0, mjmlAt).replace(AMIE_DIV_RE, "")}${body.slice(mjmlAt)}`;
}
