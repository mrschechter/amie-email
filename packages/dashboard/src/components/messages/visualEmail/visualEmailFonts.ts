/**
 * Web fonts for the visual email editor. Montserrat (Amie's font in Mautic)
 * is the only web font offered; everything else in the font menu is a
 * web-safe stack.
 *
 * - Canvas: the Google Fonts stylesheet is loaded inside the editor iframe
 *   only, so Montserrat looks right while editing.
 * - Saved email: when the email actually uses Montserrat, one managed
 *   `<link>` is written before `</head>` (HTML mode) or one `<mj-font>` into
 *   `<mj-head>` (MJML mode). Clients that don't load web fonts (Outlook,
 *   Gmail apps) use the Arial/Helvetica fallback in the font stack.
 */
import type { Editor } from "grapesjs";

export const MONTSERRAT_STACK = "Montserrat, Arial, Helvetica, sans-serif";

export const MONTSERRAT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap";

/**
 * The exact head markup HTML mode manages. Outlook (mso) skips it via the
 * downlevel-revealed conditional. The `data-amie-font` marker lets a later
 * save find and replace its own link instead of adding another one.
 */
export const MONTSERRAT_LINK_HTML = `<!--[if !mso]><!--><link href="${MONTSERRAT_CSS_URL.replace(/&/g, "&amp;")}" rel="stylesheet" data-amie-font="montserrat"><!--<![endif]-->`;

const MANAGED_LINK_RE =
  /<!--\[if !mso\]><!-->\s*<link\b[^>]*\bdata-amie-font="montserrat"[^>]*>\s*<!--<!\[endif\]-->/gi;

const USES_MONTSERRAT_RE =
  /font-family\s*[:=]\s*["']?[^;"'}>]*montserrat|\bface\s*=\s*["'][^"']*montserrat/i;

/** Does this HTML/CSS/MJML set Montserrat as a font anywhere? */
export function usesMontserrat(text: string): boolean {
  return USES_MONTSERRAT_RE.test(text);
}

/** Remove the link a previous save added (any other Montserrat link stays). */
export function stripManagedFontLink(html: string): string {
  return html.replace(MANAGED_LINK_RE, "");
}

/** The document already loads Montserrat itself (e.g. imported from Mautic). */
function loadsMontserratAlready(head: string): boolean {
  return /fonts\.googleapis\.com\/css2?\?[^"'>]*family=Montserrat/i.test(
    stripManagedFontLink(head),
  );
}

/**
 * Add the managed Montserrat link before `</head>` when `usedIn` uses it and
 * the head doesn't already load it. Idempotent: the managed link is always
 * stripped first, so a resave never adds a second one.
 */
export function withFontLinks(before: string, usedIn: string): string {
  const head = stripManagedFontLink(before);
  if (!usesMontserrat(usedIn) || loadsMontserratAlready(head)) return head;
  const close = head.toLowerCase().lastIndexOf("</head");
  if (close === -1) return head;
  return `${head.slice(0, close)}${MONTSERRAT_LINK_HTML}${head.slice(close)}`;
}

const MJ_FONT = `<mj-font name="Montserrat" href="${MONTSERRAT_CSS_URL.replace(/&/g, "&amp;")}"></mj-font>`;

/**
 * MJML mode: declare Montserrat with `<mj-font>` (MJML only emits the link,
 * with its own Outlook guard, when the font is used). Idempotent.
 */
export function withMjmlFonts(mjml: string): string {
  if (!usesMontserrat(mjml) || /<mj-font\b[^>]*name="Montserrat"/i.test(mjml)) {
    return mjml;
  }
  if (/<mj-head\b[^>]*>/i.test(mjml)) {
    return mjml.replace(/<mj-head\b[^>]*>/i, (open) => `${open}${MJ_FONT}`);
  }
  return mjml.replace(
    /<mjml\b[^>]*>/i,
    (open) => `${open}<mj-head>${MJ_FONT}</mj-head>`,
  );
}

const CANVAS_FONT_ID = "amie-canvas-fonts";

/** Load Montserrat in the editor canvas iframe (never in the saved email). */
export function applyCanvasFonts(doc: Document): void {
  if (doc.getElementById(CANVAS_FONT_ID)) return;
  const link = doc.createElement("link");
  link.id = CANVAS_FONT_ID;
  link.rel = "stylesheet";
  link.href = MONTSERRAT_CSS_URL;
  doc.head.appendChild(link);
}

export function installCanvasFonts(editor: Editor): void {
  const apply = () => {
    const doc = editor.Canvas.getDocument();
    if (doc) applyCanvasFonts(doc);
  };
  editor.on("canvas:frame:load", apply);
  editor.onReady(apply);
}
