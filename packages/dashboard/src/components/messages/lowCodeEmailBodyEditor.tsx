import "emailo/styles.css";

import { Stack } from "@mui/material";
import { Emailo, useEmailo } from "emailo";
import {
  ChannelType,
  CompletionStatus,
  LowCodeEmailTemplateResource,
} from "isomorphic-lib/src/types";
import { useEffect } from "react";
import { Overwrite } from "utility-types";

import { useAppStorePick } from "../../lib/appStore";
import { RenderEditorParams } from "../templateEditor";
import ImageAssetsPanel from "./imageAssetsPanel";

type LowCodeProps = Overwrite<
  RenderEditorParams,
  {
    draft: LowCodeEmailTemplateResource;
  }
> & {
  inDraftView: boolean;
};

export default function LowCodeEmailBodyEditor({
  draft,
  disabled,
  setDraft,
  inDraftView,
}: LowCodeProps) {
  const content = draft.body;
  const { userProperties: userPropertiesRequest } = useAppStorePick([
    "userProperties",
  ]);
  const userProperties =
    userPropertiesRequest.type === CompletionStatus.Successful
      ? userPropertiesRequest.value
      : [];

  const state = useEmailo({
    content,
    userProperties: userProperties.map((userProperty) => ({
      name: userProperty.name,
    })),
    disabled,
    onUpdate: (updatedContent) => {
      setDraft((defn) => {
        if (defn.type !== ChannelType.Email || !("emailContentsType" in defn)) {
          return defn;
        }

        const json = updatedContent.editor.getJSON();
        defn.body = json;
        return defn;
      });
    },
  });

  // Reset content when toggling draft view
  useEffect(() => {
    state?.editor.commands.setContent(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inDraftView]);

  if (!state) {
    return null;
  }
  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack direction="row" justifyContent="flex-end" sx={{ px: 1, py: 0.5 }}>
        <ImageAssetsPanel
          disabled={disabled}
          onInsert={(asset) => {
            state.editor
              .chain()
              .focus()
              .insertContent({
                type: "dfImage",
                attrs: {
                  url: asset.url,
                  alt: "",
                  width: 600,
                  defaultOpen: false,
                },
              })
              .run();
          }}
        />
      </Stack>
      <Emailo state={state} disabled={disabled} />
    </Stack>
  );
}
