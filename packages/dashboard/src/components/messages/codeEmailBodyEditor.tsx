import { html } from "@codemirror/lang-html";
import { lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
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
        },
      }),
      EditorView.lineWrapping,
      lintGutter(),
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
        value={draft.body}
        onChange={handleChange}
        readOnly={disabled}
        extensions={extensions}
      />
    </Stack>
  );
});
