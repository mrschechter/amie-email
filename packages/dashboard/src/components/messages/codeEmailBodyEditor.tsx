import { html } from "@codemirror/lang-html";
import { foldGutter } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { search, searchKeymap } from "@codemirror/search";
import {
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { Stack, useTheme } from "@mui/material";
import ReactCodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  ChannelType,
  CodeEmailTemplateResource,
} from "isomorphic-lib/src/types";
import React, { useCallback, useMemo, useRef } from "react";
import { Overwrite } from "utility-types";

import { RenderEditorParams } from "../templateEditor";
import ImageAssetsPanel from "./imageAssetsPanel";

type Props = Overwrite<
  RenderEditorParams,
  {
    draft: CodeEmailTemplateResource;
  }
>;

export default React.memo(function CodeEmailBodyEditor({
  draft,
  setDraft,
  disabled,
}: Props) {
  const theme = useTheme();
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(
    () => [
      html(),
      EditorView.theme({
        "&": {
          fontFamily: theme.typography.fontFamily,
          height: "100%",
        },
        ".cm-scroller": {
          overflow: "auto",
          overflowY: "scroll",
          scrollbarGutter: "stable",
          scrollbarWidth: "thin",
          scrollbarColor: "#8A8178 #F1EBE3",
        },
        // Let explicit scrollbar dimensions win in WebKit/Chromium, including
        // macOS overlay-scrollbar configurations; retain thin bars in Firefox.
        "@supports selector(::-webkit-scrollbar)": {
          ".cm-scroller": {
            scrollbarWidth: "auto",
            scrollbarColor: "auto",
          },
        },
        ".cm-scroller::-webkit-scrollbar": {
          width: "10px",
          height: "10px",
        },
        ".cm-scroller::-webkit-scrollbar-track": {
          background: "#F1EBE3",
        },
        ".cm-scroller::-webkit-scrollbar-thumb": {
          background: "#8A8178",
          borderRadius: "8px",
          border: "2px solid #F1EBE3",
        },
        ".cm-scroller::-webkit-scrollbar-thumb:hover": {
          background: "#2D7A7A",
        },
      }),
      EditorView.lineWrapping,
      lintGutter(),
      lineNumbers(),
      highlightActiveLine(),
      foldGutter(),
      search(),
      keymap.of(searchKeymap),
    ],
    [theme],
  );

  const handleChange = useCallback(
    (value: string) => {
      setDraft((defn) => {
        if (defn.type !== ChannelType.Email) {
          return defn;
        }

        defn.body = value;
        return defn;
      });
    },
    [setDraft],
  );

  const insertImage = useCallback(
    (url: string) => {
      const markup = `<img src="${url}" alt="" width="600" style="display:block;max-width:100%;height:auto;border:0">`;
      const view = editorRef.current?.view;
      if (view) {
        const selection = view.state.selection.main;
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: markup },
          selection: { anchor: selection.from + markup.length },
        });
        view.focus();
        return;
      }
      setDraft((defn) => {
        if (defn.type === ChannelType.Email && typeof defn.body === "string") {
          defn.body += markup;
        }
        return defn;
      });
    },
    [setDraft],
  );

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack direction="row" justifyContent="flex-end" sx={{ px: 1, py: 0.5 }}>
        <ImageAssetsPanel
          disabled={disabled}
          onInsert={(asset) => insertImage(asset.url)}
        />
      </Stack>
      <ReactCodeMirror
        ref={editorRef}
        height="100%"
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        basicSetup={{
          lineNumbers: false,
          highlightActiveLine: false,
          foldGutter: false,
          searchKeymap: false,
        }}
        value={draft.body}
        onChange={handleChange}
        readOnly={disabled}
        extensions={extensions}
      />
    </Stack>
  );
});
