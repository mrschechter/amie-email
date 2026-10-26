/**
 * @jest-environment jsdom
 */
import grapesjs, { Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";

import { MAUTIC_EMAIL, MAUTIC_HEAD } from "./__fixtures__/mauticEmail";
import { configureHtmlModeComponents } from "./visualEmailComponents";
import {
  applyCanvasFonts,
  MONTSERRAT_CSS_URL,
  MONTSERRAT_LINK_HTML,
  MONTSERRAT_STACK,
  stripManagedFontLink,
  usesMontserrat,
  withMjmlFonts,
} from "./visualEmailFonts";
import {
  exportHtmlDocument,
  importHtmlIntoEditor,
  splitHtmlDocument,
} from "./visualEmailHtml";
import { RTE_FONTS } from "./visualEmailRte";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function roundTrip(body: string): string {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  editors.push(editor);
  configureHtmlModeComponents(editor);
  const split = splitHtmlDocument(body);
  importHtmlIntoEditor(editor, split);
  return exportHtmlDocument(editor, split.shell);
}

const withMontserrat = MAUTIC_EMAIL.replace(
  "font-family:Helvetica, Arial, sans-serif;font-weight:bold;",
  `font-family:${MONTSERRAT_STACK};font-weight:bold;`,
);

describe("Montserrat", () => {
  it("is in the font menu with web-safe fallbacks", () => {
    expect(RTE_FONTS).toContainEqual({
      label: "Montserrat",
      value: "Montserrat, Arial, Helvetica, sans-serif",
    });
  });

  it("detects use in styles and font tags only", () => {
    expect(
      usesMontserrat(`<span style="font-family:${MONTSERRAT_STACK};">x</span>`),
    ).toBe(true);
    expect(
      usesMontserrat('<mj-text font-family="Montserrat, Arial">x</mj-text>'),
    ).toBe(true);
    expect(usesMontserrat('<font face="Montserrat">x</font>')).toBe(true);
    expect(usesMontserrat("<p>We love Montserrat</p>")).toBe(false);
  });

  it("emails without Montserrat save exactly as before (no link)", () => {
    const saved = roundTrip(MAUTIC_EMAIL);
    expect(saved.startsWith(MAUTIC_HEAD)).toBe(true);
    expect(saved).not.toContain("fonts.googleapis.com");
  });

  it("adds one Outlook-guarded link before </head> when used, idempotently", () => {
    const saved = roundTrip(withMontserrat);
    expect(saved.split(MONTSERRAT_LINK_HTML)).toHaveLength(2);
    expect(saved).toContain(`${MONTSERRAT_LINK_HTML}</head>`);
    expect(MONTSERRAT_LINK_HTML.startsWith("<!--[if !mso]><!-->")).toBe(true);
    expect(MONTSERRAT_LINK_HTML.endsWith("<!--<![endif]-->")).toBe(true);
    expect(MONTSERRAT_LINK_HTML).toContain(
      'href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&amp;display=swap" rel="stylesheet"',
    );
    // everything else in the head is untouched
    expect(stripManagedFontLink(saved).startsWith(MAUTIC_HEAD)).toBe(true);
    // saving again doesn't add a second link
    expect(roundTrip(saved)).toBe(saved);
  });

  it("drops the managed link once Montserrat is no longer used", () => {
    const saved = roundTrip(withMontserrat);
    const withoutFont = saved.replace(
      new RegExp(MONTSERRAT_STACK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      "Helvetica, Arial, sans-serif",
    );
    expect(roundTrip(withoutFont)).not.toContain("fonts.googleapis.com");
  });

  it("doesn't add a link when the email already loads Montserrat itself", () => {
    const own = withMontserrat.replace(
      "</head>",
      '<link href="https://fonts.googleapis.com/css?family=Montserrat:400,700" rel="stylesheet" /></head>',
    );
    const saved = roundTrip(own);
    expect(saved).not.toContain("data-amie-font");
    expect(saved.match(/fonts\.googleapis\.com/g)).toHaveLength(1);
  });

  it("MJML mode declares it with one <mj-font>", () => {
    const mjml =
      '<mjml><mj-body><mj-section><mj-column><mj-text><span style="font-family:Montserrat, Arial, Helvetica, sans-serif;">Hi</span></mj-text></mj-column></mj-section></mj-body></mjml>';
    const out = withMjmlFonts(mjml);
    expect(out).toContain(
      `<mjml><mj-head><mj-font name="Montserrat" href="${MONTSERRAT_CSS_URL.replace(/&/g, "&amp;")}"></mj-font></mj-head><mj-body>`,
    );
    expect(withMjmlFonts(out)).toBe(out);
    const withHead =
      '<mjml><mj-head><mj-title>x</mj-title></mj-head><mj-body><mj-text font-family="Montserrat">a</mj-text></mj-body></mjml>';
    expect(withMjmlFonts(withHead)).toMatch(
      /^<mjml><mj-head><mj-font name="Montserrat"[^>]*><\/mj-font><mj-title>/,
    );
    expect(
      withMjmlFonts("<mjml><mj-body><mj-text>a</mj-text></mj-body></mjml>"),
    ).toBe("<mjml><mj-body><mj-text>a</mj-text></mj-body></mjml>");
  });

  it("MJML output with mj-font survives the MJML editor", () => {
    const editor = grapesjs.init({
      headless: true,
      storageManager: false,
      plugins: [(e: Editor) => grapesjsMjml(e, {})],
    });
    editors.push(editor);
    const mjml = withMjmlFonts(
      '<mjml><mj-body><mj-section><mj-column><mj-text font-family="Montserrat, Arial">Hi</mj-text></mj-column></mj-section></mj-body></mjml>',
    );
    editor.setComponents(mjml);
    expect(withMjmlFonts(editor.getHtml()).match(/<mj-font\b/g)).toHaveLength(
      1,
    );
  });

  it("loads the font in the canvas document only, once", () => {
    const doc = document.implementation.createHTMLDocument("canvas");
    applyCanvasFonts(doc);
    applyCanvasFonts(doc);
    const links = doc.head.querySelectorAll("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(MONTSERRAT_CSS_URL);
  });
});
