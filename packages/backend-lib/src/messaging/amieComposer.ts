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
