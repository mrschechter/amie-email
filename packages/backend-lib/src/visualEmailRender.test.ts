import { randomUUID } from "crypto";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  CodeEmailContents,
  EmailContentsType,
  UpsertMessageTemplateResource,
} from "isomorphic-lib/src/types";

import { renderLiquid } from "./liquid";

// Same shape the dashboard's visual (GrapesJS + MJML) editor saves into `body`.
const visualEditorMjml = `<mjml>
  <mj-head><mj-attributes><mj-all font-family="Helvetica, Arial, sans-serif" /></mj-attributes></mj-head>
  <mj-body background-color="#FBF7F2" width="600px">
    <mj-section background-color="#FFFFFF" padding="8px 24px">
      <mj-column>
        <mj-text>Hi {{ user.firstName | default: "there" }},</mj-text>
        <mj-button href="https://tryamie.com">Shop now</mj-button>
        <mj-text><table style="width:100%"><tr><td>Item</td><td align="right">$0.00</td></tr></table></mj-text>
      </mj-column>
    </mj-section>
    <mj-section><mj-column>
      <mj-text><a href="{% unsubscribe_url %}">Unsubscribe</a></mj-text>
    </mj-column></mj-section>
  </mj-body>
</mjml>`;

describe("visual editor MJML through the send renderer", () => {
  it("renders Liquid first, then compiles MJML to email HTML", () => {
    const html = renderLiquid({
      template: visualEditorMjml,
      mjml: true,
      workspaceId: randomUUID(),
      identifierKey: "email",
      userProperties: { firstName: "Ana", email: "ana@example.com" },
    });
    expect(html).not.toContain("<mjml");
    expect(html).not.toContain("<mj-");
    expect(html).toContain("Hi Ana,");
    expect(html).toContain("Shop now");
    expect(html).toContain("<table");
    expect(html.toLowerCase()).toContain("<!doctype html>");
  });

  it("falls back to the default when the profile has no first name", () => {
    const html = renderLiquid({
      template: visualEditorMjml,
      mjml: true,
      workspaceId: randomUUID(),
      identifierKey: "email",
      userProperties: { email: "ana@example.com" },
    });
    expect(html).toContain("Hi there,");
  });
});

// Same shape the dashboard's HTML-mode visual editor saves into `body`: the
// preserved document shell around GrapesJS content with CSS inlined.
const visualEditorHtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>October picks</title>
  <style type="text/css">@media only screen and (max-width: 600px) { .container { width: 100% !important; } }</style>
</head>
<body style="margin:0;padding:0;" bgcolor="#FBF7F2"><table class="container" width="600" style="border-collapse: collapse;"><tbody><tr><td style="padding:8px 24px;">Hi {{ user.firstName | default: "there" }},</td></tr></tbody></table></body>
</html>
`;

describe("visual editor HTML through the send renderer", () => {
  it("sends an HTML body as rendered Liquid, without MJML compilation", () => {
    const html = renderLiquid({
      template: visualEditorHtml,
      mjml: true,
      workspaceId: randomUUID(),
      identifierKey: "email",
      userProperties: { firstName: "Ana", email: "ana@example.com" },
    });
    expect(html).toBe(
      visualEditorHtml.replace(
        '{{ user.firstName | default: "there" }}',
        "Ana",
      ),
    );
  });
});

describe("visual design schema", () => {
  const design = {
    version: 1,
    project: { pages: [] },
    mjml: visualEditorHtml,
    updatedAt: "2026-10-22T00:00:00.000Z",
  } as const;
  const contents = (editor: string): Record<string, unknown> => ({
    emailContentsType: EmailContentsType.Code,
    from: "Jodi <jodi@send.tryamie.com>",
    subject: "Hi",
    body: visualEditorHtml,
    visualDesign: { ...design, editor },
  });

  it("accepts HTML-mode designs and existing MJML designs", () => {
    expect(
      schemaValidate(contents("grapesjs-html"), CodeEmailContents).isOk(),
    ).toBe(true);
    expect(
      schemaValidate(contents("grapesjs-mjml"), CodeEmailContents).isOk(),
    ).toBe(true);
    expect(
      schemaValidate(
        {
          workspaceId: randomUUID(),
          name: "imported",
          definition: {
            type: "Email",
            ...contents("grapesjs-html"),
          },
          draft: { type: "Email", ...contents("grapesjs-html") },
        },
        UpsertMessageTemplateResource,
      ).isOk(),
    ).toBe(true);
  });

  it("rejects unknown editors", () => {
    expect(schemaValidate(contents("unlayer"), CodeEmailContents).isOk()).toBe(
      false,
    );
  });
});

describe("Montserrat from the visual editor", () => {
  it("an <mj-font> declared by the MJML editor compiles to a guarded font link", () => {
    const html = renderLiquid({
      template:
        '<mjml><mj-head><mj-font name="Montserrat" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&amp;display=swap"></mj-font></mj-head><mj-body><mj-section><mj-column><mj-text><span style="font-family:Montserrat, Arial, Helvetica, sans-serif;">Hi {{ user.firstName }}</span></mj-text></mj-column></mj-section></mj-body></mjml>',
      mjml: true,
      workspaceId: randomUUID(),
      identifierKey: "email",
      userProperties: { firstName: "Ana", email: "ana@example.com" },
    });
    expect(html).toContain("Hi Ana");
    expect(html).toMatch(
      /<!--\[if !mso\]><!-->[\s\S]*fonts\.googleapis\.com\/css2\?family=Montserrat[\s\S]*<!--<!\[endif\]-->/,
    );
  });
});
