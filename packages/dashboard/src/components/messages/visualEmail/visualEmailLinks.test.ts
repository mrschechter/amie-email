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
import { applyLink, insertPasted, readLink } from "./visualEmailRte";
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
