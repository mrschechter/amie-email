/**
 * @jest-environment jsdom
 */
import {
  alignBlock,
  applyInlineStyle,
  applyLink,
  canInsertList,
  clearFormatting,
  insertTextAt,
  readLink,
  removeLink,
  toggleList,
} from "./visualEmailRte";

/** Build an editable root from HTML where `[` `]` mark the selection. */
function setup(html: string, tag = "div") {
  const root = document.createElement(tag);
  document.body.innerHTML = "";
  document.body.appendChild(root);
  root.innerHTML = html
    .replace("[", "<i data-s></i>")
    .replace("]", "<i data-e></i>");
  const range = document.createRange();
  const s = root.querySelector("[data-s]");
  const e = root.querySelector("[data-e]");
  if (!s) throw new Error("no selection start");
  range.setStartAfter(s);
  if (e) range.setEndBefore(e);
  else range.collapse(true);
  // live ranges adjust themselves when the marker nodes are removed
  [s, e].forEach((m) => m?.parentNode?.removeChild(m));
  return { root, range };
}

function setupText(
  before: string,
  selected: string,
  after: string,
  tag = "div",
) {
  const root = document.createElement(tag);
  document.body.innerHTML = "";
  document.body.appendChild(root);
  const text = document.createTextNode(`${before}${selected}${after}`);
  root.appendChild(text);
  const range = document.createRange();
  range.setStart(text, before.length);
  range.setEnd(text, before.length + selected.length);
  return { root, range };
}

describe("rich text actions: inline styles", () => {
  it("wraps the selection in a span with an inline style (no classes)", () => {
    const { root, range } = setupText("Hi ", "there", " you");
    applyInlineStyle(root, range, "color", "#B76E79");
    expect(root.innerHTML).toBe(
      'Hi <span style="color:#B76E79;">there</span> you',
    );
    expect(root.innerHTML).not.toContain("class=");
  });

  it("re-applying to the same selection updates the span instead of nesting", () => {
    const { root, range } = setupText("Hi ", "there", "");
    const r1 = applyInlineStyle(root, range, "font-size", "18px");
    const r2 = applyInlineStyle(root, r1, "font-size", "24px");
    applyInlineStyle(
      root,
      r2,
      "font-family",
      "Georgia, 'Times New Roman', serif",
    );
    expect(root.innerHTML).toBe(
      `Hi <span style="font-size:24px;font-family:Georgia, 'Times New Roman', serif;">there</span>`,
    );
  });

  it("replaces the same property on nested content and keeps others", () => {
    const { root, range } = setup(
      '[a <span style="color:red;font-weight:bold;">b</span> c]',
    );
    applyInlineStyle(root, range, "color", "#2D7A7A");
    expect(root.innerHTML).toBe(
      '<span style="color:#2D7A7A;">a <span style="font-weight:bold;">b</span> c</span>',
    );
  });

  it("highlight uses background-color", () => {
    const { root, range } = setupText("", "sale", "");
    applyInlineStyle(root, range, "background-color", "#FFF3A3");
    expect(root.innerHTML).toBe(
      '<span style="background-color:#FFF3A3;">sale</span>',
    );
  });

  it("does nothing for an empty selection", () => {
    const { root, range } = setupText("Hi", "", "");
    applyInlineStyle(root, range, "color", "red");
    expect(root.innerHTML).toBe("Hi");
  });
});

describe("rich text actions: links", () => {
  it("inserts a link with a target around the selection", () => {
    const { root, range } = setupText("Read ", "more", ".");
    applyLink(root, range, {
      href: "https://tryamie.com/?a=1&b=2",
      target: "_blank",
    });
    expect(root.innerHTML).toBe(
      'Read <a href="https://tryamie.com/?a=1&amp;b=2" target="_blank">more</a>.',
    );
  });

  it("keeps Liquid hrefs exactly", () => {
    const { root, range } = setupText("", "Unsubscribe", "");
    applyLink(root, range, { href: "{% unsubscribe_url %}", target: "" });
    expect(root.innerHTML).toBe(
      '<a href="{% unsubscribe_url %}">Unsubscribe</a>',
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "{% unsubscribe_url %}",
    );
  });

  it("edits an existing link and can drop its target", () => {
    const { root, range } = setup(
      '<a href="https://old.test" target="_blank">x[y]z</a>',
    );
    expect(readLink(root, range)).toEqual({
      href: "https://old.test",
      target: "_blank",
    });
    applyLink(root, range, { href: "https://new.test", target: "" });
    expect(root.innerHTML).toBe('<a href="https://new.test">xyz</a>');
  });

  it("removes a link but keeps its text", () => {
    const { root, range } = setup('Go <a href="https://a.test">h[er]e</a> now');
    removeLink(root, range);
    expect(root.innerHTML).toBe("Go here now");
    expect(readLink(root, range)).toBeNull();
  });

  it("removes links inside a larger selection", () => {
    const { root, range } = setup('[a <a href="https://a.test">b</a> c]');
    removeLink(root, range);
    expect(root.innerHTML).toBe("a b c");
  });

  it("does not nest links", () => {
    const { root, range } = setup('[a <a href="https://a.test">b</a>] c');
    applyLink(root, range, { href: "https://b.test", target: "" });
    expect(root.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("rich text actions: lists, alignment, clear, variables", () => {
  it("turns lines into a list with inline spacing, and back", () => {
    const { root, range } = setup("[One<br>Two<br>Three]");
    const r = toggleList(root, range, "ul");
    expect(root.innerHTML).toBe(
      '<ul style="margin:0 0 16px;padding-left:24px;"><li>One</li><li>Two</li><li>Three</li></ul>',
    );
    const inner = document.createRange();
    const li = root.querySelector("li");
    if (!li) throw new Error("no li");
    inner.selectNodeContents(li);
    toggleList(root, inner, "ul");
    expect(root.innerHTML).toBe("One<br>Two<br>Three");
    expect(r).toBeDefined();
  });

  it("numbered lists", () => {
    const { root, range } = setup("[a<br>b]");
    toggleList(root, range, "ol");
    expect(root.innerHTML).toContain("<ol");
    expect(root.querySelectorAll("li")).toHaveLength(2);
  });

  it("won't put a list inside a paragraph (invalid HTML)", () => {
    const { root } = setup("[a]", "p");
    expect(canInsertList(root)).toBe(false);
    expect(canInsertList(document.createElement("td"))).toBe(true);
  });

  it("aligns the block around the selection with inline text-align", () => {
    const { root, range } = setup("<p>[Hi]</p><p>There</p>");
    expect(alignBlock(root, range, "center")).toBe(true);
    expect(root.innerHTML).toBe(
      '<p style="text-align:center;">Hi</p><p>There</p>',
    );
  });

  it("asks the caller to align the component when the text is the root", () => {
    const { root, range } = setup("[Hi]", "p");
    expect(alignBlock(root, range, "right")).toBe(false);
    expect(root.getAttribute("style")).toBeNull();
  });

  it("clears formatting but keeps links and line breaks", () => {
    const { root, range } = setup(
      '[<b>Bold</b> <span style="color:red;">red</span><br><a href="{% unsubscribe_url %}" style="color:red;">u</a>]',
    );
    clearFormatting(root, range);
    expect(root.innerHTML).toBe(
      'Bold red<br><a href="{% unsubscribe_url %}">u</a>',
    );
  });

  it("clearing part of a bold run splits it", () => {
    const { root, range } = setup("<b>ab[cd]ef</b>");
    clearFormatting(root, range);
    expect(root.innerHTML).toBe("<b>ab</b>cd<b>ef</b>");
  });

  it("inserts Liquid variables byte-for-byte", () => {
    const { root, range } = setup("Hi [x],");
    insertTextAt(root, range, '{{ user.firstName | default: "there" }}');
    expect(root.textContent).toBe(
      'Hi {{ user.firstName | default: "there" }},',
    );
    const { root: r2, range: c2 } = setup("Bye [].");
    insertTextAt(r2, c2, "{% unsubscribe_url %}");
    expect(r2.innerHTML).toBe("Bye {% unsubscribe_url %}.");
  });
});
