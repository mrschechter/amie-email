/**
 * Undo/redo and text selection in the visual editor canvas (MJML and HTML).
 *
 * - One undo/redo pair (the canvas toolbar buttons and Ctrl/Cmd+Z,
 *   Shift+Z, Ctrl+Y) over snapshots of the design: every toolbar edit
 *   (bold, link, color, size …) is one step, also while the text is still
 *   being edited. GrapesJS's own undo ignored edits while text was being
 *   edited and couldn't always revert text, so it "sometimes did nothing".
 * - Press-and-drag on text selects the text. GrapesJS made components
 *   natively draggable, so a drag that started on text moved the word, line
 *   or whole block somewhere else (or dropped it) instead of selecting.
 * - Editor-only attributes GrapesJS writes into the canvas don't end up in
 *   the saved email.
 */
import type { Component, Editor } from "grapesjs";

import {
  clampToRoot,
  commitIfDirty,
  restoreSelection,
  RTE_BEFORE_CHANGE_EVENT,
  RTE_CHANGE_EVENT,
  SavedSelection,
  saveSelection,
} from "./visualEmailRte";

/** Per editor: a toolbar edit happened in the current text-editing session. */
const toolbarEdited = new WeakMap<Editor, boolean>();

/**
 * GrapesJS component settings for the canvas: no native dragging of
 * components. A press-and-drag anywhere in the email (on text or in a cell's
 * padding) moved the block under the mouse — rows, paragraphs, words —
 * instead of selecting text. Blocks still move with the move handle on the
 * selected block's toolbar, and in the Layers panel.
 */
export const CANVAS_COMPONENTS_CONFIG = { draggableComponents: false };

export const UNDO_COMMAND = "amie:undo";
export const REDO_COMMAND = "amie:redo";

interface TextView {
  el: HTMLElement;
  model: Component;
  rteEnabled?: boolean;
  getChildrenContainer: () => HTMLElement;
  onActive: (ev?: Event) => Promise<void> | void;
  disableEditing?: () => Promise<void> | void;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "nodeType" in value;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  return isNode(value) && value.nodeType === 1;
}

/** The GrapesJS view GrapesJS attaches to a canvas element. */
function viewOf(node: unknown): unknown {
  return typeof node === "object" && node !== null
    ? Reflect.get(node, "__gjsv")
    : undefined;
}

function isTextView(view: unknown): view is TextView {
  return (
    typeof view === "object" &&
    view !== null &&
    // ComponentTextView (`rteEnabled` only exists once editing has started)
    "onActive" in view &&
    typeof view.onActive === "function" &&
    "disableEditing" in view &&
    typeof view.disableEditing === "function" &&
    "getChildrenContainer" in view
  );
}

/** The editable text block (outermost text component) containing `node`. */
export function textViewAt(node: Node | null): TextView | null {
  let found: TextView | null = null;
  for (let n: Node | null = node; n; n = n.parentNode) {
    const view = viewOf(n);
    if (isTextView(view) && view.model.get("editable") !== false) found = view;
  }
  return found;
}

/** Stop editing text (writing it to the model) so GrapesJS undo can run. */
export async function stopEditing(editor: Editor): Promise<void> {
  const view: unknown = editor.getEditing()?.getView();
  if (!isTextView(view) || !view.rteEnabled) return;
  commitIfDirty(editor, view.getChildrenContainer());
  await view.disableEditing?.();
}

/**
 * Write text that's being edited to the model if it changed (what Save does
 * first in HTML mode). Writing unchanged text would add an undo step that
 * does nothing.
 */
export function syncEditingText(editor: Editor): void {
  const view: unknown = editor.getEditing()?.getView();
  if (isTextView(view) && view.rteEnabled) {
    commitIfDirty(editor, view.getChildrenContainer());
  }
}

/**
 * The email's history as snapshots of the whole design.
 *
 * GrapesJS's UndoManager couldn't be trusted for text: it records a text
 * block being written from the canvas as a reset of its parts, and undoing
 * that did nothing when parts had been split or re-created (whole-block
 * formatting over Mautic-style spans), or undid more than one action at a
 * time. A snapshot is taken after every change to the design (typing counts
 * once editing of that block stops); undo/redo load the previous/next one.
 */
interface DesignSnapshot {
  /** project data, to load */
  project: string;
  /** what the email is (HTML + CSS): equal keys are the same design */
  key: string;
}

interface DesignHistory {
  current: DesignSnapshot | null;
  undo: DesignSnapshot[];
  redo: DesignSnapshot[];
  pending: boolean;
}

const HISTORY_LIMIT = 100;
const histories = new WeakMap<Editor, DesignHistory>();

function historyOf(editor: Editor): DesignHistory {
  let history = histories.get(editor);
  if (!history) {
    history = { current: null, undo: [], redo: [], pending: false };
    histories.set(editor, history);
  }
  return history;
}

interface Storable {
  store: (inner: number) => Record<string, unknown>;
}

function isStorable(value: unknown): value is Storable {
  return (
    typeof value === "object" &&
    value !== null &&
    "store" in value &&
    typeof value.store === "function"
  );
}

/**
 * The design as JSON. `getProjectData()` also re-writes text that is being
 * edited — asynchronously, from the text as it is right now — which would
 * undo a toolbar edit made right after; while editing, the modules are read
 * directly (the text was written synchronously just before).
 */
function captureProject(editor: Editor): string {
  const storables: unknown = Reflect.get(editor.getModel(), "storables");
  if (
    editor.getEditing() &&
    Array.isArray(storables) &&
    storables.every(isStorable)
  ) {
    let project: Record<string, unknown> = {};
    storables.forEach((m) => {
      project = { ...project, ...m.store(1) };
    });
    return JSON.stringify(project);
  }
  return JSON.stringify(editor.getProjectData());
}

function snapshot(editor: Editor): DesignSnapshot {
  return {
    project: captureProject(editor),
    key: editor.getHtml() + editor.getCss(),
  };
}

/**
 * Record the design as it is now, if the email changed since the last
 * snapshot. Changes that don't change the email (editor-only attributes,
 * re-writing the same text) don't become undo steps that "do nothing".
 */
export function recordDesign(editor: Editor): void {
  const history = historyOf(editor);
  const next = snapshot(editor);
  const { current } = history;
  if (current && next.key !== current.key) {
    history.undo = [...history.undo, current].slice(-HISTORY_LIMIT);
    history.redo = [];
  }
  history.current = next;
}

/** Tell the editor UI the design changed (enables Save / autosaves). */
function markChanged(editor: Editor): void {
  const doc = editor.Canvas.getDocument();
  const EventCtor = doc?.defaultView?.Event ?? Event;
  doc?.body.dispatchEvent(new EventCtor(RTE_CHANGE_EVENT, { bubbles: true }));
}

async function step(editor: Editor, direction: "undo" | "redo") {
  await stopEditing(editor);
  const history = historyOf(editor);
  recordDesign(editor); // text written when editing stopped
  const from = direction === "undo" ? history.undo : history.redo;
  const target = from.pop();
  if (!target || history.current === null) return;
  (direction === "undo" ? history.redo : history.undo).push(history.current);
  editor.loadProjectData(JSON.parse(target.project));
  history.current = snapshot(editor);
  markChanged(editor);
}

export function canUndo(editor: Editor): boolean {
  return historyOf(editor).undo.length > 0 || Boolean(editor.getEditing());
}

export function canRedo(editor: Editor): boolean {
  return historyOf(editor).redo.length > 0;
}

export async function undoVisual(editor: Editor): Promise<void> {
  await step(editor, "undo");
}

export async function redoVisual(editor: Editor): Promise<void> {
  await step(editor, "redo");
}

const UNDO_ICON = `<svg style="display:block;max-width:22px" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 13.5C20 17.09 17.09 20 13.5 20H6V18H13.5C16 18 18 16 18 13.5S16 9 13.5 9H7.83L10.91 12.09L9.5 13.5L4 8L9.5 2.5L10.92 3.91L7.83 7H13.5C17.09 7 20 9.91 20 13.5Z"/></svg>`;
const REDO_ICON = `<svg style="display:block;max-width:22px" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.5 18H18V20H10.5C6.91 20 4 17.09 4 13.5S6.91 7 10.5 7H16.17L13.08 3.91L14.5 2.5L20 8L14.5 13.5L13.09 12.09L16.17 9H10.5C8 9 6 11 6 13.5S8 18 10.5 18Z"/></svg>`;

export const HISTORY_CSS = `
.gjs-pn-btn.amie-history-empty { opacity: 0.35; }
`;

function isFormField(target: EventTarget | null): boolean {
  return isHtmlElement(target)
    ? Boolean(target.closest("input, textarea, select"))
    : false;
}

/**
 * The editor's only undo/redo controls: two canvas toolbar buttons and the
 * keyboard shortcuts. While text is being typed (no toolbar edit yet), the
 * shortcuts keep the browser's own typing undo.
 */
export function installUndoRedo(editor: Editor): void {
  editor.Commands.add(UNDO_COMMAND, () => {
    void undoVisual(editor);
  });
  editor.Commands.add(REDO_COMMAND, () => {
    void redoVisual(editor);
  });
  // grapesjs-mjml adds its own undo/redo pair (GrapesJS's core:undo, which
  // does nothing while text is being edited): MJML mode showed two pairs.
  ["undo", "redo"].forEach((id) => editor.Panels.removeButton("options", id));
  editor.Panels.addButton("options", [
    {
      id: "amie-undo",
      label: UNDO_ICON,
      command: UNDO_COMMAND,
      togglable: false,
      // GrapesJS re-runs its default (select) command after a panel button,
      // which stops text editing before undo could step back inside it
      runDefaultCommand: false,
      attributes: { title: "Undo (Ctrl/Cmd+Z)" },
    },
    {
      id: "amie-redo",
      label: REDO_ICON,
      command: REDO_COMMAND,
      togglable: false,
      runDefaultCommand: false,
      attributes: { title: "Redo (Ctrl/Cmd+Shift+Z)" },
    },
  ]);

  // Dim a button with nothing to undo/redo (still clickable: typing that
  // isn't in the model yet is undoable too).
  const refresh = () => {
    editor.Panels.getButton("options", "amie-undo")?.set(
      "className",
      canUndo(editor) ? "" : "amie-history-empty",
    );
    editor.Panels.getButton("options", "amie-redo")?.set(
      "className",
      canRedo(editor) ? "" : "amie-history-empty",
    );
  };
  const history = historyOf(editor);
  editor.onReady(() => {
    recordDesign(editor);
    refresh();
  });
  // one snapshot per burst of changes (e.g. a block drop adds several)
  editor.on("update", () => {
    if (history.pending) return;
    history.pending = true;
    setTimeout(() => {
      history.pending = false;
      recordDesign(editor);
      refresh();
    }, 0);
  });
  ["update", "undo", "redo", "rte:enable", "rte:disable", "load"].forEach(
    (event) => editor.on(event, refresh),
  );

  // GrapesJS stops editing text on any mousedown outside it (the text
  // toolbar opts out the same way), which would end the session before undo
  // could step back through its toolbar edits one by one.
  const keepFocus = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  editor.onReady(() => {
    editor
      .getContainer()
      ?.querySelectorAll<HTMLElement>(
        '.gjs-pn-btn[title^="Undo"], .gjs-pn-btn[title^="Redo"]',
      )
      .forEach((btn) => {
        btn.removeEventListener("mousedown", keepFocus);
        btn.addEventListener("mousedown", keepFocus);
      });
  });

  // Before every toolbar edit of the text being edited, write what was typed
  // so far to the model and record the design: each toolbar edit is one undo
  // step. After one, the browser's typing undo no longer knows what the text
  // looks like, so the shortcuts use ours.
  editor.on("rte:enable", () => toolbarEdited.set(editor, false));
  const onBeforeChange = (ev: Event) => {
    const view: unknown = editor.getEditing()?.getView();
    if (!isTextView(view) || ev.target !== view.getChildrenContainer()) return;
    commitIfDirty(editor, view.getChildrenContainer());
    recordDesign(editor);
    toolbarEdited.set(editor, true);
  };
  const onToolbarEdit = () => refresh();
  const listenCanvas = () => {
    const doc = editor.Canvas.getDocument();
    doc?.removeEventListener(RTE_BEFORE_CHANGE_EVENT, onBeforeChange);
    doc?.addEventListener(RTE_BEFORE_CHANGE_EVENT, onBeforeChange);
    doc?.removeEventListener(RTE_CHANGE_EVENT, onToolbarEdit);
    doc?.addEventListener(RTE_CHANGE_EVENT, onToolbarEdit);
  };
  editor.on("canvas:frame:load", listenCanvas);
  editor.onReady(listenCanvas);

  const shortcut =
    (run: (e: Editor) => Promise<void>) =>
    (_ed: Editor, _sender: unknown, opts: { event?: KeyboardEvent } = {}) => {
      const ev = opts.event;
      if (ev && isFormField(ev.target)) return; // undo typing in a field
      if (editor.getEditing() && !toolbarEdited.get(editor)) return; // typing
      ev?.preventDefault();
      void run(editor);
    };
  editor.Keymaps.add("core:undo", "⌘+z, ctrl+z", shortcut(undoVisual), {
    force: true,
  });
  editor.Keymaps.add(
    "core:redo",
    "⌘+shift+z, ctrl+shift+z, ctrl+y",
    shortcut(redoVisual),
    { force: true },
  );
}

/**
 * Press-and-drag on text selects text, from any state (not selected, selected,
 * or already editing). When the drag ends with text selected in a block that
 * isn't being edited, editing starts with that selection, so the text
 * toolbar applies to it.
 */
export function installTextDragSelect(editor: Editor): () => void {
  let undraggable: HTMLElement[] = [];
  let pressed: TextView | null = null;
  // Drags on text that isn't being edited, and drags that start in a text
  // block's padding (e.g. to select the whole footer), are turned into a
  // selection by hand: Chrome never selects from a link, and in blocks that
  // aren't editable yet it stopped extending the selection at nested
  // elements.
  let manual: { container: HTMLElement; anchor: Range } | null = null;
  let downAt: { x: number; y: number } | null = null;
  const restoreDraggable = () => {
    undraggable.forEach((el) => {
      // eslint-disable-next-line no-param-reassign
      el.draggable = true;
    });
    undraggable = [];
  };

  const caretAt = (doc: Document, ev: MouseEvent): Range | null =>
    typeof doc.caretRangeFromPoint === "function"
      ? doc.caretRangeFromPoint(ev.clientX, ev.clientY)
      : null;

  /** The text position under the mouse, or the nearest end of the text. */
  const pointIn = (container: HTMLElement, ev: MouseEvent): Range => {
    const doc = container.ownerDocument;
    const caret = caretAt(doc, ev);
    if (caret && container.contains(caret.startContainer)) return caret;
    const rect = container.getBoundingClientRect();
    const before =
      ev.clientY < rect.top ||
      (ev.clientY <= rect.bottom && ev.clientX < rect.left);
    const point = doc.createRange();
    point.setStart(container, before ? 0 : container.childNodes.length);
    point.collapse(true);
    return point;
  };

  const extendManual = (ev: MouseEvent) => {
    if (!manual) return;
    const focus = pointIn(manual.container, ev);
    manual.container.ownerDocument
      .getSelection()
      ?.setBaseAndExtent(
        manual.anchor.startContainer,
        manual.anchor.startOffset,
        focus.startContainer,
        focus.startOffset,
      );
  };

  const onDown = (ev: MouseEvent) => {
    restoreDraggable();
    pressed = null;
    manual = null;
    downAt = { x: ev.clientX, y: ev.clientY };
    if (ev.button !== 0) return;
    const target = isNode(ev.target) ? ev.target : null;
    const view = textViewAt(target);
    if (!view) return;
    pressed = view;
    const container = view.getChildrenContainer();
    const inPadding = Boolean(target) && !container.contains(target);
    if (ev.detail <= 1 && (inPadding || !view.rteEnabled)) {
      manual = { container, anchor: pointIn(container, ev) };
      // Chrome would start its own (empty) selection outside the text
      if (inPadding) ev.preventDefault();
    }
    // Chrome decides "drag or select" from `draggable` when the button goes
    // down, so switch it off for the pressed element and its parents.
    for (
      let el: unknown = target;
      isHtmlElement(el) && el.tagName !== "BODY";
      el = el.parentNode
    ) {
      if (el.draggable) {
        el.draggable = false;
        undraggable.push(el);
      }
    }
  };

  /** The drag's selection in `view`'s text, read when the button goes up. */
  const selectionIn = (view: TextView): SavedSelection | null => {
    if (view.rteEnabled) return null;
    const container = view.getChildrenContainer();
    const sel = container.ownerDocument.getSelection();
    if (!sel?.rangeCount) return null;
    const range = clampToRoot(container, sel.getRangeAt(0));
    if (!range || range.collapsed) return null;
    return saveSelection(container, range);
  };

  const activate = async (view: TextView, saved: SavedSelection) => {
    // selecting the block clears the page selection; it's put back below
    editor.select(view.model);
    await view.onActive();
    if (!view.rteEnabled) return;
    const el = view.getChildrenContainer();
    const sel = el.ownerDocument.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(restoreSelection(el, saved));
  };

  const onMove = (ev: MouseEvent) => {
    // primary button held
    if (!manual || ev.buttons % 2 !== 1) return;
    extendManual(ev);
    ev.preventDefault();
  };

  // A native drag that starts in a text block makes GrapesJS move the
  // component under it (ComponentView.handleDragStart runs "tlb-move"): the
  // link, word or whole block went wherever the mouse was released, or
  // vanished off-screen. Stop it before it reaches the component; blocks
  // still move with the toolbar's move handle and the Layers panel.
  const onDragStart = (ev: DragEvent) => {
    const target = isNode(ev.target) ? ev.target : null;
    const el = isHtmlElement(target) ? target : target?.parentNode ?? null;
    if (!textViewAt(el)) return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  /**
   * A drag that started outside any text (e.g. in the padding of a cell
   * holding several paragraphs) and selected text: the text block where
   * the selection starts.
   */
  const viewOfSelection = (doc: Document): TextView | null => {
    const sel = doc.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const direct = textViewAt(range.startContainer);
    if (direct) return direct;
    const walker = doc.createTreeWalker(
      range.commonAncestorContainer,
      4 /* text */,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent?.trim() && range.intersectsNode(node)) {
        const view = textViewAt(node);
        if (view) return view;
      }
    }
    return null;
  };

  const onUp = (ev: MouseEvent) => {
    const dragged =
      Boolean(downAt) &&
      Math.hypot(ev.clientX - (downAt?.x ?? 0), ev.clientY - (downAt?.y ?? 0)) >
        4;
    const doc = isNode(ev.target) ? ev.target.ownerDocument : null;
    const view = pressed ?? (dragged && doc ? viewOfSelection(doc) : null);
    pressed = null;
    if (manual) extendManual(ev);
    manual = null;
    // double/triple clicks: GrapesJS starts editing itself
    const saved = view && ev.detail <= 1 ? selectionIn(view) : null;
    // after the click handlers (GrapesJS selects the block on click)
    setTimeout(() => {
      restoreDraggable();
      if (view && saved && !view.rteEnabled) void activate(view, saved);
    }, 0);
  };

  let listening: Document | null = null;
  const unlisten = () => {
    const doc = listening;
    if (!doc) return;
    doc.removeEventListener("mousedown", onDown, true);
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("mouseup", onUp, true);
    doc.removeEventListener("dragstart", onDragStart, true);
    listening = null;
  };
  const listen = () => {
    const doc = editor.Canvas.getDocument();
    if (!doc) return;
    unlisten();
    doc.addEventListener("dragstart", onDragStart, true);
    doc.addEventListener("mousedown", onDown, true);
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("mouseup", onUp, true);
    listening = doc;
  };
  editor.on("canvas:frame:load", listen);
  editor.onReady(listen);
  return unlisten;
}

/** GrapesJS's Selector.TYPE_ID */
const ID_SELECTOR = 2;

/**
 * Attribute changes that are clean-up, not edits: not undo steps or changes.
 * `idUpdate` lets the id attribute go (GrapesJS otherwise puts it back); the
 * component keeps its internal id.
 */
const QUIET = { avoidStore: true, noUndo: true, idUpdate: true };

/**
 * Text is written to the model from the canvas DOM, where GrapesJS puts a
 * `draggable` and an `id` on every element. GrapesJS drops them only for
 * elements it still knows by id; when it doesn't (a block written more than
 * once, e.g. a toolbar edit and then editing stopping), they ended up in the
 * saved email (`<a id="ilj25" draggable="true" …>`). Remove them again,
 * keeping ids the email itself has.
 */
export function installCanvasAttributeCleanup(editor: Editor): void {
  const ownIds = new Set<string>();
  const collect = (component: Component) => {
    const { id } = component.getAttributes();
    if (typeof id === "string" && id) ownIds.add(id);
    component.components().forEach(collect);
  };
  const clean = (component: Component) => {
    const attrs: Record<string, unknown> = component.get("attributes") ?? {};
    const drop: string[] = [];
    if ("draggable" in attrs) drop.push("draggable");
    if (typeof attrs.id === "string" && attrs.id && !ownIds.has(attrs.id)) {
      drop.push("id");
    }
    if (drop.length) component.removeAttributes(drop, QUIET);
    // GrapesJS also writes an id for any element whose id has a selector;
    // the canvas id created one without any CSS rule behind it.
    const id = component.getId();
    if (!ownIds.has(id) && !editor.Css.getRule(`#${id}`)) {
      const selector = editor.Selectors.get(id, ID_SELECTOR);
      if (selector) editor.Selectors.remove(selector);
    }
    component.components().forEach(clean);
  };
  const collectAll = () => {
    ownIds.clear();
    const wrapper = editor.getWrapper();
    if (wrapper) collect(wrapper);
  };
  editor.onReady(collectAll);
  editor.on("load", collectAll);
  editor.on("project:load", collectAll);
  // Styles of elements that no longer exist (HTML mode keeps each element's
  // style as an #id rule; GrapesJS keeps those rules when text is rewritten,
  // so undoing a format left its rule in the saved email).
  const dropOrphanRules = () => {
    const wrapper = editor.getWrapper();
    if (!wrapper) return;
    const live = new Set<string>();
    const walk = (component: Component) => {
      live.add(component.getId());
      component.components().forEach(walk);
    };
    walk(wrapper);
    const orphans = editor.Css.getRules().filter((rule) => {
      const selectors = rule.getSelectors();
      if (selectors.length !== 1 || rule.get("state") || rule.get("mediaText"))
        return false;
      const selector = selectors.at(0);
      return (
        selector.get("type") === ID_SELECTOR &&
        !live.has(String(selector.get("name")))
      );
    });
    orphans.forEach((rule) => editor.Css.remove(rule));
  };
  editor.on("component:content", (parent: Component | undefined) => {
    parent?.components().forEach(clean);
    dropOrphanRules();
  });
}
