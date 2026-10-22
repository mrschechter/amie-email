import { hasUnsubscribeLink } from "./visualEmailDesign";

function attr(tag: string, name: string, quote = '"'): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*${quote}([^${quote}]*)${quote}`,
    "i",
  ).exec(tag);
  return match ? match[1] ?? "" : null;
}

/** Pre-send checks from the spec's accessibility/reliability list (§18, §19). */
export function visualDesignWarnings(mjml: string): string[] {
  const warnings: string[] = [];
  // <mj-attributes> defaults in <mj-head> look like elements but aren't content.
  const body = mjml.replace(/<mj-head[\s\S]*?<\/mj-head>/gi, "");
  const images = body.match(/<mj-image\b[^>]*>/gi) ?? [];
  const missingAlt = images.filter((tag) => !attr(tag, "alt")?.trim()).length;
  if (missingAlt) {
    warnings.push(
      `${missingAlt} image${missingAlt === 1 ? "" : "s"} missing alt text`,
    );
  }
  const buttons = body.match(/<mj-button\b[^>]*>/gi) ?? [];
  const deadButtons = buttons.filter((tag) => {
    const href = attr(tag, "href")?.trim();
    return !href || href === "#";
  }).length;
  if (deadButtons) {
    warnings.push(
      `${deadButtons} button${deadButtons === 1 ? "" : "s"} without a link`,
    );
  }
  if (/\{\{\s*\}\}/.test(body)) {
    warnings.push("An empty {{ }} variable will render blank");
  }
  if (/<mj-attributes\b/i.test(mjml)) {
    warnings.push(
      "Shared style defaults (mj-attributes) are applied when sent but not shown in the canvas",
    );
  }
  if (mjml.trim() && !hasUnsubscribeLink(mjml)) {
    warnings.push("No unsubscribe link");
  }
  return warnings;
}

/** Pre-send checks for HTML-mode designs (same spirit as the MJML checks). */
export function visualHtmlWarnings(html: string): string[] {
  const warnings: string[] = [];
  // Only the body is content; <head> holds meta/title/style.
  const body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const images = body.match(/<img\b[^>]*>/gi) ?? [];
  const missingAlt = images.filter(
    (tag) => attr(tag, "alt") === null && attr(tag, "alt", "'") === null,
  ).length;
  if (missingAlt) {
    warnings.push(
      `${missingAlt} image${missingAlt === 1 ? "" : "s"} missing alt text`,
    );
  }
  const links = body.match(/<a\b[^>]*>/gi) ?? [];
  const deadLinks = links.filter((tag) => {
    const href = (attr(tag, "href") ?? attr(tag, "href", "'"))?.trim();
    return href === "" || href === "#";
  }).length;
  if (deadLinks) {
    warnings.push(
      `${deadLinks} link${deadLinks === 1 ? "" : "s"} without a destination`,
    );
  }
  if (/\{\{\s*\}\}/.test(body)) {
    warnings.push("An empty {{ }} variable will render blank");
  }
  if (html.trim() && !hasUnsubscribeLink(html)) {
    warnings.push("No unsubscribe link");
  }
  return warnings;
}
