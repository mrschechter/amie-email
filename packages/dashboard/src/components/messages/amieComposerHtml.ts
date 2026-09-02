import {
  AmieComposeRequest,
  AmieComposeResponse,
} from "isomorphic-lib/src/amieComposer";

export function escapePreviewText(value: string): string {
  return value
    .split(/({{[\s\S]*?}}|{%[\s\S]*?%})/g)
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

export type AmieComposeStatus =
  | "Thinking…"
  | "Writing…"
  | "Assembling"
  | "Checking Liquid";

export type AmieComposeStreamResponse = AmieComposeResponse & {
  warnings?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isComposeStatus(value: unknown): value is AmieComposeStatus {
  return (
    value === "Thinking…" ||
    value === "Writing…" ||
    value === "Assembling" ||
    value === "Checking Liquid"
  );
}

function isComposeResponse(value: unknown): value is AmieComposeStreamResponse {
  return (
    isRecord(value) &&
    typeof value.subject === "string" &&
    typeof value.previewText === "string" &&
    Array.isArray(value.blocks) &&
    typeof value.html === "string" &&
    typeof value.designNotes === "string" &&
    (value.warnings === undefined ||
      (Array.isArray(value.warnings) &&
        value.warnings.every((warning) => typeof warning === "string")))
  );
}

export async function streamAmieComposition({
  url,
  request,
  headers,
  onStatus,
  onChunk,
}: {
  url: string;
  request: AmieComposeRequest;
  headers: Record<string, string>;
  onStatus: (status: AmieComposeStatus) => void;
  onChunk: (text: string) => void;
}): Promise<AmieComposeStreamResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Composer stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: AmieComposeStreamResponse | undefined;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (!isRecord(event) || typeof event.type !== "string") {
      throw new Error("Composer stream returned an invalid event");
    }
    if (event.type === "status" && isComposeStatus(event.status)) {
      onStatus(event.status);
    } else if (event.type === "chunk" && typeof event.text === "string") {
      onChunk(event.text);
    } else if (event.type === "result" && isComposeResponse(event.response)) {
      result = event.response;
    } else if (event.type === "error" && typeof event.message === "string") {
      throw new Error(event.message);
    }
  };

  const readNext = async (): Promise<void> => {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    lines.forEach(consumeLine);
    if (!done) await readNext();
  };
  await readNext();
  consumeLine(buffered);
  if (!result) throw new Error("Composer stream ended without a result");
  return result;
}

export function withPreviewText(html: string, previewText: string): string {
  const marker = 'mso-hide:all;">';
  const textStart = html.indexOf(marker);
  if (textStart === -1) {
    const preheader = `<div data-amie-preview-text style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapePreviewText(previewText)}</div>`;
    return html.includes("<body")
      ? html.replace(/(<body[^>]*>)/i, `$1${preheader}`)
      : `${preheader}${html}`;
  }
  const valueStart = textStart + marker.length;
  const valueEnd = html.indexOf("</td></tr>", valueStart);
  return valueEnd === -1
    ? html
    : `${html.slice(0, valueStart)}${escapePreviewText(previewText)}${html.slice(valueEnd)}`;
}

export function previewTextFromHtml(html: string): string {
  const marker = 'mso-hide:all;">';
  const start = html.indexOf(marker);
  if (start === -1) {
    const match = html.match(
      /<div[^>]*data-amie-preview-text[^>]*>([\s\S]*?)<\/div>/i,
    );
    return match?.[1]
      ? match[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
      : "";
  }
  const valueStart = start + marker.length;
  const end = html.indexOf("</td></tr>", valueStart);
  return end === -1
    ? ""
    : html
        .slice(valueStart, end)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
