import {
  AmieComposeRequest,
  AmieComposeResponse,
  AmieEditRequest,
  AmieEditResponse,
} from "isomorphic-lib/src/amieComposer";
import {
  escapePreviewText,
  readPreviewText,
  writePreviewText,
} from "isomorphic-lib/src/emailPreviewText";

export { escapePreviewText };

export type AmieComposeStatus =
  | "Thinking…"
  | "Writing…"
  | "Assembling"
  | "Checking Liquid"
  | `Applying ${number} ${"change" | "changes"}…`
  | "Done";

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
    value === "Checking Liquid" ||
    value === "Done" ||
    (typeof value === "string" && /^Applying \d+ changes?…$/.test(value))
  );
}

function isEditResponse(value: unknown): value is AmieEditResponse {
  return (
    isRecord(value) &&
    typeof value.reply === "string" &&
    Array.isArray(value.ops) &&
    Array.isArray(value.warnings) &&
    isRecord(value.document) &&
    typeof value.html === "string"
  );
}

export async function streamAmieEdit({
  url,
  request,
  headers,
  onStatus,
  onChunk,
}: {
  url: string;
  request: AmieEditRequest;
  headers: Record<string, string>;
  onStatus: (status: AmieComposeStatus) => void;
  onChunk: (text: string) => void;
}): Promise<AmieEditResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Composer edit stream failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: AmieEditResponse | undefined;
  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (!isRecord(event) || typeof event.type !== "string")
      throw new Error("Composer edit stream returned an invalid event");
    if (event.type === "status" && isComposeStatus(event.status))
      onStatus(event.status);
    else if (event.type === "chunk" && typeof event.text === "string")
      onChunk(event.text);
    else if (event.type === "result" && isEditResponse(event.response))
      result = event.response;
    else if (event.type === "error" && typeof event.message === "string")
      throw new Error(event.message);
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
  if (!result) throw new Error("Composer edit stream ended without a result");
  return result;
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

/**
 * Set the preview text of an MJML or HTML body (one preheader, edited in
 * place; see isomorphic-lib/src/emailPreviewText.ts).
 */
export function withPreviewText(html: string, previewText: string): string {
  return writePreviewText(html, previewText);
}

export function previewTextFromHtml(html: string): string {
  return readPreviewText(html);
}
