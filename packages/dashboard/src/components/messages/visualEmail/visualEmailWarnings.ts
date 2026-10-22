import { hasUnsubscribeLink } from "./visualEmailDesign";

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
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
