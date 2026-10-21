/** @jest-environment jsdom */
import {
  SegmentNodeType,
  SegmentOperatorType,
  SegmentResource,
} from "isomorphic-lib/src/types";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import SegmentEditor from "./editor";
import { findNode, isGroupNode } from "./segmentTreeOps";

const segment: SegmentResource = {
  id: "seg-1",
  workspaceId: "ws",
  name: "Yahoo/AOL engaged",
  updatedAt: 0,
  definition: {
    entryNode: {
      type: SegmentNodeType.And,
      id: "root",
      children: ["g1", "g2"],
    },
    nodes: [
      { type: SegmentNodeType.Or, id: "g1", children: ["opened"] },
      { type: SegmentNodeType.Or, id: "g2", children: ["yahoo", "aol"] },
      {
        type: SegmentNodeType.Trait,
        id: "opened",
        path: "opened",
        operator: { type: SegmentOperatorType.Equals, value: "1" },
      },
      {
        type: SegmentNodeType.Trait,
        id: "yahoo",
        path: "provider",
        operator: { type: SegmentOperatorType.Equals, value: "yahoo" },
      },
      {
        type: SegmentNodeType.Trait,
        id: "aol",
        path: "provider",
        operator: { type: SegmentOperatorType.Equals, value: "aol" },
      },
    ],
  },
};

jest.mock("../../lib/useSegmentQuery", () => ({
  useSegmentQuery: () => ({ data: segment, isError: false, isPending: false }),
}));
jest.mock("../../lib/appStore", () => ({
  useAppStorePick: () => ({ workspace: { type: "Ok", value: { id: "ws" } } }),
}));
jest.mock("../../lib/useUploadCsvMutation", () => ({
  useUploadCsvMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock("../traitAutocomplete", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../messageTemplateAutocomplete", () => ({
  MessageTemplateAutocomplete: () => null,
}));
jest.mock("../subscriptionGroupAutocomplete", () => ({
  SubscriptionGroupAutocompleteV2: () => null,
}));
jest.mock("../eventsAutocomplete", () => ({
  EventNamesAutocomplete: () => null,
  PropertiesAutocomplete: () => null,
}));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

function childrenOf(resource: SegmentResource, id: string): string[] {
  const node = findNode(resource.definition, id);
  return isGroupNode(node) ? node.children : [];
}

it("renders drag handles, per-row actions and drop slots for every group of an existing segment", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const changes: SegmentResource[] = [];
  try {
    act(() =>
      root.render(
        <SegmentEditor
          segmentId="seg-1"
          onSegmentChange={(s) => changes.push(s)}
        />,
      ),
    );
    // 2 groups + 3 conditions = 5 draggable rows under the root AND.
    expect(
      container.querySelectorAll('[aria-label="Drag to move condition"]'),
    ).toHaveLength(5);
    expect(
      container.querySelectorAll('[aria-label="More condition actions"]'),
    ).toHaveLength(5);
    // every group gets an "add" button and slots before/after each child
    expect(
      container.querySelectorAll('[aria-label="Add condition to this group"]'),
    ).toHaveLength(3);
    expect(
      container.querySelector('[data-testid="segment-drop-slot-g1-0"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="segment-drop-slot-g1-1"]'),
    ).not.toBeNull();

    // Move "aol" above "yahoo" in the second group via the up button.
    // DOM order of enabled "up" buttons: the "aol" row (nested in g2) comes
    // before g2's own row controls, which render after its children.
    const enabled = Array.from(
      container.querySelectorAll('[aria-label="Move condition up"]'),
    ).filter((b) => b instanceof HTMLButtonElement && !b.disabled);
    expect(enabled).toHaveLength(2);
    const aolUp = enabled[0];
    if (!(aolUp instanceof HTMLButtonElement)) {
      throw new Error("missing aol up button");
    }
    act(() => aolUp.click());
    const changed = changes[changes.length - 1];
    if (!changed) {
      throw new Error("segment change not emitted");
    }
    expect(childrenOf(changed, "g2")).toEqual(["aol", "yahoo"]);
    expect(childrenOf(changed, "root")).toEqual(["g1", "g2"]);
    // existing condition ids are preserved
    expect(changed.definition.nodes.map((n) => n.id).sort()).toEqual([
      "aol",
      "g1",
      "g2",
      "opened",
      "yahoo",
    ]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
