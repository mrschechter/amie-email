import { CodeEmailContents, EmailContentsType } from "isomorphic-lib/src/types";

import {
  applyVisualSave,
  buildVisualDesign,
  hasUnsubscribeLink,
  isMjmlBody,
  STARTER_MJML,
  VISUAL_EMAIL_VARIABLES,
  visualOpenState,
} from "./visualEmailDesign";
import { visualDesignWarnings } from "./visualEmailWarnings";

const base = { from: "Jodi <jodi@send.tryamie.com>", subject: "Hi" };

describe("visual email design helpers", () => {
  it("starter template is MJML with Liquid personalization and an unsubscribe link", () => {
    expect(isMjmlBody(STARTER_MJML)).toBe(true);
    expect(STARTER_MJML).toContain('{{ user.firstName | default: "there" }}');
    expect(hasUnsubscribeLink(STARTER_MJML)).toBe(true);
    expect(visualDesignWarnings(STARTER_MJML)).toEqual([]);
  });

  it("only offers Liquid forms Amie Send renders", () => {
    for (const v of VISUAL_EMAIL_VARIABLES) {
      expect(v.value).toMatch(
        /^(\{\{ user\.\w+.*\}\}|\{% (unsubscribe_url|subscription_management_url|view_in_browser_url) %\})$/,
      );
    }
  });

  it("classifies how a template opens", () => {
    expect(visualOpenState({ body: "" })).toBe("blank");
    expect(visualOpenState({ body: "<mjml><mj-body></mj-body></mjml>" })).toBe(
      "importMjml",
    );
    expect(visualOpenState({ body: "<html><body>hi</body></html>" })).toBe(
      "customHtml",
    );
    const design = buildVisualDesign({
      project: { pages: [] },
      mjml: STARTER_MJML,
    });
    expect(visualOpenState({ body: STARTER_MJML, visualDesign: design })).toBe(
      "design",
    );
    // whitespace-only differences don't count as an outside edit
    expect(
      visualOpenState({ body: `${STARTER_MJML}\n  `, visualDesign: design }),
    ).toBe("design");
    expect(
      visualOpenState({
        body: "<mjml>edited in Code tab</mjml>",
        visualDesign: design,
      }),
    ).toBe("stale");
  });

  it("a visual save writes MJML to body, keeps other fields, and clears AI composer blocks", () => {
    const draft: CodeEmailContents = {
      ...base,
      emailContentsType: EmailContentsType.Code,
      body: "<p>old</p>",
      replyTo: "info@tryamie.com",
      amieBlocks: [],
    };
    const design = buildVisualDesign({
      project: { a: 1 },
      mjml: "<mjml><mj-body/></mjml>",
      now: new Date("2026-10-21T00:00:00Z"),
    });
    const saved = applyVisualSave(draft, design);
    expect(saved.body).toBe("<mjml><mj-body/></mjml>");
    expect(saved.visualDesign).toEqual({
      version: 1,
      editor: "grapesjs-mjml",
      project: { a: 1 },
      mjml: "<mjml><mj-body/></mjml>",
      updatedAt: "2026-10-21T00:00:00.000Z",
    });
    expect(saved.amieBlocks).toBeNull();
    expect(saved.replyTo).toBe("info@tryamie.com");
    expect(saved.subject).toBe("Hi");
    expect(draft.body).toBe("<p>old</p>");
  });

  it("warns about missing alt text, dead buttons, empty variables and missing unsubscribe", () => {
    const mjml =
      '<mjml><mj-body><mj-image src="x.png"/><mj-image src="y.png" alt="ok"/><mj-button href="#">Go</mj-button><mj-text>Hi {{ }}</mj-text></mj-body></mjml>';
    expect(visualDesignWarnings(mjml)).toEqual([
      "1 image missing alt text",
      "1 button without a link",
      "An empty {{ }} variable will render blank",
      "No unsubscribe link",
    ]);
  });
});
