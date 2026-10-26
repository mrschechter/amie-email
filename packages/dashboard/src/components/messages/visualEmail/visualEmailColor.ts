/**
 * Mautic-style color picker for the rich text toolbar: a HEX field first,
 * recent colors, a swatch grid, Apply and Clear.
 *
 * Why not `<input type="color">`: the native picker applies on `change`,
 * which Chrome fires when the picker closes — usually because the user
 * clicked back into the canvas, which has already moved or collapsed the
 * text selection, so the color "refuses to take effect". Here the selection
 * range is saved when the picker opens and restored when a color is applied.
 */

export const RECENT_COLORS_KEY = "amie-visual-email-recent-colors";
export const MAX_RECENT_COLORS = 8;

export const COLOR_SWATCHES = [
  "#000000",
  "#3E3733",
  "#555555",
  "#A39B93",
  "#E3DAD1",
  "#FFFFFF",
  "#121A33",
  "#2D7A7A",
  "#B76E79",
  "#FBF7F2",
  "#FFF6F2",
  "#FFF3A3",
  "#D0021B",
  "#F5A623",
  "#7ED321",
  "#4A90E2",
];

/** `#RGB` / `#RRGGBB` (with or without `#`) → `#RRGGBB`, else null. */
export function normalizeHex(input: string): string | null {
  const value = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .split("")
      .map((c) => c + c)
      .join("")}`.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`.toUpperCase();
  return null;
}

/** `rgb(…)` / `rgba(…)` (as from getComputedStyle) → `#RRGGBB`. */
export function rgbToHex(rgb: string): string | null {
  const m =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      rgb.trim(),
    );
  if (!m) return normalizeHex(rgb);
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // transparent
  return `#${[m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Recently used colors, most recent first (per browser; empty if storage is unavailable). */
export function loadRecentColors(
  storage: StorageLike | null = defaultStorage(),
): string[] {
  try {
    const raw = storage?.getItem(RECENT_COLORS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => (typeof c === "string" ? normalizeHex(c) : null))
      .filter((c): c is string => c !== null)
      .slice(0, MAX_RECENT_COLORS);
  } catch {
    return [];
  }
}

export function rememberColor(
  color: string,
  storage: StorageLike | null = defaultStorage(),
): string[] {
  const hex = normalizeHex(color);
  const current = loadRecentColors(storage);
  if (!hex) return current;
  const next = [hex, ...current.filter((c) => c !== hex)].slice(
    0,
    MAX_RECENT_COLORS,
  );
  try {
    storage?.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    // quota/private mode: the picker still works, just without history
  }
  return next;
}

export const COLOR_POPOVER_CSS = `
.amie-color-pop { position: fixed; z-index: 100000; width: 232px; padding: 10px; background: #fff; color: #333; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.25); font: 12px/1.4 Helvetica, Arial, sans-serif; }
.amie-color-pop .amie-color-row { display: flex; gap: 6px; align-items: center; }
.amie-color-pop .amie-color-preview { width: 26px; height: 26px; border-radius: 4px; border: 1px solid #ccc; flex: none; }
.amie-color-pop input.amie-color-hex { flex: 1; min-width: 0; height: 26px; padding: 0 6px; border: 1px solid #bbb; border-radius: 4px; font: 13px monospace; text-transform: uppercase; color: #222; background: #fff; }
.amie-color-pop input.amie-color-hex[aria-invalid=true] { border-color: #D0021B; }
.amie-color-pop .amie-color-error { color: #D0021B; margin-top: 4px; }
.amie-color-pop .amie-color-label { margin: 8px 0 4px; color: #777; }
.amie-color-pop .amie-color-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.amie-color-pop .amie-color-swatch { width: 22px; height: 22px; padding: 0; border: 1px solid rgba(0,0,0,.2); border-radius: 3px; cursor: pointer; }
.amie-color-pop .amie-color-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
.amie-color-pop button.amie-color-btn { height: 26px; padding: 0 10px; border: 1px solid #bbb; border-radius: 4px; background: #f5f5f5; color: #222; cursor: pointer; }
.amie-color-pop button.amie-color-btn.primary { background: #2D7A7A; border-color: #2D7A7A; color: #fff; }
`;

export interface ColorPopoverOptions {
  anchor: HTMLElement;
  title: string;
  /** Prefill: the selected text's current color (HEX or rgb()). */
  initial: string | null;
  /** A color (`#RRGGBB`) to apply, or null to clear the property. */
  onApply: (color: string | null) => void;
  storage?: StorageLike | null;
  /** Extra documents (the canvas iframe) where a mousedown closes the picker. */
  closeOn?: Document[];
}

export interface ColorPopover {
  el: HTMLElement;
  close: () => void;
}

let openPopover: ColorPopover | null = null;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "nodeType" in value;
}

export function closeColorPopover(): void {
  openPopover?.close();
}

/** Open the picker under `anchor` (one at a time). */
export function openColorPopover({
  anchor,
  title,
  initial,
  onApply,
  storage = defaultStorage(),
  closeOn = [],
}: ColorPopoverOptions): ColorPopover {
  closeColorPopover();
  const doc = anchor.ownerDocument;
  const pop = doc.createElement("div");
  pop.className = "amie-color-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", title);

  const row = doc.createElement("div");
  row.className = "amie-color-row";
  const preview = doc.createElement("span");
  preview.className = "amie-color-preview";
  const hex = doc.createElement("input");
  hex.type = "text";
  hex.className = "amie-color-hex";
  hex.placeholder = "#RRGGBB";
  hex.maxLength = 7;
  hex.setAttribute("aria-label", `${title} (HEX)`);
  hex.value = (initial && rgbToHex(initial)) ?? "";
  const apply = doc.createElement("button");
  apply.type = "button";
  apply.className = "amie-color-btn primary";
  apply.textContent = "Apply";
  row.append(preview, hex, apply);

  const error = doc.createElement("div");
  error.className = "amie-color-error";
  error.textContent = "Use a HEX color like #B76E79 or #FFF";
  error.hidden = true;

  const updatePreview = () => {
    const value = normalizeHex(hex.value);
    preview.style.background = value ?? "transparent";
    hex.setAttribute("aria-invalid", String(!value && hex.value.trim() !== ""));
    error.hidden = true;
  };
  updatePreview();

  // one signal removes every document listener the picker adds
  const listeners = new AbortController();
  const close = () => {
    pop.remove();
    listeners.abort();
    if (openPopover?.el === pop) openPopover = null;
  };
  const commit = (value: string | null) => {
    close();
    if (value) rememberColor(value, storage);
    onApply(value);
  };
  const applyHex = () => {
    const value = normalizeHex(hex.value);
    if (!value) {
      error.hidden = false;
      hex.setAttribute("aria-invalid", "true");
      hex.focus();
      return;
    }
    commit(value);
  };
  function onOutside(event: Event) {
    const { target } = event;
    // nodeType check, not instanceof: canvas events come from the iframe realm
    if (isNode(target) && (pop.contains(target) || anchor.contains(target))) {
      return;
    }
    close();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") close();
  }

  const swatchGrid = (colors: string[], label: string) => {
    const heading = doc.createElement("div");
    heading.className = "amie-color-label";
    heading.textContent = label;
    const grid = doc.createElement("div");
    grid.className = "amie-color-grid";
    colors.forEach((color) => {
      const swatch = doc.createElement("button");
      swatch.type = "button";
      swatch.className = "amie-color-swatch";
      swatch.title = color;
      swatch.setAttribute("aria-label", color);
      swatch.style.background = color;
      // keep focus (and the canvas selection) where it is
      swatch.addEventListener("mousedown", (e) => e.preventDefault());
      swatch.addEventListener("click", () => commit(color));
      grid.appendChild(swatch);
    });
    return [heading, grid];
  };

  const recent = loadRecentColors(storage);
  const actions = doc.createElement("div");
  actions.className = "amie-color-actions";
  const clear = doc.createElement("button");
  clear.type = "button";
  clear.className = "amie-color-btn";
  clear.textContent = "Clear";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "amie-color-btn";
  cancel.textContent = "Cancel";
  actions.append(clear, cancel);

  pop.append(
    row,
    error,
    ...(recent.length ? swatchGrid(recent, "Recent colors") : []),
    ...swatchGrid(COLOR_SWATCHES, "Colors"),
    actions,
  );

  hex.addEventListener("input", updatePreview);
  hex.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyHex();
    }
  });
  apply.addEventListener("click", applyHex);
  clear.addEventListener("click", () => commit(null));
  cancel.addEventListener("click", close);

  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(rect.bottom + 4)}px`;
  pop.style.left = `${Math.round(Math.max(4, Math.min(rect.left, (doc.defaultView?.innerWidth ?? 1024) - 244)))}px`;
  doc.body.appendChild(pop);
  [doc, ...closeOn].forEach((d) =>
    d.addEventListener("mousedown", onOutside, {
      capture: true,
      signal: listeners.signal,
    }),
  );
  doc.addEventListener("keydown", onKey, {
    capture: true,
    signal: listeners.signal,
  });
  hex.focus();
  hex.select();

  openPopover = { el: pop, close };
  return openPopover;
}
