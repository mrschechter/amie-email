import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownward,
  ArrowUpward,
  DragIndicator,
  MoreVert,
} from "@mui/icons-material";
import {
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from "@mui/material";
import React, { useState } from "react";

import { GroupChoice } from "./segmentTreeOps";

const SLOT_PREFIX = "slot:";

export function slotId(groupId: string, index: number): string {
  return `${SLOT_PREFIX}${groupId}:${index}`;
}

export function parseSlotId(
  id: string | number | undefined | null,
): { groupId: string; index: number } | null {
  if (typeof id !== "string" || !id.startsWith(SLOT_PREFIX)) {
    return null;
  }
  const rest = id.slice(SLOT_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep < 0) {
    return null;
  }
  const index = Number(rest.slice(sep + 1));
  return Number.isInteger(index)
    ? { groupId: rest.slice(0, sep), index }
    : null;
}

/** One drag-and-drop context for the whole segment tree. */
export function SegmentDndProvider({
  onDrop,
  children,
}: {
  onDrop: (nodeId: string, groupId: string, index: number) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const slot = parseSlotId(event.over?.id);
    const nodeId = event.active.id;
    if (slot && typeof nodeId === "string") {
      onDrop(nodeId, slot.groupId, slot.index);
    }
  };
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}

/** Thin drop target between rows; only visible while something is dragged. */
export function DropSlot({
  groupId,
  index,
  disabled,
}: {
  groupId: string;
  index: number;
  disabled?: boolean;
}) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({
    id: slotId(groupId, index),
    disabled,
  });
  const dragging = Boolean(active);
  return (
    <Box
      ref={setNodeRef}
      data-testid={`segment-drop-slot-${groupId}-${index}`}
      sx={{
        height: dragging ? 14 : 0,
        my: dragging ? 0.5 : 0,
        borderRadius: 1,
        transition: "height 120ms",
        border: dragging ? "2px dashed" : "none",
        borderColor: isOver ? "primary.main" : "divider",
        backgroundColor: isOver ? "action.selected" : "transparent",
      }}
    />
  );
}

/** Wraps a condition/group row with a drag handle. */
export function DraggableRow({
  nodeId,
  disabled,
  children,
}: {
  nodeId: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: nodeId, disabled });
  return (
    <Stack
      ref={setNodeRef}
      direction="row"
      alignItems="flex-start"
      sx={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : "auto",
        position: "relative",
      }}
    >
      <Tooltip title="Drag to move">
        <span>
          <IconButton
            size="small"
            disabled={disabled}
            aria-label="Drag to move condition"
            sx={{ cursor: disabled ? "default" : "grab", mt: 1.5 }}
            {...attributes}
            {...listeners}
          >
            <DragIndicator fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

export interface RowActions {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddBelow: () => void;
  onWrapOr: () => void;
  onWrapAnd: () => void;
  moveTargets: GroupChoice[];
  onMoveTo: (groupId: string) => void;
}

/** Up/down buttons plus a menu for insert / regroup / move-to-group. */
export function RowActionsMenu({
  actions,
  disabled,
}: {
  actions: RowActions;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <Stack direction="row" sx={{ mt: 1 }}>
      <Tooltip title="Move up">
        <span>
          <IconButton
            size="small"
            aria-label="Move condition up"
            disabled={disabled || !actions.canMoveUp}
            onClick={actions.onMoveUp}
          >
            <ArrowUpward fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Move down">
        <span>
          <IconButton
            size="small"
            aria-label="Move condition down"
            disabled={disabled || !actions.canMoveDown}
            onClick={actions.onMoveDown}
          >
            <ArrowDownward fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <IconButton
        size="small"
        aria-label="More condition actions"
        disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <MoreVert fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem onClick={run(actions.onAddBelow)}>
          <ListItemText>Add condition below</ListItemText>
        </MenuItem>
        <MenuItem onClick={run(actions.onWrapOr)}>
          <ListItemText
            primary="Group with OR"
            secondary="Make this “this OR …” in place"
          />
        </MenuItem>
        <MenuItem onClick={run(actions.onWrapAnd)}>
          <ListItemText
            primary="Group with AND"
            secondary="Make this “this AND …” in place"
          />
        </MenuItem>
        {actions.moveTargets.length > 0 ? <Divider /> : null}
        {actions.moveTargets.map((target) => (
          <MenuItem
            key={target.id}
            onClick={run(() => actions.onMoveTo(target.id))}
          >
            <ListItemIcon />
            <ListItemText primary={`Move to ${target.label}`} />
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}
