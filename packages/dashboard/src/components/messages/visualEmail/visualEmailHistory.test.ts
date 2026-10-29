/**
 * @jest-environment jsdom
 */
import grapesjs, { Editor } from "grapesjs";

import {
  bodyChangedOutsideVisual,
  DEFAULT_NEW_DESIGN_KIND,
} from "./visualEmailDesign";
import {
  canRedo,
  canUndo,
  CANVAS_COMPONENTS_CONFIG,
  installCanvasAttributeCleanup,
  installTextDragSelect,
  installUndoRedo,
  recordDesign,
  REDO_COMMAND,
  redoVisual,
  textViewAt,
  UNDO_COMMAND,
  undoVisual,
} from "./visualEmailHistory";
import { RTE_BEFORE_CHANGE_EVENT, RTE_CHANGE_EVENT } from "./visualEmailRte";

type Handler = (...args: unknown[]) => unknown;

/** A text component view as GrapesJS attaches it to its element. */
function textView(el: HTMLElement, opts: { editing?: boolean } = {}) {
  const view = {
    el,
    model: { get: (key: string) => (key === "editable" ? true : undefined) },
    rteEnabled: opts.editing ?? false,
    lastContent: el.innerHTML,
    getChildrenContainer: () => el,
    onActive: jest.fn(async () => {
      view.rteEnabled = true;
    }),
    disableEditing: jest.fn(async () => {
      view.rteEnabled = false;
    }),
    syncContent: jest.fn(async () => {}),
  };
  Object.assign(el, { __gjsv: view });
  return view;
}

/**
 * A minimal editor whose design is the HTML of one text block (the model
 * always equals the canvas here, which is what GrapesJS ends up with once
 * text is written to it).
 */
function fakeEditor(block: HTMLElement, view?: ReturnType<typeof textView>) {
  const events: Partial<Record<string, Handler[]>> = {};
  const commands: Record<string, Handler> = {};
  const keymaps: Record<string, Handler> = {};
  const buttons: Record<string, { set: jest.Mock }> = {};
  const added: Record<string, unknown>[] = [];
  const removed: string[] = [];
  const container = document.createElement("div");
  const select = jest.fn();
  const textComponent = view
    ? { getView: () => view, components: () => ({ models: [] }) }
    : undefined;
  const editor = {
    on: (name: string, fn: Handler) => {
      (events[name] ??= []).push(fn);
    },
    onReady: (fn: Handler) => fn(),
    select,
    getEditing: () => (view?.rteEnabled ? { getView: () => view } : null),
    getWrapper: () => ({
      getView: () => ({ el: document.body, getChildrenContainer: () => null }),
      components: () => ({ models: textComponent ? [textComponent] : [] }),
    }),
    getModel: () => ({}),
    getHtml: () => block.innerHTML,
    getCss: () => "",
    getProjectData: () => ({ html: block.innerHTML }),
    loadProjectData: (project: { html: string }) => {
      // eslint-disable-next-line no-param-reassign
      block.innerHTML = project.html;
    },
    getContainer: () => container,
    Canvas: { getDocument: () => document },
    Commands: {
      add: (id: string, fn: Handler) => {
        commands[id] = fn;
      },
    },
    Keymaps: {
      add: (id: string, _keys: string, fn: Handler) => {
        keymaps[id] = fn;
      },
    },
    Panels: {
      addButton: (_panel: string, list: Record<string, unknown>[]) =>
        list.forEach((button) => {
          added.push(button);
          const id = String(button.id);
          buttons[id] = { set: jest.fn() };
          const el = document.createElement("span");
          el.className = "gjs-pn-btn";
          const attrs = button.attributes;
          if (typeof attrs === "object" && attrs && "title" in attrs) {
            el.title = String(attrs.title);
          }
          container.appendChild(el);
        }),
      removeButton: (_panel: string, id: string) => removed.push(id),
      getButton: (_panel: string, id: string) => buttons[id],
    },
  };
  const emit = (name: string, ...args: unknown[]) =>
    events[name]?.forEach((fn) => fn(...args));
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    editor: editor as unknown as Editor,
    commands,
    keymaps,
    added,
    removed,
    container,
    select,
    emit,
  };
}

function keyEvent(target: EventTarget) {
  const ev = new KeyboardEvent("keydown", {
    key: "z",
    ctrlKey: true,
    cancelable: true,
  });
  Object.defineProperty(ev, "target", { value: target });
  return ev;
}

const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function editingBlock(html: string) {
  document.body.innerHTML = `<p>${html}</p><input>`;
  const p = document.querySelector("p");
  if (!p) throw new Error("no p");
  const view = textView(p, { editing: true });
  return { p, view, ...fakeEditor(p, view) };
}

/** What the text toolbar does around each edit (see visualEmailRte). */
function toolbarEdit(p: HTMLElement, html: string) {
  p.dispatchEvent(new Event(RTE_BEFORE_CHANGE_EVENT, { bubbles: true }));
  // eslint-disable-next-line no-param-reassign
  p.innerHTML = html;
  p.dispatchEvent(new Event(RTE_CHANGE_EVENT, { bubbles: true }));
}

describe("new visual emails", () => {
  it("default to the drag-and-drop (MJML) editor; HTML stays a choice", () => {
    expect(DEFAULT_NEW_DESIGN_KIND).toBe("mjml");
  });
});

describe("one undo/redo pair; every toolbar edit is one step", () => {
  it("replaces grapesjs-mjml's undo/redo pair with exactly one pair", () => {
    const { editor, added, removed, commands } = editingBlock("Hi");
    installUndoRedo(editor);
    expect(removed.sort()).toEqual(["redo", "undo"]);
    expect(added.map((b) => b.id)).toEqual(["amie-undo", "amie-redo"]);
    // GrapesJS would stop text editing after the click (default command)
    expect(added.every((b) => b.runDefaultCommand === false)).toBe(true);
    expect(Object.keys(commands).sort()).toEqual(
      [REDO_COMMAND, UNDO_COMMAND].sort(),
    );
  });

  it("toolbar edits made while the text is still being edited undo one by one, and redo", async () => {
    const { p, editor } = editingBlock("Hi");
    installUndoRedo(editor);
    toolbarEdit(p, "<b>Hi</b>");
    toolbarEdit(p, '<b>Hi</b> <span style="font-size:10px;">there</span>');
    expect(canUndo(editor)).toBe(true);
    await undoVisual(editor);
    expect(p.innerHTML).toBe("<b>Hi</b>");
    await undoVisual(editor);
    expect(p.innerHTML).toBe("Hi");
    expect(canRedo(editor)).toBe(true);
    await redoVisual(editor);
    expect(p.innerHTML).toBe("<b>Hi</b>");
    await redoVisual(editor);
    expect(p.innerHTML).toBe(
      '<b>Hi</b> <span style="font-size:10px;">there</span>',
    );
  });

  it("undo stops editing first (GrapesJS ignores undo while editing) and writes typed text", async () => {
    const { p, view, editor } = editingBlock("Hi");
    installUndoRedo(editor);
    p.innerHTML = "Hi there"; // typed, not in the model yet
    await undoVisual(editor);
    expect(view.syncContent).toHaveBeenCalledWith({
      force: true,
      content: "Hi there",
    });
    expect(view.disableEditing).toHaveBeenCalled();
    expect(p.innerHTML).toBe("Hi");
  });

  it("changes that don't change the email are not undo steps", () => {
    const { editor } = editingBlock("Hi");
    installUndoRedo(editor);
    recordDesign(editor);
    recordDesign(editor);
    expect(canRedo(editor)).toBe(false);
    // only "editing" makes undo available (typing may be pending)
    const idle = fakeEditor(document.createElement("p"));
    installUndoRedo(idle.editor);
    recordDesign(idle.editor);
    expect(canUndo(idle.editor)).toBe(false);
  });

  it("an undo tells the editor the email changed (so it can be saved)", async () => {
    const { p, editor } = editingBlock("Hi");
    installUndoRedo(editor);
    toolbarEdit(p, "<b>Hi</b>");
    const changed = jest.fn();
    document.addEventListener(RTE_CHANGE_EVENT, changed);
    await undoVisual(editor);
    document.removeEventListener(RTE_CHANGE_EVENT, changed);
    expect(changed).toHaveBeenCalled();
  });

  it("pressing the buttons doesn't end text editing (GrapesJS ends it on any outside mousedown)", () => {
    const { editor, container } = editingBlock("Hi");
    installUndoRedo(editor);
    const outside = jest.fn();
    document.addEventListener("mousedown", outside);
    container.querySelectorAll(".gjs-pn-btn").forEach((btn) => {
      btn.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    document.removeEventListener("mousedown", outside);
    expect(container.querySelectorAll(".gjs-pn-btn")).toHaveLength(2);
    expect(outside).not.toHaveBeenCalled();
  });

  it("Ctrl+Z: browser undo while typing, ours after a toolbar edit, never in a form field", async () => {
    const { p, editor, keymaps, emit } = editingBlock("Hi");
    installUndoRedo(editor);
    const shortcut = keymaps["core:undo"];
    const input = document.querySelector("input");
    if (!shortcut || !input) throw new Error("bad fixture");

    const inField = keyEvent(input);
    shortcut(editor, 0, { event: inField });
    expect(inField.defaultPrevented).toBe(false);

    emit("rte:enable");
    const typing = keyEvent(p);
    shortcut(editor, 0, { event: typing });
    expect(typing.defaultPrevented).toBe(false); // the browser undoes typing

    toolbarEdit(p, "<b>Hi</b>");
    const afterToolbar = keyEvent(p);
    shortcut(editor, 0, { event: afterToolbar });
    expect(afterToolbar.defaultPrevented).toBe(true);
    await flush();
    expect(p.innerHTML).toBe("Hi");
  });
});

/**
 * Nicholate 2026-10-28: drag-selecting a line sometimes dragged the line or
 * block somewhere else, or it vanished. GrapesJS made components natively
 * draggable and moves the component a native drag starts on.
 */
describe("press-and-drag on text selects instead of moving components", () => {
  it("the canvas has no natively draggable components", () => {
    expect(CANVAS_COMPONENTS_CONFIG).toEqual({ draggableComponents: false });
  });

  function block() {
    document.body.innerHTML =
      '<table draggable="true"><tr draggable="true"><td draggable="true">Read about <b draggable="true">tamarind</b> today. <a href="https://tryamie.com">Privacy</a></td></tr></table>';
    const td = document.querySelector("td");
    const b = document.querySelector("b");
    const a = document.querySelector("a");
    if (!td || !b || !a) throw new Error("bad fixture");
    return { td, b, a };
  }

  /** jsdom has no layout: x = offset in the first text node, x ≥ 100 in <b>. */
  function fakeCaret(td: HTMLElement, b: HTMLElement) {
    Object.assign(document, {
      caretRangeFromPoint: (x: number) => {
        const r = document.createRange();
        const node = x >= 100 ? b.firstChild : td.firstChild;
        if (!node) return null;
        r.setStart(node, x >= 100 ? x - 100 : x);
        r.collapse(true);
        return r;
      },
    });
  }

  const installed: (() => void)[] = [];
  const install = (editor: Editor) =>
    installed.push(installTextDragSelect(editor));
  afterEach(() => {
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    installed.splice(0).forEach((uninstall) => uninstall());
  });

  it("finds the outermost text block for a word inside it", () => {
    const { td, b } = block();
    textView(td);
    textView(b); // nested text component (GrapesJS parses <b> as text)
    expect(textViewAt(b.firstChild)?.el).toBe(td);
    expect(textViewAt(document.body)).toBeNull();
  });

  it("a native drag that starts in text never reaches GrapesJS (which would move it)", () => {
    const { td, b } = block();
    textView(td);
    const { editor } = fakeEditor(td);
    install(editor);
    const moved = jest.fn();
    b.addEventListener("dragstart", moved); // GrapesJS's ComponentView handler
    const ev = new Event("dragstart", { bubbles: true, cancelable: true });
    b.dispatchEvent(ev);
    expect(moved).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("drags outside text blocks are left alone", () => {
    document.body.innerHTML = '<div><img draggable="true"></div>';
    const img = document.querySelector("img");
    if (!img) throw new Error("no img");
    const { editor } = fakeEditor(document.body);
    install(editor);
    const moved = jest.fn();
    img.addEventListener("dragstart", moved);
    img.dispatchEvent(
      new Event("dragstart", { bubbles: true, cancelable: true }),
    );
    expect(moved).toHaveBeenCalled();
  });

  it("the pressed text and its parents aren't draggable during the press, and are again after", async () => {
    const { td, b } = block();
    textView(td);
    fakeCaret(td, b);
    const { editor } = fakeEditor(td);
    install(editor);
    b.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 101 }),
    );
    expect(b.draggable).toBe(false);
    expect(td.draggable).toBe(false);
    expect(document.querySelector("table")?.draggable).toBe(false);
    b.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, detail: 1, clientX: 101 }),
    );
    await flush();
    expect(b.draggable).toBe(true);
    expect(td.draggable).toBe(true);
  });

  it("dragging over text that isn't being edited selects it and starts editing with that selection", async () => {
    const { td, b } = block();
    const view = textView(td);
    fakeCaret(td, b);
    const { editor, select } = fakeEditor(td);
    install(editor);
    td.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 5 }),
    );
    td.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: 108 }),
    );
    expect(document.getSelection()?.toString()).toBe("about tamarind");
    b.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, detail: 1, clientX: 108 }),
    );
    document.getSelection()?.removeAllRanges(); // GrapesJS's click handling
    await flush();
    await flush();
    expect(select).toHaveBeenCalledWith(view.model);
    expect(view.onActive).toHaveBeenCalledTimes(1);
    expect(document.getSelection()?.toString()).toBe("about tamarind");
  });

  it("a plain click doesn't start editing (GrapesJS selects the block)", async () => {
    const { td, b } = block();
    const view = textView(td);
    fakeCaret(td, b);
    const { editor } = fakeEditor(td);
    install(editor);
    td.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 5 }),
    );
    td.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, detail: 1, clientX: 5 }),
    );
    await flush();
    expect(view.onActive).not.toHaveBeenCalled();
  });
});

/**
 * Text is written to the model from the canvas DOM, which carries GrapesJS's
 * `draggable` and `id` on every element. When the same block was written
 * twice (#64's dialog write-back, then editing stopping), they ended up in
 * the saved email.
 */
describe("canvas-only attributes never reach the saved email", () => {
  const editors: Editor[] = [];
  afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

  function headless(html: string) {
    const editor = grapesjs.init({ headless: true, storageManager: false });
    editors.push(editor);
    editor.setComponents(html);
    installCanvasAttributeCleanup(editor);
    // what GrapesJS emits once content is loaded (collects the email's ids)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    (editor.trigger as (event: string) => void).call(editor, "load");
    return editor;
  }

  it("a block written twice from canvas markup keeps only the email's own ids", () => {
    const editor = headless(
      '<p id="footer">About us. <a href="https://tryamie.com/privacy">Privacy</a></p>',
    );
    const p = editor.getWrapper()?.components().at(0);
    if (!p) throw new Error("no p");
    const canvas =
      'About us. <a id="ilj25" data-gjs-type="link" draggable="true" href="https://tryamie.com/privacy">Privacy</a>';
    p.components().resetFromString(canvas);
    p.components().resetFromString(canvas);
    const html = editor.getHtml();
    expect(html).not.toMatch(/draggable|ilj25|data-gjs/);
    expect(html).toContain('id="footer"');
    expect(html).toContain('<a href="https://tryamie.com/privacy">Privacy</a>');
  });
});

/**
 * Nicholate: deleting `border-top` from an MJML visual email in the Code tab
 * didn't stick; the next visual edit regenerated the MJML from the editor's
 * saved project. The editor now opens the changed MJML instead.
 */
describe("Code tab edits of an MJML visual email", () => {
  const design = {
    version: 1 as const,
    editor: "grapesjs-mjml" as const,
    project: {},
    mjml: '<mjml><mj-body><mj-section border-top="1px solid #F2EBE2"></mj-section></mj-body></mjml>',
    updatedAt: "2026-10-29T00:00:00.000Z",
  };

  it("are detected (the body no longer matches what the editor saved)", () => {
    expect(
      bodyChangedOutsideVisual({
        body: "<mjml><mj-body><mj-section></mj-section></mj-body></mjml>",
        visualDesign: design,
      }),
    ).toBe(true);
    expect(
      bodyChangedOutsideVisual({ body: design.mjml, visualDesign: design }),
    ).toBe(false);
  });

  it("don't apply to HTML-mode designs or non-MJML bodies", () => {
    expect(
      bodyChangedOutsideVisual({
        body: "<html><body>x</body></html>",
        visualDesign: design,
      }),
    ).toBe(false);
    expect(
      bodyChangedOutsideVisual({
        body: "<mjml><mj-body></mj-body></mjml>",
        visualDesign: { ...design, editor: "grapesjs-html" },
      }),
    ).toBe(false);
    expect(
      bodyChangedOutsideVisual({ body: design.mjml, visualDesign: null }),
    ).toBe(false);
  });
});
