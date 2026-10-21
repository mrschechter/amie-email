import {
  BodySegmentNode,
  SegmentDefinition,
  SegmentNode,
  SegmentNodeType,
  SegmentOperatorType,
} from "isomorphic-lib/src/types";
import { v4 as uuid } from "uuid";

// Pure, in-place edits on a segment definition (works on immer drafts).
// Node ids of existing conditions are always preserved.

export type GroupType = SegmentNodeType.And | SegmentNodeType.Or;

type GroupNode = Extract<SegmentNode, { type: GroupType }>;

export function isGroupNode(node: SegmentNode | undefined): node is GroupNode {
  return (
    node?.type === SegmentNodeType.And || node?.type === SegmentNodeType.Or
  );
}

export function findNode(
  definition: SegmentDefinition,
  id: string,
): SegmentNode | undefined {
  return id === definition.entryNode.id
    ? definition.entryNode
    : definition.nodes.find((n) => n.id === id);
}

function findGroup(
  definition: SegmentDefinition,
  id: string,
): GroupNode | undefined {
  const node = findNode(definition, id);
  return isGroupNode(node) ? node : undefined;
}

export function newBlankCondition(): BodySegmentNode {
  return {
    type: SegmentNodeType.Trait,
    id: uuid(),
    path: "",
    operator: { type: SegmentOperatorType.Equals, value: "" },
  };
}

/** The group that directly contains nodeId, if any. */
export function findParentGroup(
  definition: SegmentDefinition,
  nodeId: string,
): GroupNode | undefined {
  const all: SegmentNode[] = [definition.entryNode, ...definition.nodes];
  for (const n of all) {
    if (isGroupNode(n) && n.children.includes(nodeId)) {
      return n;
    }
  }
  return undefined;
}

/** Insert a new blank condition into a group at `index` (end when omitted). */
export function insertCondition(
  definition: SegmentDefinition,
  groupId: string,
  index?: number,
): string | null {
  const group = findGroup(definition, groupId);
  if (!group) {
    return null;
  }
  const child = newBlankCondition();
  const at =
    index === undefined
      ? group.children.length
      : Math.max(0, Math.min(index, group.children.length));
  group.children.splice(at, 0, child.id);
  definition.nodes.push(child);
  return child.id;
}

/** Move a child up (-1) or down (+1) within its group. */
export function moveWithinGroup(
  definition: SegmentDefinition,
  groupId: string,
  nodeId: string,
  delta: number,
): boolean {
  const group = findGroup(definition, groupId);
  if (!group) {
    return false;
  }
  const from = group.children.indexOf(nodeId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= group.children.length) {
    return false;
  }
  group.children.splice(from, 1);
  group.children.splice(to, 0, nodeId);
  return true;
}

/** Ids of nodeId and everything nested under it. */
export function descendantIds(
  definition: SegmentDefinition,
  nodeId: string,
): Set<string> {
  const out = new Set<string>();
  const stack = [nodeId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (out.has(id)) {
      continue;
    }
    out.add(id);
    const n = findNode(definition, id);
    if (isGroupNode(n)) {
      stack.push(...n.children);
    }
  }
  return out;
}

/** Move a node from one group into another group (end by default). */
export function moveToGroup(
  definition: SegmentDefinition,
  nodeId: string,
  fromGroupId: string,
  toGroupId: string,
  index?: number,
): boolean {
  if (fromGroupId === toGroupId) {
    return false;
  }
  const from = findGroup(definition, fromGroupId);
  const to = findGroup(definition, toGroupId);
  if (!from || !to || !from.children.includes(nodeId)) {
    return false;
  }
  // Never move a group into itself or one of its own subgroups.
  if (descendantIds(definition, nodeId).has(toGroupId)) {
    return false;
  }
  // Keep every group non-empty: the evaluator expects children.
  if (from.children.length <= 1) {
    return false;
  }
  from.children = from.children.filter((c) => c !== nodeId);
  const at =
    index === undefined
      ? to.children.length
      : Math.max(0, Math.min(index, to.children.length));
  to.children.splice(at, 0, nodeId);
  return true;
}

/**
 * Wrap an existing child in a new AND/OR group in the same position, keeping
 * the original condition and adding one blank condition beside it.
 */
export function wrapInGroup(
  definition: SegmentDefinition,
  parentGroupId: string,
  nodeId: string,
  groupType: GroupType,
): string | null {
  const parent = findGroup(definition, parentGroupId);
  if (!parent) {
    return null;
  }
  const at = parent.children.indexOf(nodeId);
  if (at < 0) {
    return null;
  }
  const blank = newBlankCondition();
  const group: BodySegmentNode = {
    type: groupType,
    id: uuid(),
    children: [nodeId, blank.id],
  };
  parent.children.splice(at, 1, group.id);
  definition.nodes.push(group, blank);
  return group.id;
}

export interface GroupChoice {
  id: string;
  label: string;
}

/** Every group (except the node itself and its subgroups), labeled by path. */
export function listTargetGroups(
  definition: SegmentDefinition,
  excludeNodeId: string,
): GroupChoice[] {
  const excluded = descendantIds(definition, excludeNodeId);
  const out: GroupChoice[] = [];
  const walk = (node: SegmentNode, path: string) => {
    if (!isGroupNode(node)) {
      return;
    }
    if (!excluded.has(node.id)) {
      const word = node.type === SegmentNodeType.And ? "AND" : "OR";
      out.push({
        id: node.id,
        label: `${path} (${word}, ${node.children.length} item${node.children.length === 1 ? "" : "s"})`,
      });
    }
    let groupIndex = 0;
    for (const childId of node.children) {
      const child = findNode(definition, childId);
      if (isGroupNode(child)) {
        groupIndex += 1;
        walk(child, `${path} › Group ${groupIndex}`);
      }
    }
  };
  walk(definition.entryNode, "Top level");
  return out;
}

/**
 * Drag-and-drop target: place nodeId at `index` inside toGroupId, where index
 * is the slot position among the group's current children (0 = top). Handles
 * both reorder-within-group and move-between-groups.
 */
export function dropAt(
  definition: SegmentDefinition,
  nodeId: string,
  toGroupId: string,
  index: number,
): boolean {
  const from = findParentGroup(definition, nodeId);
  if (!from) {
    return false;
  }
  if (from.id !== toGroupId) {
    return moveToGroup(definition, nodeId, from.id, toGroupId, index);
  }
  const fromIndex = from.children.indexOf(nodeId);
  let target = index > fromIndex ? index - 1 : index;
  target = Math.max(0, Math.min(target, from.children.length - 1));
  if (target === fromIndex) {
    return false;
  }
  from.children.splice(fromIndex, 1);
  from.children.splice(target, 0, nodeId);
  return true;
}
