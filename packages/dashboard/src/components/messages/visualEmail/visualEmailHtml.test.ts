/**
 * @jest-environment jsdom
 */
import grapesjs, { Component, Editor } from "grapesjs";
import { CodeEmailContents } from "isomorphic-lib/src/types";

import {
  MAUTIC_CONTENT,
  MAUTIC_EMAIL,
  MAUTIC_HEAD,
  MAUTIC_TAIL,
} from "./__fixtures__/mauticEmail";
import { configureHtmlModeComponents } from "./visualEmailComponents";
import {
  applyVisualSave,
  buildVisualDesign,
  hasUnsubscribeLink,
  isMjmlBody,
  visualDesignEditor,
  visualOpenState,
} from "./visualEmailDesign";
import {
  applyShellToCanvas,
  detectHtmlImportRisks,
  EDITOR_STYLE_ATTR,
  exportHtmlDocument,
  HTML_BLOCKS,
  importHtmlIntoEditor,
  restoreLiquidAndEntities,
  splitHtmlDocument,
} from "./visualEmailHtml";
import { visualHtmlWarnings } from "./visualEmailWarnings";

const editors: Editor[] = [];

function newEditor(): Editor {
  // Same core config as the HTML-mode editor, minus the canvas UI.
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  configureHtmlModeComponents(editor);
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

/** Open a body in HTML mode and save it without any edits. */
function roundTrip(body: string): string {
  const editor = newEditor();
  const split = splitHtmlDocument(body);
  importHtmlIntoEditor(editor, split);
  return exportHtmlDocument(editor, split.shell);
}

function bodyOf(html: string): string {
  return splitHtmlDocument(html).content;
}

describe("visual editor HTML mode: open state", () => {
  it("offers to open hand-written HTML visually instead of refusing it", () => {
    expect(visualOpenState({ body: MAUTIC_EMAIL })).toBe("importHtml");
    expect(visualOpenState({ body: "<p>Hi</p>" })).toBe("importHtml");
    // MJML and blank bodies keep their existing states
    expect(visualOpenState({ body: "<mjml><mj-body></mj-body></mjml>" })).toBe(
      "importMjml",
    );
    expect(visualOpenState({ body: "  " })).toBe("blank");
  });

  it("reopens an HTML design, and detects edits made outside the editor", () => {
    const saved = roundTrip(MAUTIC_EMAIL);
    const design = buildVisualDesign({
      project: { pages: [] },
      mjml: saved,
      editor: "grapesjs-html",
    });
    expect(design.editor).toBe("grapesjs-html");
    expect(visualDesignEditor(design)).toBe("grapesjs-html");
    expect(visualOpenState({ body: saved, visualDesign: design })).toBe(
      "design",
    );
    expect(
      visualOpenState({
        body: saved.replace("Shop now", "Shop today"),
        visualDesign: design,
      }),
    ).toBe("stale");
  });

  it("treats designs saved before HTML mode as MJML designs", () => {
    expect(visualDesignEditor({ editor: "grapesjs-mjml" })).toBe(
      "grapesjs-mjml",
    );
    expect(visualDesignEditor(null)).toBe("grapesjs-mjml");
  });

  it("an HTML save writes the full document to body", () => {
    const saved = roundTrip(MAUTIC_EMAIL);
    const design = buildVisualDesign({
      project: {},
      mjml: saved,
      editor: "grapesjs-html",
    });
    const original: CodeEmailContents = {
      from: "a@b.c",
      subject: "s",
      body: MAUTIC_EMAIL,
      amieBlocks: [],
    };
    const draft = applyVisualSave(original, design);
    expect(draft.body).toBe(saved);
    expect(draft.visualDesign.editor).toBe("grapesjs-html");
    expect(isMjmlBody(draft.body)).toBe(false);
  });
});

describe("visual editor HTML mode: document shell", () => {
  it("splits doctype/head/body tags from the editable content byte-for-byte", () => {
    const { shell, content } = splitHtmlDocument(MAUTIC_EMAIL);
    expect(shell.before).toBe(MAUTIC_HEAD);
    expect(content).toBe(MAUTIC_CONTENT);
    expect(shell.after).toBe(MAUTIC_TAIL);
    expect(shell.bodyAttributes).toEqual({
      style: "margin:0;padding:0;background-color:#FBF7F2;",
      bgcolor: "#FBF7F2",
    });
    expect(shell.headCss).toContain(
      "@media only screen and (max-width: 600px)",
    );
    // Outlook-only conditional CSS is never treated as regular head CSS
    expect(shell.headCss).not.toContain("font-family: Arial, sans-serif");
  });

  it("shows head CSS and body tag styles on the canvas only", () => {
    const { shell } = splitHtmlDocument(MAUTIC_EMAIL);
    const doc = document.implementation.createHTMLDocument("canvas");
    applyShellToCanvas(doc, shell);
    applyShellToCanvas(doc, shell); // idempotent: one style element
    expect(doc.querySelectorAll("style")).toHaveLength(1);
    expect(doc.querySelector("style")?.textContent).toBe(shell.headCss);
    expect(doc.body.style.backgroundColor).toBe("rgb(251, 247, 242)");
    expect(doc.body.style.margin).toBe("0px");
  });

  it("treats a fragment without <body> as all content", () => {
    const { shell, content } = splitHtmlDocument("<p>Hi</p>");
    expect(content).toBe("<p>Hi</p>");
    expect(shell.before).toBe("");
    expect(shell.after).toBe("");
  });

  it("preserves doctype, head (meta, title, style, comments) and html/body attributes on save", () => {
    const saved = roundTrip(MAUTIC_EMAIL);
    expect(saved.startsWith(MAUTIC_HEAD)).toBe(true);
    expect(saved.endsWith(MAUTIC_TAIL)).toBe(true);
  });

  it("inlines head and class CSS into style attributes, keeping the head <style>", () => {
    const content = bodyOf(roundTrip(MAUTIC_EMAIL));
    // `.headline` rule from the head is inlined alongside the element's own style
    expect(content).toMatch(
      /<h1 class="headline" style="font-family: Georgia, serif; color: #3E3733; margin: 0 0 12px;/,
    );
    // `table` reset is inlined onto tables
    expect(content).toMatch(/<table[^>]*style="border-collapse: collapse;/);
    // media queries are not inlined; they stay in the preserved head
    expect(content).not.toContain("24px !important");
    expect(content).not.toContain("<style");
    // element inline styles survive and editor-generated ids are not added
    expect(content).toContain(
      'style="display:inline-block;padding:14px 28px;background-color:#2D7A7A;',
    );
    expect(content).not.toMatch(/\sid="/);
  });

  it("is stable: saving a saved document again changes nothing", () => {
    const once = roundTrip(MAUTIC_EMAIL);
    expect(roundTrip(once)).toBe(once);
  });

  it("reopening from saved project data produces the same document", () => {
    const editor = newEditor();
    const split = splitHtmlDocument(MAUTIC_EMAIL);
    importHtmlIntoEditor(editor, split);
    const saved = exportHtmlDocument(editor, split.shell);
    const project: Record<string, unknown> = JSON.parse(
      JSON.stringify(editor.getProjectData()),
    );
    const reopened = newEditor();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    reopened.loadProjectData(project as never);
    expect(exportHtmlDocument(reopened, splitHtmlDocument(saved).shell)).toBe(
      saved,
    );
  });

  it("keeps editor media queries and hover styles in one editor-owned head block", () => {
    const editor = newEditor();
    const split = splitHtmlDocument(MAUTIC_EMAIL);
    importHtmlIntoEditor(editor, split);
    const findComponent = (
      root: Component | undefined,
      match: (c: Component) => boolean,
    ): Component | undefined => {
      if (!root) return undefined;
      if (match(root)) return root;
      for (const child of root.components().models) {
        const found = findComponent(child, match);
        if (found) return found;
      }
      return undefined;
    };
    const cta = findComponent(editor.getWrapper(), (c) =>
      String(c.getAttributes().href ?? "").includes("picks"),
    );
    if (!cta) throw new Error("missing CTA");
    cta.addAttributes({ id: "cta" });
    editor.Css.setRule(
      "#cta",
      { "font-size": "18px" },
      { atRuleType: "media", atRuleParams: "(max-width: 480px)" },
    );
    editor.Css.setRule(".headline:hover", { color: "#2D7A7A" });
    const saved = exportHtmlDocument(editor, split.shell);
    const blocks = saved.match(
      new RegExp(`<style ${EDITOR_STYLE_ATTR}>[\\s\\S]*?</style>`, "g"),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toContain(
      "@media (max-width: 480px){#cta{font-size:18px;}}",
    );
    expect(blocks?.[0]).toContain(".headline:hover{color:#2D7A7A;}");
    // the block goes in the head, right before </head>
    expect(saved).toContain(`${blocks?.[0]}</head>`);
    // the id the media query needs is kept
    expect(bodyOf(saved)).toContain('id="cta"');
    // reopening and saving again replaces the block instead of appending one
    const again = roundTrip(saved);
    expect(
      again.match(new RegExp(`<style ${EDITOR_STYLE_ATTR}>`, "g")),
    ).toHaveLength(1);
    expect(again).toBe(saved);
    expect(splitHtmlDocument(saved).shell.headCss).not.toContain("#cta");
  });
});

describe("visual editor HTML mode: Liquid survives byte-exact", () => {
  const liquid = [
    '{{ user.firstName | default: "there" }}',
    "{{ user.state | default: 'your state' }}",
    "{{ user.firstName | default: 'Your' }}",
    '{{ user.firstName | default: "you" }}',
    "{{ user.email | url_encode }}",
    '{{ user.physicalAddress | default: "382 NE 191st St, Miami, FL 33179" }}',
    "{% unsubscribe_url %}",
    "{% view_in_browser_url %}",
    '{{ user.firstName | default: "Friend" }}',
  ];

  it("keeps every Liquid tag from the Mautic fixture", () => {
    const saved = roundTrip(MAUTIC_EMAIL);
    for (const tag of liquid) {
      expect(saved.split(tag).length).toBe(MAUTIC_EMAIL.split(tag).length);
    }
    expect(hasUnsubscribeLink(saved)).toBe(true);
  });

  it("in text", () => {
    const body =
      '<p>Hi {{ user.firstName | default: "there" }} &amp; {{ a | append: "&b" }} {{ n | plus: 1 }}</p>';
    expect(roundTrip(body)).toBe(body);
  });

  it("in attributes, choosing quotes that keep Liquid valid", () => {
    expect(
      roundTrip(
        `<img src="https://x.test/{{ user.id }}.png" alt="Hi {{ user.firstName | default: 'there' }}">`,
      ),
    ).toBe(
      `<img src="https://x.test/{{ user.id }}.png" alt="Hi {{ user.firstName | default: 'there' }}"/>`,
    );
    expect(
      roundTrip(
        `<img src="a.png" alt='Hi {{ user.firstName | default: "x" }}'>`,
      ),
    ).toBe(`<img src="a.png" alt='Hi {{ user.firstName | default: "x" }}'/>`);
    expect(roundTrip(`<p title="{% if a > b %}x{% endif %}">t</p>`)).toBe(
      `<p title="{% if a > b %}x{% endif %}">t</p>`,
    );
  });

  it("in hrefs", () => {
    const body =
      '<p><a href="{% unsubscribe_url %}">Unsubscribe</a> <a href="https://tryamie.com/?e={{ user.email | url_encode }}&amp;r=1">Shop</a> <a href="{% subscription_management_url %}">Manage</a></p>';
    expect(roundTrip(body)).toBe(body);
  });

  it("restores escaped Liquid and &nbsp; without touching comments", () => {
    expect(
      restoreLiquidAndEntities(
        '<p>{{ a | append: "&amp;b" }} x</p><!--[if mso]>{{ &amp; }}<![endif]--><a title="{{ x | default: &quot;y&quot; }}">',
      ),
    ).toBe(
      `<p>{{ a | append: "&b" }}&nbsp;x</p><!--[if mso]>{{ &amp; }}<![endif]--><a title='{{ x | default: "y" }}'>`,
    );
  });
});

describe("visual editor HTML mode: risky content", () => {
  it("finds nothing risky in a clean Mautic email (head content is preserved, not warned)", () => {
    expect(detectHtmlImportRisks(MAUTIC_EMAIL)).toEqual([]);
  });

  it("flags Outlook conditionals, comments, scripts, body styles and Liquid logic around elements", () => {
    const body = `${MAUTIC_HEAD}
      <!-- header -->
      <!--[if mso]><table><tr><td width="600"><![endif]-->
      <table><tr><td>Hi</td></tr>
      {% if user.vip %}<tr><td>VIP</td></tr>{% endif %}
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <style>.x{color:red}</style>
      <script>track()</script>
      <td {% if a %}class="a"{% endif %}>x</td>
    ${MAUTIC_TAIL}`;
    expect(detectHtmlImportRisks(body).map((r) => r.id)).toEqual([
      "msoConditional",
      "comments",
      "script",
      "bodyStyle",
      "liquidControl",
      "liquidInTag",
    ]);
  });

  it("does not flag Liquid logic inside text or attributes", () => {
    expect(
      detectHtmlImportRisks(
        `<p>Hi {% if user.firstName %}{{ user.firstName }}{% else %}there{% endif %}!</p><a href="{% if a %}https://a.test{% else %}https://b.test{% endif %}">x</a>`,
      ),
    ).toEqual([]);
    expect(
      detectHtmlImportRisks(
        `<div>{% for p in user.picks %}<p>{{ p }}</p>{% endfor %}</div>`,
      ).map((r) => r.id),
    ).toEqual(["liquidControl"]);
  });

  it("shows what GrapesJS actually does with risky content", () => {
    const saved = roundTrip(
      `<!-- note --><script>x()</script><table><tr><td>a</td></tr>{% if v %}<tr><td>b</td></tr>{% endif %}</table>`,
    );
    expect(saved).not.toContain("<script");
    expect(saved).not.toContain("<!-- note -->");
    // the Liquid block was moved out of the table, so it no longer wraps the row
    expect(saved).not.toMatch(/\{% if v %\}<tr>/);
  });
});

describe("visual editor HTML mode: warnings and blocks", () => {
  it("warns about missing alt text, dead links, empty variables and missing unsubscribe", () => {
    expect(
      visualHtmlWarnings(
        '<html><head><title>t</title></head><body><img src="a.png"><img src="b.png" alt=""><a href="#">x</a><p>{{ }}</p></body></html>',
      ),
    ).toEqual([
      "1 image missing alt text",
      "1 link without a destination",
      "An empty {{ }} variable will render blank",
      "No unsubscribe link",
    ]);
    expect(visualHtmlWarnings(MAUTIC_EMAIL)).toEqual([]);
  });

  it("HTML blocks parse in plain GrapesJS and survive a save", () => {
    const editor = newEditor();
    editor.setComponents(HTML_BLOCKS.map((b) => b.content).join(""));
    const saved = exportHtmlDocument(editor, splitHtmlDocument("").shell);
    expect(saved).toContain('href="{% unsubscribe_url %}"');
    expect(saved).toContain(">Shop now</a>");
    expect(saved).toContain("&nbsp;");
    expect(saved).not.toMatch(/\sid="/);
    expect(new Set(HTML_BLOCKS.map((b) => b.id)).size).toBe(HTML_BLOCKS.length);
  });
});
