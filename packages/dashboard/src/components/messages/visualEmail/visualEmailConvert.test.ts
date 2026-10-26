/**
 * @jest-environment jsdom
 */
import { compileMjmlKeepingLiquid } from "backend-lib/src/mjmlToHtml";
import grapesjs, { Editor } from "grapesjs";
import { CodeEmailContents } from "isomorphic-lib/src/types";

import { configureHtmlModeComponents } from "./visualEmailComponents";
import {
  convertMjmlToHtml,
  mjmlBackupKey,
  readMjmlBackup,
} from "./visualEmailConvert";
import {
  applyVisualSave,
  buildVisualDesign,
  hasUnsubscribeLink,
  isMjmlBody,
  STARTER_MJML,
  VISUAL_HTML_EDITOR_ID,
  visualOpenState,
} from "./visualEmailDesign";
import {
  detectHtmlImportRisks,
  exportHtmlDocument,
  importHtmlIntoEditor,
  splitHtmlDocument,
  STARTER_HTML,
} from "./visualEmailHtml";
import { visualHtmlWarnings } from "./visualEmailWarnings";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

/** What the HTML-mode visual editor saves for a document (no edits). */
function saveInHtmlMode(html: string) {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  editors.push(editor);
  configureHtmlModeComponents(editor);
  const split = splitHtmlDocument(html);
  importHtmlIntoEditor(editor, split);
  const body = exportHtmlDocument(editor, split.shell);
  const project: Record<string, unknown> = JSON.parse(
    JSON.stringify(editor.getProjectData()),
  );
  return {
    body,
    design: buildVisualDesign({
      project,
      mjml: body,
      editor: VISUAL_HTML_EDITOR_ID,
    }),
  };
}

const liquidTags = (text: string) =>
  text.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? [];

describe("HTML starter for new visual designs", () => {
  it("is a full HTML document with the brand, Liquid and the unsubscribe footer", () => {
    expect(STARTER_HTML.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(isMjmlBody(STARTER_HTML)).toBe(false);
    expect(hasUnsubscribeLink(STARTER_HTML)).toBe(true);
    expect(STARTER_HTML).toContain('href="{% unsubscribe_url %}"');
    expect(STARTER_HTML).toContain('{{ user.firstName | default: "there" }}');
    expect(STARTER_HTML).toContain(
      '{{ user.physicalAddress | default: "382 NE 191st St, Miami, FL 33179" }}',
    );
    for (const color of ["#FBF7F2", "#3E3733", "#2D7A7A", "#B76E79"]) {
      expect(STARTER_HTML).toContain(color);
    }
    // the same Liquid as the MJML starter
    expect(liquidTags(STARTER_HTML).sort()).toEqual(
      liquidTags(STARTER_MJML).sort(),
    );
  });

  it("passes the HTML-mode checks: no risky content, no warnings", () => {
    expect(detectHtmlImportRisks(STARTER_HTML)).toEqual([]);
    expect(visualHtmlWarnings(STARTER_HTML)).toEqual([]);
  });

  it("saves as an HTML design that reopens as-is and is stable", () => {
    const first = saveInHtmlMode(STARTER_HTML);
    expect(first.design.editor).toBe("grapesjs-html");
    expect(saveInHtmlMode(first.body).body).toBe(first.body);
    expect(visualHtmlWarnings(first.body)).toEqual([]);
    const draft = applyVisualSave(
      { from: "a@b.c", subject: "s", body: "" },
      first.design,
    );
    expect(visualOpenState(draft)).toBe("design");
    // the Code tab shows the body: HTML, not MJML
    expect(isMjmlBody(draft.body)).toBe(false);
    expect(draft.body.startsWith("<!DOCTYPE html>")).toBe(true);
  });
});

describe("Convert to HTML email", () => {
  const compile = jest.fn(async (mjml: string) =>
    compileMjmlKeepingLiquid(mjml),
  );
  beforeEach(() => compile.mockClear());

  const mjmlDesign = buildVisualDesign({
    project: { pages: [] },
    mjml: STARTER_MJML,
  });

  it("does nothing without confirm: no compile, no backup", async () => {
    const storage = memoryStorage();
    const result = await convertMjmlToHtml({
      templateId: "t1",
      mjml: STARTER_MJML,
      visualDesign: mjmlDesign,
      confirm: () => Promise.resolve(false),
      compile,
      storage,
    });
    expect(result).toEqual({ status: "cancelled" });
    expect(compile).not.toHaveBeenCalled();
    expect(storage.data).toEqual({});
  });

  it("backs up the MJML, compiles it and yields HTML that keeps Liquid", async () => {
    const storage = memoryStorage();
    const result = await convertMjmlToHtml({
      templateId: "t1",
      mjml: STARTER_MJML,
      visualDesign: mjmlDesign,
      confirm: () => Promise.resolve(true),
      compile,
      storage,
      now: () => 1700000000000,
    });
    if (result.status !== "converted") throw new Error(JSON.stringify(result));
    expect(result.backedUp).toBe(true);
    expect(readMjmlBackup("t1", storage)).toEqual({
      at: 1700000000000,
      body: STARTER_MJML,
      visualDesign: mjmlDesign,
    });
    expect(storage.data[mjmlBackupKey("t1")]).toBeDefined();
    expect(isMjmlBody(result.html)).toBe(false);
    for (const tag of liquidTags(STARTER_MJML)) {
      expect(result.html).toContain(tag);
    }
  });

  it("the converted email saves as an HTML design; Code tab shows HTML", async () => {
    const result = await convertMjmlToHtml({
      templateId: "t2",
      mjml: STARTER_MJML,
      visualDesign: mjmlDesign,
      confirm: () => Promise.resolve(true),
      compile,
      storage: memoryStorage(),
    });
    if (result.status !== "converted") throw new Error("not converted");
    const saved = saveInHtmlMode(result.html);
    const before: CodeEmailContents = {
      from: "a@b.c",
      subject: "s",
      body: STARTER_MJML,
      visualDesign: mjmlDesign,
    };
    const after = applyVisualSave(before, saved.design);
    expect(after.visualDesign.editor).toBe("grapesjs-html");
    expect(isMjmlBody(after.body)).toBe(false);
    expect(after.body).toBe(saved.body);
    expect(visualOpenState(after)).toBe("design");
    // Liquid and Outlook conditionals survive the HTML-mode save
    for (const tag of liquidTags(STARTER_MJML)) {
      expect(after.body).toContain(tag);
    }
    const comments = (html: string) =>
      splitHtmlDocument(html).content.match(/<!--[\s\S]*?-->/g) ?? [];
    expect(comments(after.body)).toEqual(comments(result.html));
    expect(hasUnsubscribeLink(after.body)).toBe(true);
    // head (MJML's styles and media queries) kept byte-for-byte
    expect(
      after.body.startsWith(splitHtmlDocument(result.html).shell.before),
    ).toBe(true);
  });

  it("reports compile errors and leaves the MJML untouched", async () => {
    const result = await convertMjmlToHtml({
      templateId: "t3",
      mjml: STARTER_MJML,
      visualDesign: mjmlDesign,
      confirm: () => Promise.resolve(true),
      compile: () => Promise.resolve({ ok: false, message: "nope" }),
      storage: memoryStorage(),
    });
    expect(result).toEqual({ status: "error", message: "nope" });
  });

  it("refuses non-MJML bodies without asking", async () => {
    const confirm = jest.fn(() => Promise.resolve(true));
    const result = await convertMjmlToHtml({
      templateId: "t4",
      mjml: "<p>hi</p>",
      visualDesign: null,
      confirm,
      compile,
      storage: memoryStorage(),
    });
    expect(result.status).toBe("error");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ignores a corrupt backup", () => {
    const storage = memoryStorage();
    storage.setItem(mjmlBackupKey("t5"), "{nope");
    expect(readMjmlBackup("t5", storage)).toBeNull();
    storage.setItem(mjmlBackupKey("t5"), JSON.stringify({ body: "<p>x</p>" }));
    expect(readMjmlBackup("t5", storage)).toBeNull();
  });
});
