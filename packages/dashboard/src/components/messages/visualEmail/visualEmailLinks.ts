/**
 * Links whose href is Liquid (`{% unsubscribe_url %}`, `{{ … }}`).
 *
 * A Liquid href isn't a URL, so anything that *resolves* it — the
 * `anchor.href` property, `new URL()`, or Chrome serialising a copy/paste or
 * drag inside the editor canvas — turns it into a dashboard address:
 *   {% unsubscribe_url %}
 *   → https://email.tryamie.com/dashboard/templates/email/%7B%%20unsubscribe_url%20%%7D
 * Hrefs are only ever read/written as attributes; this module repairs links
 * that were already broken that way, and validates what users type.
 */

const LIQUID_HREF_RE = /^(?:\{%-?[\s\S]*?-?%\}|\{\{[\s\S]*?\}\})$/;

/** Percent-decode only real `%XX` escapes (a lone `%` from `{%` stays). */
function decodeLoose(value: string): string {
  return value.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function defaultOrigins(): string[] {
  try {
    return [window.location.origin];
  } catch {
    return [];
  }
}

/**
 * If `href` is a Liquid tag mangled by URL resolution or encoding, return the
 * plain tag; otherwise return `href` unchanged. Only repairs when the Liquid
 * is the whole last path segment and the prefix is the editor itself (a
 * `/dashboard/` path or the dashboard's origin) or nothing at all, so a real
 * site URL that happens to contain encoded braces is never cut short.
 */
export function repairLiquidHref(
  href: string,
  origins: string[] = defaultOrigins(),
): string {
  if (LIQUID_HREF_RE.test(href.trim())) return href;
  const m =
    /^((?:[a-z][a-z0-9+.-]*:)?(?:\/\/[^/?#]*)?(?:\/[^?#]*)?\/)?((?:%7B|\{)(?:%7B|\{|%25|%)[^/]*)$/i.exec(
      href.trim(),
    );
  if (!m) return href;
  const prefix = m[1] ?? "";
  const tag = decodeLoose(decodeLoose(m[2] ?? ""));
  if (!LIQUID_HREF_RE.test(tag)) return href;
  if (prefix) {
    let origin = "";
    let path = prefix;
    try {
      const url = new URL(prefix);
      origin = url.origin;
      path = url.pathname;
    } catch {
      // relative prefix: judge by path
    }
    const fromEditor =
      path.includes("/dashboard/") ||
      (origin !== "" && origin !== "null" && origins.includes(origin)) ||
      /^about:/i.test(prefix);
    if (!fromEditor) return href;
  }
  return tag;
}

const HREF_ATTR_RE = /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

/** Repair every broken Liquid href in HTML/MJML markup. */
export function repairLiquidLinks(
  markup: string,
  origins: string[] = defaultOrigins(),
): { markup: string; repaired: number } {
  let repaired = 0;
  const out = markup.replace(
    HREF_ATTR_RE,
    (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? "";
      const fixed = repairLiquidHref(value, origins);
      if (fixed === value) return whole;
      repaired += 1;
      // Liquid may contain one kind of quote; keep the attribute valid
      const quote = fixed.includes('"') ? "'" : '"';
      return `${lead}${quote}${fixed}${quote}`;
    },
  );
  return { markup: out, repaired };
}

export function countBrokenLiquidLinks(
  markup: string,
  origins: string[] = defaultOrigins(),
): number {
  return repairLiquidLinks(markup, origins).repaired;
}

/**
 * Check a link the user typed. Allowed: Liquid (alone or inside a URL),
 * https/http, mailto:, tel:, sms:, `#anchor` and `/relative` paths. Returns
 * an error message, or null when it's fine.
 */
export function validateHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter a link.";
  // Liquid can hold anything; check the rest of the value
  const outside = value.replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, "");
  if (/^\s*javascript:/i.test(outside)) return "Script links aren't allowed.";
  if (/\{%|%\}|\{\{|\}\}/.test(outside)) {
    return "This Liquid tag isn't closed — use {% … %} or {{ … }}.";
  }
  if (!outside.trim()) return null; // pure Liquid, e.g. {% unsubscribe_url %}
  if (/\s/.test(outside)) {
    return "Links can't contain spaces (outside Liquid tags).";
  }
  if (/^(https?:\/\/[^/\s]+|mailto:|tel:|sms:|#|\/)/i.test(value)) return null;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value)) {
    return "Start web links with https:// (for example https://tryamie.com).";
  }
  if (/^\{%|^\{\{/.test(value)) return null; // Liquid URL with a path after it
  return "Use a web link (https://…), mailto:, tel:, or a Liquid tag like {% unsubscribe_url %}.";
}
