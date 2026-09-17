import deepEqual from "fast-deep-equal";
import { MessageTemplateResourceDraft } from "isomorphic-lib/src/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { SetDraft } from "../templateEditor";

const LIMIT = 100;
const COALESCE_MS = 400;

export default function useDraftHistory({
  draft,
  setDraft,
  resetKey,
}: {
  draft: MessageTemplateResourceDraft;
  setDraft: SetDraft;
  resetKey: string;
}) {
  // Drafts are immutable (including updates made through the parent's Immer
  // setter). Observe the shared draft so edits from sibling code/import tools
  // participate in the same history as edits made in the V3 layout.
  const history = useRef<{
    present: MessageTemplateResourceDraft;
    past: MessageTemplateResourceDraft[];
    future: MessageTemplateResourceDraft[];
    lastChange: number;
    resetKey: string;
  }>({
    present: draft,
    past: [],
    future: [],
    lastChange: Number.NEGATIVE_INFINITY,
    resetKey,
  });
  const [, refresh] = useState(0);

  useEffect(() => {
    const state = history.current;
    if (state.resetKey !== resetKey) {
      history.current = {
        present: draft,
        past: [],
        future: [],
        lastChange: Number.NEGATIVE_INFINITY,
        resetKey,
      };
      refresh((value) => value + 1);
    } else if (!deepEqual(state.present, draft)) {
      const now = Date.now();
      if (now - state.lastChange >= COALESCE_MS) {
        state.past = [...state.past, state.present].slice(-LIMIT);
      }
      state.present = draft;
      state.future = [];
      state.lastChange = now;
      refresh((value) => value + 1);
    }
  }, [draft, resetKey]);

  const restore = useCallback(
    (direction: "past" | "future") => {
      const state = history.current;
      const snapshot = state[direction].pop();
      if (!snapshot) return;
      const opposite = direction === "past" ? "future" : "past";
      state[opposite] = [...state[opposite], state.present].slice(-LIMIT);
      state.present = snapshot;
      // A restore is not a new edit. The next edit starts a fresh typing group.
      state.lastChange = Number.NEGATIVE_INFINITY;
      setDraft(() => snapshot);
      refresh((value) => value + 1);
    },
    [setDraft],
  );

  return {
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    undo: useCallback(() => restore("past"), [restore]),
    redo: useCallback(() => restore("future"), [restore]),
  };
}
