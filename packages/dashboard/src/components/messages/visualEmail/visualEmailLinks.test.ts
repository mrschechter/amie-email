/**
 * @jest-environment jsdom
 */
import grapesjs, { Component, Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";

import { MAUTIC_EMAIL } from "./__fixtures__/mauticEmail";
import {
  configureHtmlModeComponents,
  installImageSettings,
  linkHrefTrait,
  repairComponentLinks,
} from "./visualEmailComponents";
import {
  exportHtmlDocument,
  importHtmlIntoEditor,
  splitHtmlDocument,
} from "./visualEmailHtml";
import {
  countBrokenLiquidLinks,
  repairLiquidHref,
  repairLiquidLinks,
  validateHref,
} from "./visualEmailLinks";
import {
  applyLink,
  applySavedLink,
  expandToWord,
  insertPasted,
  insertVariable,
  linkTextFor,
  readLink,
  restoreSelection,
  RteLike,
  saveSelection,
  syncAfterDeferredEdit,
} from "./visualEmailRte";
import {
  visualDesignWarnings,
  visualHtmlWarnings,
} from "./visualEmailWarnings";

const TAGS = [
  "{% unsubscribe_url %}",
  "{% subscription_management_url %}",
  "{% view_in_browser_url %}",
];
const DASH = "https://email.tryamie.com";
const ORIGINS = [DASH];

/** What Chrome makes of a Liquid href resolved against the template page. */
function resolvedAgainstDashboard(tag: string): string {
  const base = `${DASH}/dashboard/templates/email/2f9c0f3e-0000-4000-8000-000000000000`;
  return new URL(tag, base).href;
}

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function htmlEditor(body: string) {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  editors.push(editor);
  configureHtmlModeComponents(editor);
  const split = splitHtmlDocument(body);
  importHtmlIntoEditor(editor, split);
  return { editor, save: () => exportHtmlDocument(editor, split.shell) };
}

function all(root: Component | undefined): Component[] {
  if (!root) return [];
  return [root, ...root.components().models.flatMap((c) => all(c))];
}

function firstLink(root: HTMLElement): HTMLAnchorElement {
  const a = root.querySelector("a");
  if (!a) throw new Error("no link");
  return a;
}

function editable(text: string, select: string) {
  document.body.innerHTML = "";
  const root = document.createElement("td");
  root.textContent = text;
  document.body.appendChild(root);
  const node = root.firstChild;
  if (!node) throw new Error("no text");
  const range = document.createRange();
  const i = select ? text.indexOf(select) : text.length;
  range.setStart(node, i);
  range.setEnd(node, i + select.length);
  return { root, range };
}

describe("the mangled form this bug produced", () => {
  it("matches Nicholate's report exactly", () => {
    expect(resolvedAgainstDashboard("{% unsubscribe_url %}")).toBe(
      "https://email.tryamie.com/dashboard/templates/email/%7B%%20unsubscribe_url%20%%7D",
    );
    expect(resolvedAgainstDashboard("{% subscription_management_url %}")).toBe(
      "https://email.tryamie.com/dashboard/templates/email/%7B%%20subscription_management_url%20%%7D",
    );
  });
});

describe("RTE link dialog → attribute", () => {
  it.each(TAGS)("inserting %s stores it byte-exact", (tag) => {
    const { root, range } = editable("Unsubscribe here", "Unsubscribe");
    applyLink(root, range, { href: tag, target: "_blank" });
    expect(root.innerHTML).toBe(
      `<a href="${tag}" target="_blank">Unsubscribe</a> here`,
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe(tag);
  });

  it("editing an existing Liquid link keeps it (and the prefill is the attribute)", () => {
    document.body.innerHTML = "";
    const root = document.createElement("td");
    root.innerHTML = '<a href="{% unsubscribe_url %}">Unsubscribe</a>';
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(firstLink(root));
    expect(readLink(root, range)).toEqual({
      href: "{% unsubscribe_url %}",
      target: "",
    });
    applyLink(root, range, { href: "{% unsubscribe_url %}", target: "_blank" });
    expect(root.innerHTML).toBe(
      '<a href="{% unsubscribe_url %}" target="_blank">Unsubscribe</a>',
    );
  });

  it("a mangled link is prefilled and saved repaired", () => {
    document.body.innerHTML = "";
    const root = document.createElement("td");
    const broken = resolvedAgainstDashboard(
      "{% subscription_management_url %}",
    );
    root.innerHTML = `<a href="${broken}">Manage</a>`;
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(firstLink(root));
    expect(readLink(root, range)?.href).toBe(
      "{% subscription_management_url %}",
    );
    applyLink(root, range, { href: broken, target: "" });
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "{% subscription_management_url %}",
    );
  });

  it("a normal https link is unchanged", () => {
    const { root, range } = editable("Shop now", "Shop");
    applyLink(root, range, {
      href: "https://tryamie.com/shop?a=1&b=%20x",
      target: "",
    });
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://tryamie.com/shop?a=1&b=%20x",
    );
  });

  it("pasted HTML (Chrome copies resolved hrefs) is repaired and cleaned", () => {
    const { root, range } = editable("Footer: ", "");
    const html = `<meta charset="utf-8"><span class="gjs-x" data-gjs-type="text"><a href="${resolvedAgainstDashboard("{% unsubscribe_url %}")}" style="color:#2D7A7A;">Unsubscribe</a> · <a href="https://tryamie.com/">Shop</a></span><script>x()</script>`;
    insertPasted(root, range, html, "");
    expect(root.innerHTML).toBe(
      'Footer: <span><a href="{% unsubscribe_url %}" style="color:#2D7A7A;">Unsubscribe</a> · <a href="https://tryamie.com/">Shop</a></span>',
    );
  });

  it("plain-text paste keeps line breaks", () => {
    const { root, range } = editable("x", "x");
    insertPasted(root, range, "", "a\nb");
    expect(root.innerHTML).toBe("a<br>b");
  });
});

/**
 * Nicholate 2026-10-28: linking "Unsubscribe" / "Manage subscription" put the
 * Liquid tag as text next to the words. Double-clicking a word in a text
 * block that isn't being edited yet leaves only a caret in it (GrapesJS
 * starts editing and places the caret at the click), so the link was
 * inserted at the caret with the tag as its text; the Variables menu inserted
 * the URL tag as plain text. In MJML mode a link from the dialog was also
 * dropped on save.
 */
describe("linking footer text to unsubscribe / manage subscription", () => {
  const FOOTER = "Unsubscribe | Manage subscription";

  function caret(text: string, at: number) {
    const { root, range } = editable(text, "");
    const node = root.firstChild;
    if (!node) throw new Error("no text");
    range.setStart(node, at);
    range.collapse(true);
    return { root, range };
  }

  it.each([
    ["inside", 5],
    ["at the start of", 0],
    ["at the end of", "Unsubscribe".length],
  ])("a caret %s the word links the word, not the tag text", (_where, at) => {
    const { root, range } = caret(FOOTER, Number(at));
    applyLink(root, range, { href: "{% unsubscribe_url %}", target: "_blank" });
    expect(root.innerHTML).toBe(
      '<a href="{% unsubscribe_url %}" target="_blank">Unsubscribe</a> | Manage subscription',
    );
  });

  it("with no word at the caret, inserts a labelled link (never the raw tag)", () => {
    const { root, range } = caret("Footer: ", "Footer: ".length);
    applyLink(root, range, {
      href: "{% subscription_management_url %}",
      target: "_blank",
    });
    expect(root.innerHTML).toBe(
      'Footer: <a href="{% subscription_management_url %}" target="_blank">Manage subscription</a>',
    );
    expect(root.textContent).not.toContain("{%");
  });

  it("labels for links inserted with nothing selected", () => {
    expect(linkTextFor("{% unsubscribe_url %}")).toBe("Unsubscribe");
    expect(linkTextFor("{% subscription_management_url %}")).toBe(
      "Manage subscription",
    );
    expect(linkTextFor("{% view_in_browser_url %}")).toBe("View in browser");
    expect(linkTextFor("{{ user.offerUrl }}")).toBe("Link");
    expect(linkTextFor("https://tryamie.com")).toBe("https://tryamie.com");
    expect(linkTextFor("mailto:care@tryamie.com")).toBe("care@tryamie.com");
  });

  it("expandToWord leaves a caret between words alone", () => {
    const { range } = caret("a | b", 2);
    expect(expandToWord(range)).toBe(false);
    expect(range.collapsed).toBe(true);
  });

  it.each([
    ["Unsubscribe", "{% unsubscribe_url %}"],
    ["Manage subscription", "{% subscription_management_url %}"],
  ])(
    "Variables menu: %s selected + its URL variable wraps the text in a link",
    (word, tag) => {
      const { root, range } = editable(FOOTER, word);
      insertVariable(root, range, tag);
      const a = firstLink(root);
      expect(a.getAttribute("href")).toBe(tag);
      expect(a.textContent).toBe(word);
      expect(root.textContent).toBe(FOOTER);
    },
  );

  it("Variables menu: a URL variable at a caret links the word / adds a labelled link", () => {
    const inWord = caret(FOOTER, 3);
    insertVariable(inWord.root, inWord.range, "{% unsubscribe_url %}");
    expect(inWord.root.innerHTML).toBe(
      '<a href="{% unsubscribe_url %}" target="_blank">Unsubscribe</a> | Manage subscription',
    );
    document.body.innerHTML = "";
    const emptyRoot = document.createElement("td");
    document.body.appendChild(emptyRoot);
    const emptyRange = document.createRange();
    emptyRange.setStart(emptyRoot, 0);
    insertVariable(emptyRoot, emptyRange, "{% view_in_browser_url %}");
    expect(emptyRoot.innerHTML).toBe(
      '<a href="{% view_in_browser_url %}" target="_blank">View in browser</a>',
    );
  });

  it("Variables menu: text variables are still inserted exactly", () => {
    const { root, range } = caret("Hi ,", 3);
    insertVariable(root, range, '{{ user.firstName | default: "there" }}');
    expect(root.innerHTML).toBe('Hi {{ user.firstName | default: "there" }},');
  });

  it("Variables menu: selecting text inside an existing link retargets it", () => {
    document.body.innerHTML = "";
    const root = document.createElement("td");
    root.innerHTML = '<a href="#">Unsubscribe</a> | Manage subscription';
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(firstLink(root));
    insertVariable(root, range, "{% unsubscribe_url %}");
    expect(root.innerHTML).toBe(
      '<a href="{% unsubscribe_url %}" target="_blank">Unsubscribe</a> | Manage subscription',
    );
  });
});

/**
 * Nicholate 2026-10-28 (WARMING EMAIL 11): selecting words and adding any
 * link — https CTAs too — put the URL as the link text at the *start* of the
 * text block. The link dialog takes focus, GrapesJS stops editing and, since
 * the text was edited, rebuilds the block's DOM from the model; the Range
 * saved when the dialog opened then pointed at removed nodes and collapsed
 * to offset 0 of the block.
 */
describe("the selection survives GrapesJS rebuilding the text block", () => {
  const BLOCK = "Read about <b>tamarind</b> and its benefits for women today.";

  function block(selectWord: string) {
    document.body.innerHTML = "";
    const root = document.createElement("td");
    root.innerHTML = BLOCK;
    document.body.appendChild(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text: Node | null = null;
    while (!text && walker.nextNode()) {
      if (walker.currentNode.textContent?.includes(selectWord)) {
        text = walker.currentNode;
      }
    }
    if (!text) throw new Error("no text");
    const range = document.createRange();
    const i = (text.textContent ?? "").indexOf(selectWord);
    range.setStart(text, i);
    range.setEnd(text, i + selectWord.length);
    const rte: RteLike = {
      el: root,
      doc: document,
      selection: () => document.getSelection(),
    };
    return { root, range, rte };
  }

  /** What GrapesJS does when editing stops: same content, new nodes. */
  function rebuild(root: HTMLElement) {
    const html = root.innerHTML;
    root.innerHTML = html;
  }

  it("the old way: a saved live Range collapses to the start of the block", () => {
    const { root, range } = block("women");
    const saved = range.cloneRange();
    rebuild(root);
    expect(saved.collapsed).toBe(true);
    expect(saved.startContainer).toBe(root);
    expect(saved.startOffset).toBe(0);
    // …which is where the link (with the URL as its text) ended up
    applyLink(root, saved, { href: "https://tryamie.com/x", target: "" });
    expect(root.innerHTML.startsWith("<a ")).toBe(true);
  });

  it.each(["women", "Read", "today", "tamarind"])(
    "a CTA link wraps %s after the rebuild",
    (word) => {
      const { root, range, rte } = block(word);
      const saved = saveSelection(root, range);
      rebuild(root);
      expect(
        applySavedLink(rte, saved, {
          href: "https://tryamie.com/tamarind",
          target: "_blank",
        }),
      ).toBe(true);
      const a = firstLink(root);
      expect(a.textContent).toBe(word);
      expect(a.getAttribute("href")).toBe("https://tryamie.com/tamarind");
      expect(root.textContent).toBe(
        "Read about tamarind and its benefits for women today.",
      );
    },
  );

  it("an unsubscribe link wraps the footer word after the rebuild", () => {
    document.body.innerHTML = "";
    const root = document.createElement("div");
    root.textContent = "Unsubscribe | Manage subscription";
    document.body.appendChild(root);
    const range = document.createRange();
    const node = root.firstChild;
    if (!node) throw new Error("no text");
    range.setStart(node, 14);
    range.setEnd(node, 33);
    const saved = saveSelection(root, range);
    rebuild(root);
    const rte: RteLike = {
      el: root,
      doc: document,
      selection: () => document.getSelection(),
    };
    applySavedLink(rte, saved, {
      href: "{% subscription_management_url %}",
      target: "_blank",
    });
    expect(root.innerHTML).toBe(
      'Unsubscribe | <a href="{% subscription_management_url %}" target="_blank">Manage subscription</a>',
    );
  });

  it("selections spanning formatting round-trip exactly", () => {
    const { root } = block("Read");
    const range = document.createRange();
    const b = root.querySelector("b");
    const after = b?.nextSibling;
    if (!b?.firstChild || !after) throw new Error("bad fixture");
    range.setStart(b.firstChild, 3); // "tam|arind"
    range.setEnd(after, 4); // " and| its"
    const saved = saveSelection(root, range);
    rebuild(root);
    expect(restoreSelection(root, saved).toString()).toBe("arind and");
  });

  it("removing a link works on the rebuilt block too", () => {
    document.body.innerHTML = "";
    const root = document.createElement("td");
    root.innerHTML = 'Go <a href="https://tryamie.com">here</a> now';
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(firstLink(root));
    const saved = saveSelection(root, range);
    rebuild(root);
    const rte: RteLike = {
      el: root,
      doc: document,
      selection: () => document.getSelection(),
    };
    applySavedLink(rte, saved, null);
    expect(root.innerHTML).toBe("Go here now");
  });

  it("does nothing if the text block is gone", () => {
    const { root, range, rte } = block("women");
    const saved = saveSelection(root, range);
    root.remove();
    expect(
      applySavedLink(rte, saved, { href: "https://tryamie.com", target: "" }),
    ).toBe(false);
  });
});

describe("deferred toolbar edits are written back (HTML and MJML)", () => {
  /** Minimal GrapesJS shape: a wrapper with one text component. */
  function fakeEditor(view: {
    el: HTMLElement;
    container: HTMLElement;
    rteEnabled: boolean;
  }) {
    const syncContent = jest.fn(async () => {});
    const text = {
      getView: () => ({
        el: view.el,
        rteEnabled: view.rteEnabled,
        getChildrenContainer: () => view.container,
        syncContent,
      }),
      components: () => ({ models: [] }),
    };
    const wrapper = {
      getView: () => ({
        el: document.body,
        getChildrenContainer: () => document.body,
      }),
      components: () => ({ models: [text] }),
    };
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const editor = { getWrapper: () => wrapper } as unknown as Editor;
    return { editor, syncContent };
  }

  it("MJML: the RTE edits mj-text's inner container, which is matched and synced", () => {
    const el = document.createElement("div");
    const container = document.createElement("div");
    el.appendChild(container);
    container.innerHTML =
      '<a href="{% unsubscribe_url %}" target="_blank">Unsubscribe</a> | Manage subscription';
    const { editor, syncContent } = fakeEditor({
      el,
      container,
      rteEnabled: false,
    });
    syncAfterDeferredEdit(editor, container);
    expect(syncContent).toHaveBeenCalledWith({
      force: true,
      content: container.innerHTML,
    });
  });

  it("HTML: a text cell edits its own element", () => {
    const el = document.createElement("td");
    el.innerHTML = '<a href="{% unsubscribe_url %}">Unsubscribe</a>';
    const { editor, syncContent } = fakeEditor({
      el,
      container: el,
      rteEnabled: false,
    });
    syncAfterDeferredEdit(editor, el);
    expect(syncContent).toHaveBeenCalledTimes(1);
  });

  it("still editing: GrapesJS syncs it itself when editing stops", () => {
    const el = document.createElement("td");
    const { editor, syncContent } = fakeEditor({
      el,
      container: el,
      rteEnabled: true,
    });
    syncAfterDeferredEdit(editor, el);
    expect(syncContent).not.toHaveBeenCalled();
  });
});

describe("repairing mangled Liquid hrefs", () => {
  it.each(TAGS)("restores %s from the dashboard-resolved URL", (tag) => {
    expect(repairLiquidHref(resolvedAgainstDashboard(tag), ORIGINS)).toBe(tag);
  });

  it("restores fully URL-encoded and relative forms, and {{ }} outputs", () => {
    expect(repairLiquidHref("%7B%25%20unsubscribe_url%20%25%7D", ORIGINS)).toBe(
      "{% unsubscribe_url %}",
    );
    expect(
      repairLiquidHref(
        "/dashboard/templates/email/%7B%%20view_in_browser_url%20%%7D",
        ORIGINS,
      ),
    ).toBe("{% view_in_browser_url %}");
    expect(
      repairLiquidHref(
        `${DASH}/dashboard/templates/email/%7B%7B%20user.shopUrl%20%7D%7D`,
        ORIGINS,
      ),
    ).toBe("{{ user.shopUrl }}");
    // the dashboard origin itself, even without /dashboard/
    expect(
      repairLiquidHref(`${DASH}/%7B%%20unsubscribe_url%20%%7D`, ORIGINS),
    ).toBe("{% unsubscribe_url %}");
  });

  it("leaves real links and already-correct Liquid alone", () => {
    for (const href of [
      "https://tryamie.com/shop",
      "https://tryamie.com/p/%7B%7B%20user.slug%20%7D%7D", // a real site, not the editor
      "mailto:info@tryamie.com",
      "tel:+13055550100",
      "{% unsubscribe_url %}",
      "https://tryamie.com/?e={{ user.email | url_encode }}",
      "#top",
    ]) {
      expect(repairLiquidHref(href, ORIGINS)).toBe(href);
    }
  });

  it("repairs markup attributes and counts them", () => {
    const broken = `<a href="${resolvedAgainstDashboard("{% unsubscribe_url %}")}">u</a><a href='${resolvedAgainstDashboard("{% subscription_management_url %}")}'>m</a><a href="https://tryamie.com">s</a>`;
    expect(countBrokenLiquidLinks(broken, ORIGINS)).toBe(2);
    expect(repairLiquidLinks(broken, ORIGINS).markup).toBe(
      '<a href="{% unsubscribe_url %}">u</a><a href="{% subscription_management_url %}">m</a><a href="https://tryamie.com">s</a>',
    );
  });

  it("warns on open (HTML and MJML) without changing anything", () => {
    const html = MAUTIC_EMAIL.replace(
      'href="{% unsubscribe_url %}"',
      `href="${resolvedAgainstDashboard("{% unsubscribe_url %}")}"`,
    );
    expect(visualHtmlWarnings(html).join(" ")).toMatch(
      /1 link points to the editor/,
    );
    expect(
      visualDesignWarnings(
        `<mjml><mj-body><mj-text><a href="${resolvedAgainstDashboard("{% unsubscribe_url %}")}">u</a></mj-text></mj-body></mjml>`,
      ).join(" "),
    ).toMatch(/1 link points to the editor/);
  });
});

describe("HTML-mode save repairs; parse keeps", () => {
  it("opening keeps the body as-is; saving restores the Liquid href", () => {
    const broken = MAUTIC_EMAIL.replace(
      'href="{% unsubscribe_url %}"',
      `href="${resolvedAgainstDashboard("{% unsubscribe_url %}")}"`,
    );
    const { editor, save } = htmlEditor(broken);
    // the model still has what the email had (nothing written on open)
    const link = all(editor.getWrapper()).find((c) =>
      String(c.getAttributes().href ?? "").includes("%7B"),
    );
    expect(link).toBeDefined();
    const saved = save();
    expect(saved).toContain('href="{% unsubscribe_url %}"');
    expect(saved).not.toContain("%7B");
    expect(repairComponentLinks(editor)).toBe(1);
    expect(link?.getAttributes().href).toBe("{% unsubscribe_url %}");
  });

  it("Liquid hrefs survive an HTML-mode round trip untouched", () => {
    const saved = htmlEditor(MAUTIC_EMAIL).save();
    for (const tag of ["{% unsubscribe_url %}", "{% view_in_browser_url %}"]) {
      expect(saved).toContain(`href="${tag}"`);
    }
  });
});

describe("Link URL traits", () => {
  it("link components (incl. button links) read/write the raw attribute", () => {
    const { editor, save } = htmlEditor(MAUTIC_EMAIL);
    const cta = all(editor.getWrapper()).find((c) =>
      String(c.getAttributes().href ?? "").includes("picks"),
    );
    if (!cta) throw new Error("no cta");
    const trait = cta.getTrait("amie-href");
    expect(trait).toBeDefined();
    trait.setValue("{% subscription_management_url %}");
    expect(trait.getValue()).toBe("{% subscription_management_url %}");
    expect(save()).toContain('href="{% subscription_management_url %}"');
    // a mangled value typed/pasted into the trait is repaired
    trait.setValue(resolvedAgainstDashboard("{% unsubscribe_url %}"));
    expect(cta.getAttributes().href).toBe("{% unsubscribe_url %}");
  });

  it("image Link URL trait keeps Liquid exactly", () => {
    const { editor, save } = htmlEditor(MAUTIC_EMAIL);
    const logo = all(editor.getWrapper()).find(
      (c) => c.get("type") === "image" && String(c.get("src")).includes("logo"),
    );
    logo?.getTrait("amie-link-href")?.setValue("{% view_in_browser_url %}");
    expect(save()).toContain('<a href="{% view_in_browser_url %}"><img');
  });

  it("mj-button / mj-image Link URL keep Liquid in MJML", () => {
    const editor = grapesjs.init({
      headless: true,
      storageManager: false,
      plugins: [(e: Editor) => grapesjsMjml(e, {})],
    });
    editors.push(editor);
    installImageSettings(editor, "mjml");
    editor.setComponents(
      '<mjml><mj-body><mj-section><mj-column><mj-button href="https://tryamie.com">Go</mj-button><mj-image src="a.png"></mj-image></mj-column></mj-section></mj-body></mjml>',
    );
    const button = all(editor.getWrapper()).find(
      (c) => c.get("type") === "mj-button",
    );
    button?.getTrait("amie-href")?.setValue("{% unsubscribe_url %}");
    const image = all(editor.getWrapper()).find(
      (c) => c.get("type") === "mj-image",
    );
    image
      ?.getTrait("amie-link-href")
      ?.setValue("{% subscription_management_url %}");
    const mjml = editor.getHtml();
    expect(mjml).toContain('<mj-button href="{% unsubscribe_url %}">');
    expect(mjml).toContain('href="{% subscription_management_url %}"');
    expect(linkHrefTrait().name).toBe("amie-href");
  });
});

describe("validating typed links", () => {
  it.each([
    "{% unsubscribe_url %}",
    "{% subscription_management_url %}",
    "{% view_in_browser_url %}",
    "{{ user.shopUrl }}",
    "https://tryamie.com/?e={{ user.email | url_encode }}",
    "{% view_in_browser_url %}?utm=1",
    "mailto:info@tryamie.com",
    "tel:+13055550100",
    "#top",
    "http://example.com",
  ])("accepts %p", (href) => {
    expect(validateHref(href)).toBeNull();
  });

  it.each([
    ["", /Enter a link/],
    // eslint-disable-next-line no-script-url -- the value being rejected
    ["javascript:alert(1)", /Script/],
    ["{% unsubscribe_url", /isn't closed/],
    ["https://tryamie.com/a b", /spaces/],
    ["tryamie.com", /https:\/\//],
    ["just words", /spaces|web link/],
  ])("rejects %p with a clear message", (href, message) => {
    expect(validateHref(href)).toMatch(message);
  });
});
