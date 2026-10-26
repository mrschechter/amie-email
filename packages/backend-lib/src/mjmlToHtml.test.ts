import { UserPropertyAssignments } from "isomorphic-lib/src/types";

import { renderLiquid } from "./liquid";
import { compileMjmlKeepingLiquid } from "./mjmlToHtml";

// Same shape the visual editor's MJML mode writes (starter-like), with
// Liquid in text, attributes, hrefs and an inline {% if %}.
const mjml = `<mjml>
  <mj-head><mj-attributes><mj-all font-family="Helvetica, Arial, sans-serif"></mj-all></mj-attributes></mj-head>
  <mj-body background-color="#FBF7F2" width="600px">
    <mj-section background-color="#FFFFFF" padding="28px 24px 8px">
      <mj-column>
        <mj-text align="center" font-size="26px" color="#3E3733">Amie<span style="color:#B76E79;">.</span></mj-text>
        <mj-image src="https://assets.example.com/{{ user.segment | default: 'all' }}.png" alt="Picks for {{ user.firstName | default: 'you' }}" href="https://tryamie.com/?e={{ user.email | url_encode }}"></mj-image>
        <mj-text font-size="16px">Hi {{ user.firstName | default: "there" }},{% if user.vip %} thanks for being VIP!{% endif %}</mj-text>
        <mj-button href="https://tryamie.com" background-color="#2D7A7A">Shop now</mj-button>
      </mj-column>
    </mj-section>
    <mj-section><mj-column>
      <mj-text align="center" font-size="12px">{{ user.physicalAddress | default: "382 NE 191st St, Miami, FL 33179" }}</mj-text>
      <mj-text align="center"><a href="{% unsubscribe_url %}" style="color:#2D7A7A;">Unsubscribe</a></mj-text>
    </mj-column></mj-section>
  </mj-body>
</mjml>`;

const users: UserPropertyAssignments[] = [
  { firstName: "Ana", email: "ana@example.com", vip: true, segment: "hrt" },
  { email: "bo@example.com" },
];

function render(template: string, userProperties: UserPropertyAssignments) {
  return renderLiquid({
    template,
    mjml: true,
    workspaceId: "00000000-0000-0000-0000-000000000000",
    identifierKey: "email",
    userProperties,
    messageId: "11111111-1111-1111-1111-111111111111",
  });
}

describe("compileMjmlKeepingLiquid", () => {
  it("produces HTML that sends exactly like the MJML did", () => {
    const result = compileMjmlKeepingLiquid(mjml);
    if (!result.ok) throw new Error(result.message);
    expect(result.html).not.toContain("<mj-");
    expect(result.html.toLowerCase()).toContain("<!doctype html>");
    for (const userProperties of users) {
      expect(render(result.html, userProperties)).toBe(
        render(mjml, userProperties),
      );
    }
  });

  it("keeps every Liquid tag byte-for-byte", () => {
    const result = compileMjmlKeepingLiquid(mjml);
    if (!result.ok) throw new Error(result.message);
    for (const tag of mjml.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? []) {
      expect(result.html).toContain(tag);
    }
    expect(result.html).not.toMatch(/amieliquid\d+x/);
  });

  it("refuses Liquid logic wrapped around whole blocks", () => {
    const wrapped = mjml.replace(
      '<mj-button href="https://tryamie.com" background-color="#2D7A7A">Shop now</mj-button>',
      '{% if user.vip %}<mj-button href="https://tryamie.com">Shop now</mj-button>{% endif %}',
    );
    const result = compileMjmlKeepingLiquid(wrapped);
    expect(result.ok).toBe(false);
  });

  it("refuses non-MJML bodies", () => {
    expect(compileMjmlKeepingLiquid("<p>hi</p>").ok).toBe(false);
  });
});
