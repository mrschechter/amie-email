/**
 * @jest-environment jsdom
 */
import grapesjs, { Component, Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";

import { MAUTIC_EMAIL } from "./__fixtures__/mauticEmail";
import {
  configureHtmlModeComponents,
  getImageLink,
  getImageSrc,
  imageTraits,
  installImageSettings,
  placeDroppedComponent,
  setImageLink,
  setImageSrc,
} from "./visualEmailComponents";
import {
  exportHtmlDocument,
  HTML_BLOCKS,
  importHtmlIntoEditor,
  splitHtmlDocument,
} from "./visualEmailHtml";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function htmlEditor(body = MAUTIC_EMAIL) {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    protectedCss: "",
  });
  configureHtmlModeComponents(editor);
  editors.push(editor);
  const split = splitHtmlDocument(body);
  importHtmlIntoEditor(editor, split);
  return { editor, save: () => exportHtmlDocument(editor, split.shell) };
}

function mjmlEditor(mjml: string) {
  const editor = grapesjs.init({
    headless: true,
    storageManager: false,
    plugins: [(e: Editor) => grapesjsMjml(e, {})],
  });
  installImageSettings(editor, "mjml");
  editors.push(editor);
  editor.setComponents(mjml);
  return editor;
}

function all(root: Component | undefined): Component[] {
  if (!root) return [];
  return [root, ...root.components().models.flatMap((c) => all(c))];
}

function wrapperOf(editor: Editor): Component {
  const wrapper = editor.getWrapper();
  if (!wrapper) throw new Error("no wrapper");
  return wrapper;
}

function parentOf(component: Component): Component {
  const parent = component.parent();
  if (!parent) throw new Error("no parent");
  return parent;
}

function find(editor: Editor, match: (c: Component) => boolean): Component {
  const found = all(editor.getWrapper()).find(match);
  if (!found) throw new Error("component not found");
  return found;
}

const bySrc = (part: string) => (c: Component) =>
  c.get("type") === "image" && String(c.get("src")).includes(part);

/** Every table section holds only rows, and every row only cells. */
function assertValidTables(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("table").forEach((table) => {
    Array.from(table.children).forEach((child) => {
      expect([
        "TBODY",
        "THEAD",
        "TFOOT",
        "TR",
        "CAPTION",
        "COLGROUP",
      ]).toContain(child.tagName);
    });
  });
  doc.querySelectorAll("tbody, thead, tfoot").forEach((section) => {
    Array.from(section.children).forEach((child) => {
      expect(child.tagName).toBe("TR");
    });
  });
  doc.querySelectorAll("tr").forEach((row) => {
    Array.from(row.children).forEach((child) => {
      expect(["TD", "TH"]).toContain(child.tagName);
    });
  });
  return doc;
}

describe("image settings: HTML mode", () => {
  it("exposes Image URL, choose/upload, alt, link URL and link target", () => {
    expect(imageTraits().map((t) => t.name)).toEqual([
      "amie-image-src",
      "amie-choose-image",
      "alt",
      "amie-link-href",
      "amie-link-target",
    ]);
    const { editor } = htmlEditor();
    const logo = find(editor, bySrc("logo.png"));
    expect(logo.getTraits().map((t) => t.getName())).toEqual([
      "amie-image-src",
      "amie-choose-image",
      "alt",
      "amie-link-href",
      "amie-link-target",
    ]);
  });

  it("reads and edits the link that wraps an imported image", () => {
    const { editor, save } = htmlEditor();
    const logo = find(editor, bySrc("logo.png"));
    expect(getImageLink(logo)).toEqual({
      href: "https://tryamie.com/?utm_source=email&utm_campaign=october",
      target: "",
    });
    setImageLink(logo, {
      href: "https://tryamie.com/new?e={{ user.email | url_encode }}",
      target: "_blank",
    });
    setImageSrc(logo, "https://assets.example.com/logo-2.png");
    expect(getImageSrc(logo)).toBe("https://assets.example.com/logo-2.png");
    const saved = save();
    expect(saved).toContain(
      '<a href="https://tryamie.com/new?e={{ user.email | url_encode }}" target="_blank"><img src="https://assets.example.com/logo-2.png" alt="Amie"',
    );
  });

  it("links an unlinked image by wrapping it, and unlinks by unwrapping", () => {
    const { editor, save } = htmlEditor();
    const hero = find(editor, bySrc("hero.jpg"));
    expect(getImageLink(hero).href).toBe("");
    const linked = setImageLink(hero, {
      href: "{% view_in_browser_url %}",
      target: "_blank",
    });
    expect(linked.parent()?.get("tagName")).toBe("a");
    let saved = save();
    expect(saved).toMatch(
      /<a href="\{% view_in_browser_url %\}" target="_blank"><img src="https:\/\/assets\.example\.com\/hero\.jpg"/,
    );
    // alt/title with Liquid survive the re-creation
    expect(saved).toContain(
      `title='Picks for {{ user.firstName | default: "you" }}'`,
    );
    const unlinked = setImageLink(linked, { href: "" });
    expect(unlinked.parent()?.get("tagName")).not.toBe("a");
    saved = save();
    expect(saved).not.toContain('view_in_browser_url %}" target');
    expect(saved).toMatch(/<td style="padding:8px 24px;"><h1/);
  });

  it("trait getters/setters drive the same model changes", () => {
    const { editor } = htmlEditor();
    const logo = find(editor, bySrc("logo.png"));
    const hrefTrait = logo.getTrait("amie-link-href");
    expect(hrefTrait.getValue()).toBe(
      "https://tryamie.com/?utm_source=email&utm_campaign=october",
    );
    hrefTrait.setValue("https://changed.test");
    expect(getImageLink(find(editor, bySrc("logo.png"))).href).toBe(
      "https://changed.test",
    );
  });
});

describe("image settings: MJML mode", () => {
  const mjml =
    '<mjml><mj-body><mj-section><mj-column><mj-image src="https://a.test/a.png" alt="A"></mj-image></mj-column></mj-section></mj-body></mjml>';

  it("edits mj-image src, href and target attributes", () => {
    const editor = mjmlEditor(mjml);
    const image = find(editor, (c) => c.get("type") === "mj-image");
    expect(image.getTraits().map((t) => t.getName())).toEqual([
      "amie-image-src",
      "amie-choose-image",
      "alt",
      "amie-link-href",
      "amie-link-target",
      "title",
    ]);
    setImageSrc(image, "https://a.test/b.png");
    setImageLink(image, { href: "{% unsubscribe_url %}", target: "_self" });
    expect(editor.getHtml()).toContain(
      '<mj-image src="https://a.test/b.png" alt="A" href="{% unsubscribe_url %}" target="_self">',
    );
    setImageLink(image, { href: "", target: "" });
    expect(editor.getHtml()).not.toContain("href=");
  });

  it("MJML layout rules keep blocks out of sections and the body", () => {
    const editor = mjmlEditor(mjml);
    const droppable = (type: string) =>
      String(find(editor, (c) => c.get("type") === type).get("droppable"));
    // mj-section/mj-body only accept columns/sections, so an image or text
    // block can't land between them and break the layout
    expect(droppable("mj-section")).not.toContain("mj-image");
    expect(droppable("mj-section")).toContain("mj-column");
    expect(droppable("mj-body")).not.toContain("mj-text");
  });
});

describe("text directly in table cells", () => {
  it("becomes an editable text component and saves unchanged", () => {
    const { editor, save } = htmlEditor();
    const footer = find(
      editor,
      (c) =>
        c.get("tagName") === "td" &&
        c
          .components()
          .models.some(
            (x) => x.getAttributes().href === "{% unsubscribe_url %}",
          ),
    );
    expect(footer.get("type")).toBe("amie-text-cell");
    expect(footer.get("editable")).toBe(true);
    // layout cells (holding tables/images/blocks) stay cells
    const logoCell = find(
      editor,
      (c) =>
        c.get("tagName") === "td" &&
        c.components().models.some((x) => x.get("tagName") === "a"),
    );
    expect(logoCell.get("type")).toBe("cell");
    const once = save();
    const { editor: again, save: save2 } = htmlEditor(once);
    expect(again).toBeDefined();
    expect(save2()).toBe(once);
  });
});

describe("dropping blocks into a Mautic table layout", () => {
  const block = (id: string) => {
    const found = HTML_BLOCKS.find((b) => b.id === id);
    if (!found) throw new Error(id);
    return found.content;
  };

  function drop(
    editor: Editor,
    target: Component,
    content: string,
    at: number,
  ) {
    const added = target.components().add(content, { at });
    const component = Array.isArray(added) ? added[0] : added;
    if (!component) throw new Error("not added");
    return placeDroppedComponent(editor, component);
  }

  const containerTable = (editor: Editor) =>
    find(
      editor,
      (c) =>
        c.get("tagName") === "table" && c.getClasses().includes("container"),
    );

  it("a block dropped below the email (outside the content card) becomes the card's last row", () => {
    const { editor, save } = htmlEditor();
    const wrapper = wrapperOf(editor);
    const placed = drop(
      editor,
      wrapper,
      block("amie-html-image"),
      wrapper.components().length,
    );
    const card = containerTable(editor);
    expect(all(card)).toContain(placed);
    const saved = save();
    const doc = assertValidTables(saved);
    const rows = doc.querySelectorAll("table.container > tbody > tr");
    const last = rows[rows.length - 1];
    expect(last?.querySelector("img")?.getAttribute("alt")).toBe(
      "Describe this image",
    );
    // padded like the neighbouring row's content cell
    expect(last?.querySelector("td")?.getAttribute("style")).toBe(
      "padding:8px 24px 8px 24px;",
    );
    // nothing left at the top level next to the layout table
    expect(doc.body.children).toHaveLength(1);
  });

  it("a block dropped above the email becomes the card's first row", () => {
    const { editor, save } = htmlEditor();
    drop(editor, wrapperOf(editor), block("amie-html-heading"), 0);
    const doc = assertValidTables(save());
    const first = doc.querySelector("table.container > tbody > tr");
    expect(first?.querySelector("h2")?.textContent).toBe("Heading");
  });

  it("a block dropped into the centering cell around the card goes into the card", () => {
    const { editor, save } = htmlEditor();
    const card = containerTable(editor);
    const layoutCell = parentOf(card);
    expect(layoutCell.get("tagName")).toBe("td");
    drop(
      editor,
      layoutCell,
      block("amie-html-button"),
      layoutCell.components().length,
    );
    const doc = assertValidTables(save());
    const rows = doc.querySelectorAll("table.container > tbody > tr");
    expect(rows[rows.length - 1]?.textContent).toContain("Shop now");
    expect(layoutCell.components().length).toBe(1);
  });

  it("a block dropped straight into a table section or row is wrapped in its own row", () => {
    const { editor, save } = htmlEditor();
    const tbody = find(
      editor,
      (c) =>
        c.get("tagName") === "tbody" && c.parent() === containerTable(editor),
    );
    drop(editor, tbody, block("amie-html-text"), 1);
    const row = find(
      editor,
      (c) => c.get("tagName") === "tr" && c.parent() === tbody,
    );
    drop(editor, row, block("amie-html-divider"), 0);
    assertValidTables(save());
  });

  it("spans every column when the table has several", () => {
    const { editor, save } = htmlEditor(
      '<table class="grid"><tr><td>a</td><td>b</td></tr></table>',
    );
    drop(editor, wrapperOf(editor), block("amie-html-text"), 1);
    const doc = assertValidTables(save());
    const cells = doc.querySelectorAll("table.grid tr:last-child > td");
    expect(cells).toHaveLength(1);
    expect(cells[0]?.getAttribute("colspan")).toBe("2");
  });

  it("leaves blocks dropped inside a content cell where they are", () => {
    const { editor, save } = htmlEditor();
    const h1 = find(editor, (c) => c.get("tagName") === "h1");
    const cell = parentOf(h1);
    const placed = drop(editor, cell, block("amie-html-text"), 1);
    expect(placed.parent()).toBe(cell);
    assertValidTables(save());
  });
});
