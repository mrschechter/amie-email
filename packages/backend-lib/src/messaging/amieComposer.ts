function balancedObjectEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return null;
}

export function extractFirstJsonObject(modelText: string): string | null {
  const textWithoutCodeFences = modelText.replace(
    /^[\t ]*```(?:json)?[\t ]*$/gim,
    "",
  );

  for (let start = 0; start < textWithoutCodeFences.length; start += 1) {
    if (textWithoutCodeFences[start] !== "{") {
      continue;
    }

    const end = balancedObjectEnd(textWithoutCodeFences, start);
    if (end !== null) {
      return textWithoutCodeFences.slice(start, end);
    }
  }

  return null;
}

const STYLE_VALUES = {
  background: new Set(["ivory", "blush", "white", "teal", "sage"]),
  align: new Set(["left", "center"]),
  padding: new Set(["tight", "normal", "loose"]),
  textSize: new Set(["s", "m", "l"]),
  buttonVariant: new Set(["primary", "secondary", "roseGold"]),
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isAllowedStyleValue(key: string, candidate: string): boolean {
  switch (key) {
    case "background":
      return STYLE_VALUES.background.has(candidate);
    case "align":
      return STYLE_VALUES.align.has(candidate);
    case "padding":
      return STYLE_VALUES.padding.has(candidate);
    case "textSize":
      return STYLE_VALUES.textSize.has(candidate);
    case "buttonVariant":
      return STYLE_VALUES.buttonVariant.has(candidate);
    default:
      return false;
  }
}

/**
 * Model style mistakes should not discard an otherwise useful design. Unknown
 * style keys and values are removed before the strict TypeBox validation pass.
 */
export function cleanAmieModelStyles(value: unknown): unknown {
  if (!isRecord(value) || !isUnknownArray(value.blocks)) return value;
  return {
    ...value,
    blocks: value.blocks.map((block: unknown) => {
      if (!isRecord(block)) return block;
      const next = { ...block };
      if ("style" in next) {
        if (isRecord(next.style)) {
          const style: Record<string, string> = {};
          for (const key of Object.keys(STYLE_VALUES)) {
            const candidate = next.style[key];
            if (
              typeof candidate === "string" &&
              isAllowedStyleValue(key, candidate)
            ) {
              style[key] = candidate;
            }
          }
          next.style = style;
        } else {
          delete next.style;
        }
      }
      if (
        next.type === "sectionBreak" &&
        isRecord(next.params) &&
        !isAllowedStyleValue("background", String(next.params.background))
      ) {
        next.params = { ...next.params, background: "ivory" };
      }
      return next;
    }),
  };
}
