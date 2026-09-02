import { liquidEngine } from "../liquid";

const LIQUID_SPAN = /({{[\s\S]*?}}|{%[\s\S]*?%})/g;
const USER_REFERENCE = /\buser\.([A-Za-z_][A-Za-z0-9_]*)\b/;

function decodeLiquidEntities(value: string): string {
  return value
    .replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/&quot;|&#34;|&#x22;/gi, '"');
}

/**
 * Applies an escaping function only outside Liquid output/tag spans. Liquid is
 * evaluated after assembly, so changing quotes within a span changes syntax.
 */
export function mapOutsideLiquid(
  value: string,
  transform: (plainText: string) => string,
): string {
  return value
    .split(LIQUID_SPAN)
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join("");
}

function normalizeOutputTag(
  tag: string,
  knownUserProperties: ReadonlySet<string>,
): string {
  let expression = decodeLiquidEntities(tag.slice(2, -2)).trim();
  const leadingName = expression.match(
    /^([A-Za-z_][A-Za-z0-9_]*)(?=\s*(?:\||$))/,
  )?.[1];
  if (leadingName && knownUserProperties.has(leadingName)) {
    expression = `user.${expression}`;
  }
  if (
    USER_REFERENCE.test(expression) &&
    !/\|\s*default\s*:/i.test(expression)
  ) {
    expression = `${expression} | default: ''`;
  }
  return `{{ ${expression} }}`;
}

/** Normalize the Liquid syntax emitted by the composer without touching prose. */
export function normalizeLiquid(
  text: string,
  knownUserProperties: Iterable<string>,
): string {
  const known = new Set(knownUserProperties);
  return text.replace(LIQUID_SPAN, (tag) =>
    tag.startsWith("{{")
      ? normalizeOutputTag(tag, known)
      : decodeLiquidEntities(tag),
  );
}

/**
 * Parse and render using Dittofeed's configured Liquid engine. Rendering with
 * strictVariables enabled catches unresolved bare variables as well as syntax.
 */
export function validateLiquid(
  text: string,
  knownUserProperties: Iterable<string>,
): string | null {
  const user = Object.fromEntries(
    Array.from(knownUserProperties, (name) => [name, "sample"]),
  );
  try {
    const withoutSideEffectTags = text.replace(
      /{%\s*(?:unsubscribe_url|unsubscribe_link|subscription_management_url|subscription_management_link|view_in_browser_url)\b[\s\S]*?%}/g,
      "",
    );
    liquidEngine.parseAndRenderSync(withoutSideEffectTags, {
      user,
      workspace_id: "amie-composer-liquid-check",
      secrets: {},
      tags: {},
      is_preview: true,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
