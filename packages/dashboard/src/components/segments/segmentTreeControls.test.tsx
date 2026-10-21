/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import {
  DraggableRow,
  DropSlot,
  parseSlotId,
  RowActionsMenu,
  SegmentDndProvider,
  slotId,
} from "./segmentTreeControls";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

function render(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const el = root.querySelector(`[aria-label="${label}"]`);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`missing button: ${label}`);
  }
  return el;
}

function menuItem(text: string): HTMLElement {
  const found = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (i) => i.textContent?.includes(text),
  );
  if (!(found instanceof HTMLElement)) {
    throw new Error(`missing menu item: ${text}`);
  }
  return found;
}

function actions(overrides = {}) {
  return {
    canMoveUp: true,
    canMoveDown: false,
    onMoveUp: jest.fn(),
    onMoveDown: jest.fn(),
    onAddBelow: jest.fn(),
    onWrapOr: jest.fn(),
    onWrapAnd: jest.fn(),
    moveTargets: [{ id: "g1", label: "Top level › Group 1 (OR, 2 items)" }],
    onMoveTo: jest.fn(),
    ...overrides,
  };
}

it("round-trips drop slot ids, including group ids that contain colons", () => {
  expect(parseSlotId(slotId("abc-123", 2))).toEqual({
    groupId: "abc-123",
    index: 2,
  });
  expect(parseSlotId(slotId("a:b", 0))).toEqual({ groupId: "a:b", index: 0 });
  expect(parseSlotId("node-id")).toBeNull();
  expect(parseSlotId(undefined)).toBeNull();
});

it("renders a drag handle, drop slots and wires up/down + menu actions", () => {
  const a = actions();
  const { container, cleanup } = render(
    <SegmentDndProvider onDrop={jest.fn()}>
      <DropSlot groupId="g2" index={0} />
      <DraggableRow nodeId="yahoo">
        <span>row</span>
        <RowActionsMenu actions={a} />
      </DraggableRow>
      <DropSlot groupId="g2" index={1} />
    </SegmentDndProvider>,
  );
  try {
    expect(
      container.querySelector('[aria-label="Drag to move condition"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="segment-drop-slot-g2-0"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="segment-drop-slot-g2-1"]'),
    ).not.toBeNull();

    const up = button(container, "Move condition up");
    const down = button(container, "Move condition down");
    expect(up.disabled).toBe(false);
    expect(down.disabled).toBe(true);
    act(() => up.click());
    expect(a.onMoveUp).toHaveBeenCalledTimes(1);

    act(() => button(container, "More condition actions").click());
    expect(menuItem("Add condition below")).toBeTruthy();
    act(() => menuItem("Group with OR").click());
    expect(a.onWrapOr).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
  }
});

it("offers move-to-group targets and disables everything when the editor is disabled", () => {
  const a = actions({ canMoveDown: true });
  const { container, cleanup } = render(
    <SegmentDndProvider onDrop={jest.fn()}>
      <RowActionsMenu actions={a} disabled />
    </SegmentDndProvider>,
  );
  try {
    for (const label of [
      "Move condition up",
      "Move condition down",
      "More condition actions",
    ]) {
      expect(button(container, label).disabled).toBe(true);
    }
  } finally {
    cleanup();
  }
  const b = actions();
  const second = render(
    <SegmentDndProvider onDrop={jest.fn()}>
      <RowActionsMenu actions={b} />
    </SegmentDndProvider>,
  );
  try {
    act(() => button(second.container, "More condition actions").click());
    act(() => menuItem("Move to Top level › Group 1").click());
    expect(b.onMoveTo).toHaveBeenCalledWith("g1");
  } finally {
    second.cleanup();
  }
});
