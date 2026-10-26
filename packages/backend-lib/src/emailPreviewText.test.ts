import {
  PREVIEW_PADDING,
  readPreviewText,
  stripLegacyMjmlPreview,
  withoutPreviewText,
  writePreviewText,
} from "isomorphic-lib/src/emailPreviewText";

import { renderLiquid } from "./liquid";

// Shapes the visual editor writes: MJML mode, and an HTML document
// (HTML mode / Code tab / imported).
const MJML = `<mjml><mj-body background-color="#FBF7F2"><mj-section><mj-column><mj-text>Hi {{ user.firstName | default: "there" }}, the first body line.</mj-text><mj-text><a href="{% unsubscribe_url %}">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>`;
const HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>t</title></head>
<body style="margin:0;"><table role="presentation" width="600"><tr><td>Hi {{ user.firstName | default: "there" }}, the first body line.</td></tr></table></body></html>`;
// Mautic's own preheader, as pasted from Mautic
const MAUTIC = `<!DOCTYPE html><html><head><title>m</title></head><body>
<div class="preheader" style="display:none !important;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Mautic preheader text</div>
<table><tr><td>Body text</td></tr></table></body></html>`;

const PREVIEW =
  "Your October picks — {{ user.firstName | default: 'friend' }} & co";

function render(template: string) {
  return renderLiquid({
    template,
    mjml: true,
    workspaceId: "00000000-0000-0000-0000-000000000000",
    identifierKey: "email",
    userProperties: { firstName: "Ana", email: "ana@example.com" },
  });
}

/** Hidden elements (display:none) right after <body> in the sent HTML. */
function sentPreheaders(html: string): string[] {
  const body = html.slice(html.search(/<body\b/i));
  return Array.from(
    body.matchAll(
      /<(div|span|td)\b[^>]*display\s*:\s*none[^>]*>([\s\S]*?)<\/\1>/gi,
    ),
  ).map((m) => (m[2] ?? "").replace(/<[^>]+>/g, ""));
}

describe("preview text in the sent email", () => {
  it("before the fix: a preview div prepended to MJML was never sent", () => {
    const legacy = `<div data-amie-preview-text style="display:none">Lost preview</div>${MJML}`;
    expect(render(legacy)).not.toContain("Lost preview");
  });

  it("MJML (visual MJML mode): <mj-preview> becomes the hidden preheader", () => {
    const body = writePreviewText(MJML, PREVIEW);
    expect(body).toContain("<mj-head><mj-preview>");
    const html = render(body);
    const pre = sentPreheaders(html);
    expect(pre).toHaveLength(1);
    expect(pre[0]?.startsWith("Your October picks — Ana &amp; co")).toBe(true);
    // zero-width padding follows, so body text doesn't leak into the preview
    expect(pre[0]).toContain(PREVIEW_PADDING);
    expect(readPreviewText(body)).toBe(PREVIEW);
  });

  it("HTML (visual HTML mode / code HTML): one hidden div right after <body>", () => {
    const body = writePreviewText(HTML, PREVIEW);
    expect(body).toMatch(
      /<body style="margin:0;"><div data-amie-preview-text style="display:none;/,
    );
    const html = render(body);
    const pre = sentPreheaders(html);
    expect(pre).toHaveLength(1);
    expect(pre[0]?.startsWith("Your October picks — Ana &amp; co")).toBe(true);
    expect(html).toContain(PREVIEW_PADDING);
    expect(readPreviewText(body)).toBe(PREVIEW);
  });

  it("is idempotent: typing and re-saving never adds a second preheader", () => {
    for (const base of [MJML, HTML]) {
      let body = base;
      for (const typed of ["Y", "Yo", "You", "Your ", "Your p", PREVIEW]) {
        body = writePreviewText(body, typed);
        // spaces survive typing (the field reads its own value back)
        expect(readPreviewText(body)).toBe(typed);
      }
      expect(writePreviewText(body, PREVIEW)).toBe(body);
      expect(sentPreheaders(render(body))).toHaveLength(1);
    }
  });

  it("cleans up duplicates left by the old field and pre-fix MJML divs", () => {
    const dupes = HTML.replace(
      '<body style="margin:0;">',
      '<body style="margin:0;"><div data-amie-preview-text style="display:none">Yo</div><div data-amie-preview-text style="display:none">Y</div>',
    );
    expect(readPreviewText(dupes)).toBe("Yo");
    const fixed = writePreviewText(dupes, "Your picks");
    expect(fixed.match(/data-amie-preview-text/g)).toHaveLength(1);
    const legacyMjml = `<div data-amie-preview-text style="display:none">Old</div><div data-amie-preview-text style="display:none">Ol</div>${MJML}`;
    expect(readPreviewText(legacyMjml)).toBe("Old");
    expect(stripLegacyMjmlPreview(legacyMjml)).toBe(MJML);
    const mj = writePreviewText(legacyMjml, "Old");
    expect(mj.startsWith("<mjml><mj-head><mj-preview>Old")).toBe(true);
    expect(sentPreheaders(render(mj))).toHaveLength(1);
  });

  it("keeps an imported Mautic preheader, editing its text in place", () => {
    expect(readPreviewText(MAUTIC)).toBe("Mautic preheader text");
    const edited = writePreviewText(MAUTIC, "New preview");
    expect(edited).toContain(
      '<div class="preheader" style="display:none !important;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">New preview</div>',
    );
    expect(edited).not.toContain("data-amie-preview-text");
    expect(writePreviewText(MAUTIC, "Mautic preheader text")).toBe(MAUTIC);
    expect(sentPreheaders(render(edited))).toEqual(["New preview"]);
  });

  it("an existing MJML preview is replaced, not duplicated; empty removes it", () => {
    const withHead = MJML.replace(
      "<mjml>",
      "<mjml><mj-head><mj-title>T</mj-title><mj-preview>Old</mj-preview></mj-head>",
    );
    expect(readPreviewText(withHead)).toBe("Old");
    const next = writePreviewText(withHead, "New");
    expect(next.match(/<mj-preview/g)).toHaveLength(1);
    expect(readPreviewText(next)).toBe("New");
    expect(writePreviewText(next, "")).not.toContain("mj-preview");
    expect(withoutPreviewText(writePreviewText(HTML, "x"))).toBe(HTML);
  });

  it("the composer's preheader cell is still edited in place", () => {
    const composer =
      '<html><body><table><tr><td style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">Old</td></tr></table></body></html>';
    expect(readPreviewText(composer)).toBe("Old");
    expect(writePreviewText(composer, "New")).toContain(
      'mso-hide:all;">New</td></tr>',
    );
  });
});
