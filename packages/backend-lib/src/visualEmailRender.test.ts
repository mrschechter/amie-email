import { randomUUID } from "crypto";

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
