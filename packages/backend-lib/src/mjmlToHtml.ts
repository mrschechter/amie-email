import mjml2html from "mjml";

/**
 * Compile an MJML template to the HTML email the send pipeline would produce,
 * keeping its Liquid byte-for-byte so it can be rendered later.
 *
 * The send path (liquid.ts `renderLiquid`) renders Liquid first and then
 * calls `mjml2html` with default options. Here there is no recipient yet, so
 * every Liquid tag/output is swapped for an inert placeholder, compiled with
 * the same `mjml2html` call, and swapped back. Used by the visual editor's
 * "Convert to HTML email" action.
 */

const LIQUID_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const CONTROL_RE =
  /^\{%-?\s*(?:if|elsif|else|endif|unless|endunless|for|endfor|case|when|endcase|capture|endcapture|raw|endraw|comment|endcomment|tablerow|endtablerow)\b/;

export type MjmlToHtmlResult =
  | { ok: true; html: string }
  | { ok: false; message: string };

function placeholder(index: number): string {
  // letters/digits only: survives MJML attributes, text and CSS untouched
  return `amieliquid${index}x${"q".repeat(3)}`;
}

/**
 * Liquid logic (`{% if %}`, `{% for %}` …) that wraps MJML elements can't be
 * compiled ahead of time — the send path compiles after Liquid has already
 * chosen which elements exist.
 */
function hasLogicAroundElements(mjml: string): boolean {
  const between = />\s*((?:\{%[\s\S]*?%\}\s*)+)\s*<\/?mj-/g;
  for (const match of mjml.matchAll(between)) {
    const tags = match[1]?.match(/\{%[\s\S]*?%\}/g) ?? [];
    if (tags.some((tag) => CONTROL_RE.test(tag))) return true;
  }
  return false;
}

export function compileMjmlKeepingLiquid(mjml: string): MjmlToHtmlResult {
  if (!/<mjml[\s>]/i.test(mjml)) {
    return { ok: false, message: "This email isn't MJML." };
  }
  if (hasLogicAroundElements(mjml)) {
    return {
      ok: false,
      message:
        "This email uses Liquid logic ({% if %} / {% for %}) around whole blocks, which can't be converted without changing what recipients see. Keep it as MJML, or move the logic inside a text block first.",
    };
  }
  const tags: string[] = [];
  const protectedMjml = mjml.replace(LIQUID_RE, (tag) => {
    tags.push(tag);
    return placeholder(tags.length - 1);
  });
  let html: string;
  try {
    html = mjml2html(protectedMjml).html;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return {
      ok: false,
      message: `MJML couldn't be compiled: ${error.message}`,
    };
  }
  // Every placeholder must survive exactly once, or Liquid would be lost.
  let restored = html;
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const token = placeholder(i);
    const parts = restored.split(token);
    if (parts.length !== 2) {
      return {
        ok: false,
        message:
          "Some Liquid in this email is in a place MJML doesn't keep, so it can't be converted safely.",
      };
    }
    restored = parts.join(tags[i] ?? "");
  }
  return { ok: true, html: restored };
}
