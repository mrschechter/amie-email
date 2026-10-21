import {
  SegmentDefinition,
  SegmentNodeType,
  SegmentOperatorType,
} from "isomorphic-lib/src/types";

import {
  dropAt,
  findNode,
  findParentGroup,
  insertCondition,
  isGroupNode,
  listTargetGroups,
  moveToGroup,
  moveWithinGroup,
  wrapInGroup,
} from "./segmentTreeOps";

function trait(id: string, path: string) {
  return {
    type: SegmentNodeType.Trait as const,
    id,
    path,
    operator: { type: SegmentOperatorType.Equals as const, value: "x" },
  };
}

// (opened OR clicked) AND (yahoo OR aol OR hotmail)
function fixture(): SegmentDefinition {
  return {
    entryNode: {
      type: SegmentNodeType.And,
      id: "root",
      children: ["g1", "g2"],
    },
    nodes: [
      { type: SegmentNodeType.Or, id: "g1", children: ["opened", "clicked"] },
      {
        type: SegmentNodeType.Or,
        id: "g2",
        children: ["yahoo", "aol", "hotmail"],
      },
      trait("opened", "opened"),
      trait("clicked", "clicked"),
      trait("yahoo", "provider"),
      trait("aol", "provider"),
      trait("hotmail", "provider"),
    ],
  };
}

function childrenOf(def: SegmentDefinition, id: string): string[] {
  const n = findNode(def, id);
  return isGroupNode(n) ? n.children : [];
}

describe("segmentTreeOps", () => {
  it("inserts a condition into the FIRST group at a chosen position", () => {
    const def = fixture();
    const id = insertCondition(def, "g1", 1);
    expect(id).toBeTruthy();
    expect(childrenOf(def, "g1")).toEqual(["opened", id, "clicked"]);
    expect(childrenOf(def, "g2")).toEqual(["yahoo", "aol", "hotmail"]);
    expect(findNode(def, id ?? "")?.type).toBe(SegmentNodeType.Trait);
  });

  it("appends when no index is given and clamps out-of-range indexes", () => {
    const def = fixture();
    const a = insertCondition(def, "g1");
    const b = insertCondition(def, "g1", 99);
    expect(childrenOf(def, "g1")).toEqual(["opened", "clicked", a, b]);
    expect(insertCondition(def, "opened")).toBeNull();
  });

  it("moves a child up and down within its group, refusing out-of-range moves", () => {
    const def = fixture();
    expect(moveWithinGroup(def, "g2", "hotmail", -1)).toBe(true);
    expect(childrenOf(def, "g2")).toEqual(["yahoo", "hotmail", "aol"]);
    expect(moveWithinGroup(def, "g2", "yahoo", -1)).toBe(false);
    expect(moveWithinGroup(def, "g2", "aol", 1)).toBe(false);
  });

  it("moves a condition into another group and finds its new parent", () => {
    const def = fixture();
    expect(moveToGroup(def, "hotmail", "g2", "g1", 0)).toBe(true);
    expect(childrenOf(def, "g1")).toEqual(["hotmail", "opened", "clicked"]);
    expect(childrenOf(def, "g2")).toEqual(["yahoo", "aol"]);
    expect(findParentGroup(def, "hotmail")?.id).toBe("g1");
  });

  it("never moves a group into itself/its descendants or empties a group", () => {
    const def = fixture();
    expect(moveToGroup(def, "g1", "root", "g1")).toBe(false);
    const single: SegmentDefinition = {
      entryNode: {
        type: SegmentNodeType.And,
        id: "root",
        children: ["g1", "g2"],
      },
      nodes: [
        { type: SegmentNodeType.Or, id: "g1", children: ["only"] },
        { type: SegmentNodeType.Or, id: "g2", children: ["b"] },
        trait("only", "x"),
        trait("b", "y"),
      ],
    };
    expect(moveToGroup(single, "only", "g1", "g2")).toBe(false);
  });

  it("wraps an existing condition into a new OR group in place, keeping its id", () => {
    const def = fixture();
    const gid = wrapInGroup(def, "g1", "opened", SegmentNodeType.Or);
    expect(gid).toBeTruthy();
    expect(childrenOf(def, "g1")[0]).toBe(gid);
    const wrapped = childrenOf(def, gid ?? "");
    expect(wrapped[0]).toBe("opened");
    expect(wrapped).toHaveLength(2);
    expect(findNode(def, "opened")?.type).toBe(SegmentNodeType.Trait);
  });

  it("lists target groups by path, excluding the node and its subgroups", () => {
    const def = fixture();
    const all = listTargetGroups(def, "hotmail").map((g) => g.id);
    expect(all).toEqual(["root", "g1", "g2"]);
    const fromG1 = listTargetGroups(def, "g1").map((g) => g.id);
    expect(fromG1).toEqual(["root", "g2"]);
    expect(listTargetGroups(def, "hotmail")[1]?.label).toMatch(
      /Group 1 \(OR, 2 items\)/,
    );
  });

  it("preserves every existing condition id across edits", () => {
    const def = fixture();
    const before = new Set(def.nodes.map((n) => n.id));
    insertCondition(def, "g1", 1);
    moveWithinGroup(def, "g2", "aol", -1);
    moveToGroup(def, "hotmail", "g2", "g1");
    wrapInGroup(def, "g2", "yahoo", SegmentNodeType.And);
    const after = new Set(def.nodes.map((n) => n.id));
    for (const id of before) {
      expect(after.has(id)).toBe(true);
    }
  });

  it("drag-drops within a group using slot indexes", () => {
    const def = fixture();
    // drag "yahoo" (index 0) to the slot after "aol" (slot 2)
    expect(dropAt(def, "yahoo", "g2", 2)).toBe(true);
    expect(childrenOf(def, "g2")).toEqual(["aol", "yahoo", "hotmail"]);
    // dropping into its own slot is a no-op
    expect(dropAt(def, "yahoo", "g2", 1)).toBe(false);
    // drag "hotmail" to the very top
    expect(dropAt(def, "hotmail", "g2", 0)).toBe(true);
    expect(childrenOf(def, "g2")).toEqual(["hotmail", "aol", "yahoo"]);
  });

  it("drag-drops across groups (new-subscriber condition into the first group)", () => {
    const def = fixture();
    const id = insertCondition(def, "g2") ?? "";
    expect(dropAt(def, id, "g1", 1)).toBe(true);
    expect(childrenOf(def, "g1")).toEqual(["opened", id, "clicked"]);
    expect(childrenOf(def, "g2")).toEqual(["yahoo", "aol", "hotmail"]);
  });
});
