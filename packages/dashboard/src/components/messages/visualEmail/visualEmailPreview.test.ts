/**
 * @jest-environment jsdom
 */
import grapesjs, { Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";
import {
  readPreviewText,
  writePreviewText,
} from "isomorphic-lib/src/emailPreviewText";

import { previewTextFromHtml, withPreviewText } from "../amieComposerHtml";
import { MAUTIC_EMAIL } from "./__fixtures__/mauticEmail";
import { STACKED_TABLES_EMAIL } from "./__fixtures__/stackedTablesEmail";
import { configureHtmlModeComponents } from "./visualEmailComponents";
import {
  buildVisualDesign,
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

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

/** HTML-mode open + save, then the editor's carry-over of the draft's preview. */
function saveHtmlMode(body: string): string {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  editors.push(editor);
  configureHtmlModeComponents(editor);
  const split = splitHtmlDocument(body);
  importHtmlIntoEditor(editor, split);
  return writePreviewText(
    exportHtmlDocument(editor, split.shell),
    readPreviewText(body),
  );
}

function saveMjmlMode(body: string): string {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    plugins: [(e: Editor) => grapesjsMjml(e, {})],
  });
  editors.push(editor);
  editor.setComponents(body);
  return writePreviewText(editor.getHtml(), readPreviewText(body));
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("preview text with the visual editor", () => {
  it("the Preview text field writes <mj-preview> into MJML (not a div before <mjml>)", () => {
    const body = withPreviewText(STARTER_MJML, "Your October picks");
    expect(
      body.startsWith("<mjml><mj-head><mj-preview>Your October picks"),
    ).toBe(true);
    expect(previewTextFromHtml(body)).toBe("Your October picks");
  });

  it("MJML-mode saves keep exactly one <mj-preview>", () => {
    const body = withPreviewText(STARTER_MJML, "Your October picks");
    const saved = saveMjmlMode(body);
    expect(count(saved, /<mj-preview/g)).toBe(1);
    expect(readPreviewText(saved)).toBe("Your October picks");
    expect(saveMjmlMode(saved)).toBe(saved);
  });

  it("an MJML-mode save restores the preview when the editor's MJML lacks it", () => {
    const fromEditor = STARTER_MJML; // e.g. a design reopened from before the preview was set
    const draftBody = withPreviewText(STARTER_MJML, "Set in Settings");
    expect(
      readPreviewText(writePreviewText(fromEditor, readPreviewText(draftBody))),
    ).toBe("Set in Settings");
  });

  it("HTML-mode open/save keeps the preheader once, right after <body>", () => {
    const body = withPreviewText(STARTER_HTML, "Your October picks");
    expect(detectHtmlImportRisks(body)).toEqual([]);
    const saved = saveHtmlMode(body);
    expect(count(saved, /data-amie-preview-text/g)).toBe(1);
    expect(readPreviewText(saved)).toBe("Your October picks");
    expect(
      splitHtmlDocument(saved).content.startsWith(
        "<div data-amie-preview-text",
      ),
    ).toBe(true);
    expect(saveHtmlMode(saved)).toBe(saved);
  });

  it("keeps an imported email's own preheader (Mautic/stacked fixture) in place", () => {
    expect(readPreviewText(STACKED_TABLES_EMAIL)).toBe(
      "Your October picks are here",
    );
    const saved = saveHtmlMode(STACKED_TABLES_EMAIL);
    expect(readPreviewText(saved)).toBe("Your October picks are here");
    expect(saved).not.toContain("data-amie-preview-text");
    const edited = withPreviewText(saved, "Fresh preview");
    expect(readPreviewText(edited)).toBe("Fresh preview");
    expect(edited).not.toContain("data-amie-preview-text");
  });

  it("an email without a preheader gets one only when preview text is set", () => {
    expect(readPreviewText(MAUTIC_EMAIL)).toBe("");
    expect(saveHtmlMode(MAUTIC_EMAIL)).not.toContain("data-amie-preview-text");
    expect(
      count(withPreviewText(MAUTIC_EMAIL, "Hi"), /data-amie-preview-text/g),
    ).toBe(1);
  });

  it("changing only the preview text doesn't make a visual design 'stale'", () => {
    const html = saveHtmlMode(STARTER_HTML);
    const design = buildVisualDesign({
      project: {},
      mjml: html,
      editor: VISUAL_HTML_EDITOR_ID,
    });
    expect(
      visualOpenState({
        body: withPreviewText(html, "New preview"),
        visualDesign: design,
      }),
    ).toBe("design");
    expect(
      visualOpenState({
        body: html.replace("Shop now", "Buy"),
        visualDesign: design,
      }),
    ).toBe("stale");
    const mjmlDesign = buildVisualDesign({ project: {}, mjml: STARTER_MJML });
    expect(
      visualOpenState({
        body: withPreviewText(STARTER_MJML, "x"),
        visualDesign: mjmlDesign,
      }),
    ).toBe("design");
  });
});
