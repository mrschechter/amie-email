/**
 * @jest-environment jsdom
 */
import {
  closeColorPopover,
  loadRecentColors,
  MAX_RECENT_COLORS,
  normalizeHex,
  openColorPopover,
  RECENT_COLORS_KEY,
  rememberColor,
  rgbToHex,
} from "./visualEmailColor";
import {
  applySavedColor,
  RteLike,
  saveSelection,
  selectionColor,
} from "./visualEmailRte";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] ?? null : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

/** An editable root with "Hi there you" and "there" selected. */
function editable() {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.appendChild(root);
  const text = document.createTextNode("Hi there you");
  root.appendChild(text);
  const range = document.createRange();
  range.setStart(text, 3);
  range.setEnd(text, 8);
  const rte: RteLike = {
    el: root,
    doc: document,
    selection: () => document.getSelection(),
  };
  return { root, range, rte };
}

afterEach(() => closeColorPopover());

describe("HEX validation", () => {
  it.each([
    ["#B76E79", "#B76E79"],
    ["#b76e79", "#B76E79"],
    ["b76e79", "#B76E79"],
    ["#fff", "#FFFFFF"],
    ["  #2d7  ", "#22DD77"],
  ])("accepts %p", (input, out) => {
    expect(normalizeHex(input)).toBe(out);
  });

  it.each([
    "",
    "#",
    "#12",
    "#1234",
    "#12345",
    "#1234567",
    "#GGGGGG",
    "red",
    "rgb(0,0,0)",
  ])("rejects %p", (input) => {
    expect(normalizeHex(input)).toBeNull();
  });

  it("reads computed rgb() colors as HEX", () => {
    expect(rgbToHex("rgb(183, 110, 121)")).toBe("#B76E79");
    expect(rgbToHex("rgba(0, 0, 0, 0)")).toBeNull();
    expect(rgbToHex("#abc")).toBe("#AABBCC");
  });
});

describe("recent colors", () => {
  it("keeps the most recent first, de-duplicated, capped", () => {
    const storage = memoryStorage();
    rememberColor("#111111", storage);
    rememberColor("#222", storage);
    rememberColor("#111111", storage);
    expect(loadRecentColors(storage)).toEqual(["#111111", "#222222"]);
    for (let i = 0; i < 12; i += 1) rememberColor(`#00000${i % 10}`, storage);
    expect(loadRecentColors(storage)).toHaveLength(MAX_RECENT_COLORS);
    expect(JSON.parse(storage.data[RECENT_COLORS_KEY] ?? "[]")[0]).toBe(
      "#000001",
    );
  });

  it("ignores invalid or corrupt history and survives broken storage", () => {
    expect(
      loadRecentColors(memoryStorage({ [RECENT_COLORS_KEY]: "not json" })),
    ).toEqual([]);
    expect(
      loadRecentColors(
        memoryStorage({
          [RECENT_COLORS_KEY]: '["#abc", 3, "nope", "#123456"]',
        }),
      ),
    ).toEqual(["#AABBCC", "#123456"]);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadRecentColors(throwing)).toEqual([]);
    // still usable this session, just not persisted
    expect(rememberColor("#123", throwing)).toEqual(["#112233"]);
    expect(loadRecentColors(throwing)).toEqual([]);
    expect(loadRecentColors(null)).toEqual([]);
  });
});

describe("applying a color to a saved selection", () => {
  it("styles the saved range inline even after the selection moved", () => {
    const { root, range, rte } = editable();
    const saved = saveSelection(root, range);
    // the user clicked elsewhere (e.g. to close a native picker)
    document.getSelection()?.collapse(root, 0);
    expect(applySavedColor(rte, saved, "color", "#B76E79")).toBe(true);
    expect(root.innerHTML).toBe(
      'Hi <span style="color:#B76E79;">there</span> you',
    );
    expect(root.innerHTML).not.toContain("class=");
    expect(document.getSelection()?.toString()).toBe("there");
  });

  it("highlight uses background-color, and clearing removes it", () => {
    const { root, range, rte } = editable();
    applySavedColor(
      rte,
      saveSelection(root, range),
      "background-color",
      "#FFF3A3",
    );
    expect(root.innerHTML).toBe(
      'Hi <span style="background-color:#FFF3A3;">there</span> you',
    );
    const span = root.querySelector("span");
    if (!span) throw new Error("no span");
    const again = document.createRange();
    again.selectNodeContents(span);
    applySavedColor(rte, saveSelection(root, again), "background-color", "");
    expect(root.innerHTML).toBe("Hi there you");
  });

  it("does nothing when that text is no longer being edited", () => {
    const { root, range, rte } = editable();
    const saved = saveSelection(root, range);
    root.remove();
    expect(applySavedColor(rte, saved, "color", "#000000")).toBe(false);
  });

  it("still colors the right words after GrapesJS rebuilt the text", () => {
    const { root, range, rte } = editable();
    const saved = saveSelection(root, range);
    root.innerHTML = "Hi there you"; // same text, new nodes
    expect(applySavedColor(rte, saved, "color", "#B76E79")).toBe(true);
    expect(root.innerHTML).toBe(
      'Hi <span style="color:#B76E79;">there</span> you',
    );
  });

  it("prefills from the selection's current color", () => {
    const { root, rte } = editable();
    root.innerHTML = '<span style="color: rgb(45, 122, 122);">teal</span>';
    const range = document.createRange();
    const span = root.querySelector("span");
    if (!span) throw new Error("no span");
    range.selectNodeContents(span);
    expect(selectionColor(rte, range, "color")).toBe("#2D7A7A");
  });
});

describe("color popover", () => {
  function open(storage = memoryStorage()) {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const applied: (string | null)[] = [];
    const pop = openColorPopover({
      anchor,
      title: "Text color",
      initial: "rgb(62, 55, 51)",
      onApply: (c) => applied.push(c),
      storage,
    });
    const hex = pop.el.querySelector<HTMLInputElement>("input.amie-color-hex");
    if (!hex) throw new Error("no hex field");
    const button = (text: string) => {
      const found = Array.from(pop.el.querySelectorAll("button")).find(
        (b) => b.textContent === text,
      );
      if (!found) throw new Error(`no ${text} button`);
      return found;
    };
    return { pop, hex, applied, button, storage };
  }

  it("opens with the HEX field first, focused and prefilled", () => {
    const { pop, hex } = open();
    expect(pop.el.firstElementChild?.contains(hex)).toBe(true);
    expect(document.activeElement).toBe(hex);
    expect(hex.value).toBe("#3E3733");
  });

  it("Apply validates HEX, applies it and records it in recent colors", () => {
    const { pop, hex, applied, button, storage } = open();
    hex.value = "#12";
    button("Apply").click();
    expect(applied).toEqual([]);
    expect(pop.el.querySelector<HTMLElement>(".amie-color-error")?.hidden).toBe(
      false,
    );
    hex.value = "#b76e79";
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(applied).toEqual(["#B76E79"]);
    expect(document.querySelector(".amie-color-pop")).toBeNull();
    expect(loadRecentColors(storage)).toEqual(["#B76E79"]);
    // the next picker shows it under Recent colors
    const second = open(storage);
    const labels = Array.from(
      second.pop.el.querySelectorAll(".amie-color-label"),
    ).map((l) => l.textContent);
    expect(labels).toEqual(["Recent colors", "Colors"]);
    expect(
      second.pop.el
        .querySelector(".amie-color-grid .amie-color-swatch")
        ?.getAttribute("title"),
    ).toBe("#B76E79");
  });

  it("swatches apply directly; Clear applies null; Escape closes", () => {
    const first = open();
    first.pop.el
      .querySelector<HTMLButtonElement>('.amie-color-swatch[title="#2D7A7A"]')
      ?.click();
    expect(first.applied).toEqual(["#2D7A7A"]);
    const second = open();
    second.button("Clear").click();
    expect(second.applied).toEqual([null]);
    const third = open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".amie-color-pop")).toBeNull();
    expect(third.applied).toEqual([]);
  });
});
