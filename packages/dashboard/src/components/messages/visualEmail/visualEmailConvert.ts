/**
 * "Convert to HTML email": turn a visual MJML email into an HTML email so the
 * Code tab shows (and edits) HTML. One-way, and only after an explicit
 * confirm. The MJML is compiled server-side by the same `mjml2html` the send
 * pipeline uses (backend-lib/src/mjmlToHtml.ts), with Liquid kept verbatim;
 * the result is then opened and saved by the HTML-mode visual editor.
 */
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { CodeEmailContents, VisualEmailDesign } from "isomorphic-lib/src/types";

import { isMjmlBody } from "./visualEmailDesign";

export const MJML_BACKUP_PREFIX = "amie-visual-email-mjml-backup:";

export function mjmlBackupKey(templateId: string): string {
  return `${MJML_BACKUP_PREFIX}${templateId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface MjmlBackup {
  at: number;
  body: string;
  visualDesign: CodeEmailContents["visualDesign"];
}

export function readMjmlBackup(
  templateId: string,
  storage: StorageLike | null = defaultStorage(),
): MjmlBackup | null {
  try {
    const raw = storage?.getItem(mjmlBackupKey(templateId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "body" in parsed &&
      typeof parsed.body === "string" &&
      isMjmlBody(parsed.body)
    ) {
      const at =
        "at" in parsed && typeof parsed.at === "number" ? parsed.at : 0;
      const design =
        "visualDesign" in parsed
          ? schemaValidate(parsed.visualDesign, VisualEmailDesign)
          : null;
      const visualDesign = design?.isOk() ? design.value : null;
      return { at, body: parsed.body, visualDesign };
    }
    return null;
  } catch {
    return null;
  }
}

function saveMjmlBackup(
  templateId: string,
  backup: MjmlBackup,
  storage: StorageLike | null,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(mjmlBackupKey(templateId), JSON.stringify(backup));
    return true;
  } catch {
    return false;
  }
}

export type CompileResult =
  | { ok: true; html: string }
  | { ok: false; message: string };

export type ConvertResult =
  | { status: "cancelled" }
  | { status: "error"; message: string }
  | { status: "converted"; html: string; backedUp: boolean };

export interface ConvertOptions {
  templateId: string;
  /** The MJML to convert (the visual editor's current output). */
  mjml: string;
  visualDesign: CodeEmailContents["visualDesign"];
  /** Ask the user; nothing happens unless this resolves true. */
  confirm: () => Promise<boolean>;
  /** Compile with the send pipeline's MJML (the API endpoint in the app). */
  compile: (mjml: string) => Promise<CompileResult>;
  storage?: StorageLike | null;
  now?: () => number;
}

/**
 * Confirm, back up the MJML (localStorage, this browser), then compile.
 * The caller applies the HTML (opening it in the HTML editor and saving);
 * this function never touches the draft itself.
 */
export async function convertMjmlToHtml({
  templateId,
  mjml,
  visualDesign,
  confirm,
  compile,
  storage = defaultStorage(),
  now = () => Date.now(),
}: ConvertOptions): Promise<ConvertResult> {
  if (!isMjmlBody(mjml)) {
    return { status: "error", message: "This email isn't MJML." };
  }
  if (!(await confirm())) return { status: "cancelled" };
  const backedUp = saveMjmlBackup(
    templateId,
    { at: now(), body: mjml, visualDesign },
    storage,
  );
  const result = await compile(mjml);
  if (!result.ok) return { status: "error", message: result.message };
  return { status: "converted", html: result.html, backedUp };
}
