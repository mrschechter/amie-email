import "grapesjs/dist/css/grapes.min.css";

import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import axios from "axios";
import grapesjs, { Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";
import {
  AmieAsset,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";
import { AMIE_PLACEHOLDER_IMAGE_URL } from "isomorphic-lib/src/amieLinks";
import { CodeEmailContents } from "isomorphic-lib/src/types";
import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  applyVisualSave,
  buildVisualDesign,
  expandSelfClosingMjml,
  hasUnsubscribeLink,
  STARTER_MJML,
  VISUAL_EMAIL_VARIABLES,
  VisualOpenState,
  visualOpenState,
} from "./visualEmailDesign";
import { visualDesignWarnings } from "./visualEmailWarnings";

const SYNC_DEBOUNCE_MS = 700;

export interface VisualEmailEditorProps {
  templateId: string;
  draft: CodeEmailContents;
  setDraft: (update: (draft: CodeEmailContents) => CodeEmailContents) => void;
  disabled?: boolean;
  resetKey: string;
  workspaceId: string | null;
  baseApiUrl: string;
  authHeaders: Record<string, string>;
}

function backupKey(templateId: string) {
  return `amie-visual-email-backup:${templateId}`;
}

export default function VisualEmailEditor({
  templateId,
  draft,
  setDraft,
  disabled,
  resetKey,
  workspaceId,
  baseApiUrl,
  authHeaders,
}: VisualEmailEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [openState, setOpenState] = useState<VisualOpenState>(() =>
    visualOpenState(draft),
  );
  const [started, setStarted] = useState(
    () => openState === "design" || openState === "blank",
  );
  const [startSource, setStartSource] = useState<"design" | "mjml" | "starter">(
    openState === "design" ? "design" : "starter",
  );
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<string | null>(null);

  // Reset when the template or draft/published view changes.
  useEffect(() => {
    const state = visualOpenState(draftRef.current);
    setOpenState(state);
    setStarted(state === "design" || state === "blank");
    setStartSource(state === "design" ? "design" : "starter");
  }, [resetKey]);

  const flush = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const mjml = editor.getHtml();
    // GrapesJS ProjectData is a plain JSON object; we persist it opaquely.
    const project: Record<string, unknown> = JSON.parse(
      JSON.stringify(editor.getProjectData()),
    );
    const design = buildVisualDesign({
      project,
      mjml,
    });
    setDraft((current) => applyVisualSave(current, design));
    setWarnings(visualDesignWarnings(mjml));
    setPending(false);
    try {
      window.localStorage.removeItem(backupKey(templateId));
    } catch {
      // storage unavailable — autosave to the server still happened
    }
  }, [disabled, setDraft, templateId]);

  const schedule = useCallback(() => {
    if (disabled) return;
    setPending(true);
    const editor = editorRef.current;
    if (editor) {
      try {
        window.localStorage.setItem(
          backupKey(templateId),
          JSON.stringify({ at: Date.now(), project: editor.getProjectData() }),
        );
      } catch {
        // ignore quota/private-mode errors
      }
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SYNC_DEBOUNCE_MS);
  }, [disabled, flush, templateId]);

  // Warn before leaving with an unsynced change.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!timerRef.current) return;
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    if (!started || !containerRef.current) return undefined;
    const { current } = draftRef;
    const design = startSource === "design" ? current.visualDesign : null;
    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      undoManager: { trackSelection: false },
      plugins: [
        (e: Editor) =>
          grapesjsMjml(e, {
            imagePlaceholderSrc: AMIE_PLACEHOLDER_IMAGE_URL,
            columnsPadding: "0px",
          }),
      ],
      assetManager: {
        upload: false,
        autoAdd: true,
        uploadFile: async (event: DragEvent | Event) => {
          const { target } = event;
          let files: FileList | null = null;
          if ("dataTransfer" in event && event.dataTransfer) {
            files = event.dataTransfer.files;
          } else if (target instanceof HTMLInputElement) {
            files = target.files;
          }
          if (!files || !workspaceId) return;
          const uploaded = await Promise.all(
            Array.from(files).map(async (file) => {
              const form = new FormData();
              form.append("workspaceId", workspaceId);
              form.append("file", file);
              const response = await axios.post<AmieAsset>(
                `${baseApiUrl}/content/assets`,
                form,
                { headers: authHeaders },
              );
              return response.data;
            }),
          );
          editorRef.current?.AssetManager.add(
            uploaded.map((asset) => ({ src: asset.url, name: asset.name })),
          );
        },
      },
    });
    editorRef.current = editor;

    if (design?.project) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      editor.loadProjectData(design.project as never);
    } else if (startSource === "mjml" && current.body) {
      editor.setComponents(expandSelfClosingMjml(current.body));
    } else {
      editor.setComponents(STARTER_MJML);
    }

    // Personalization picker inside the text toolbar.
    const select = document.createElement("select");
    select.title = "Insert variable";
    select.style.cssText =
      "font-size:12px;max-width:150px;margin:0 4px;color:#333;";
    select.innerHTML = `<option value="">{ } Variables</option>${VISUAL_EMAIL_VARIABLES.map(
      (v) =>
        `<option value="${v.value.replace(/"/g, "&quot;")}">${v.label}</option>`,
    ).join("")}`;
    editor.RichTextEditor.add("amie-variables", {
      icon: select,
      event: "change",
      result: (rte) => {
        if (select.value) rte.insertHTML(select.value);
        select.value = "";
      },
    });

    // GrapesJS keeps its own undo stack for every structural, style and text edit.
    editor.Panels.addButton("options", [
      {
        id: "amie-undo",
        label: "↶",
        command: "core:undo",
        attributes: { title: "Undo (Ctrl/Cmd+Z)" },
      },
      {
        id: "amie-redo",
        label: "↷",
        command: "core:redo",
        attributes: { title: "Redo (Ctrl/Cmd+Shift+Z)" },
      },
    ]);

    editor.BlockManager.add("amie-4-columns", {
      label: "4 Columns",
      category: "Layout",
      content: `<mj-section>${Array.from({ length: 4 })
        .map(() => "<mj-column><mj-text>Column</mj-text></mj-column>")
        .join("")}</mj-section>`,
    });

    editor.BlockManager.add("amie-table", {
      label: "Table",
      category: "Basic",
      content: `<mj-text><table style="width:100%;border-collapse:collapse;font-size:14px;" cellpadding="8"><tr><th align="left" style="border-bottom:1px solid #E3DAD1;">Item</th><th align="right" style="border-bottom:1px solid #E3DAD1;">Price</th></tr><tr><td>Product name</td><td align="right">$0.00</td></tr></table></mj-text>`,
    });

    if (workspaceId) {
      void axios
        .get<AmieAssetListResponse>(`${baseApiUrl}/content/assets`, {
          params: { workspaceId },
          headers: authHeaders,
        })
        .then((response) =>
          editor.AssetManager.add(
            response.data.assets.map((asset) => ({
              src: asset.url,
              name: asset.name,
            })),
          ),
        )
        .catch(() => undefined);
    }

    try {
      const raw = window.localStorage.getItem(backupKey(templateId));
      if (raw && design) {
        const parsed: { at?: unknown } = JSON.parse(raw);
        const savedAt = design.updatedAt ? Date.parse(design.updatedAt) : 0;
        if (typeof parsed.at === "number" && parsed.at > savedAt) {
          setRecovery(raw);
        }
      }
    } catch {
      // ignore
    }

    setWarnings(visualDesignWarnings(editor.getHtml()));
    // Starting from MJML or the starter writes the first design immediately.
    if (!design && !disabled) flush();
    editor.on("update", schedule);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      editor.off("update", schedule);
      editor.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, startSource, resetKey]);

  const restoreBackup = () => {
    if (!recovery || !editorRef.current) return;
    try {
      const parsed: { project?: unknown } = JSON.parse(recovery);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      editorRef.current.loadProjectData(parsed.project as never);
      setRecovery(null);
      flush();
    } catch {
      setRecovery(null);
    }
  };

  let statusLabel = "All changes saved to the draft";
  if (disabled) {
    statusLabel =
      "Viewing the published version — switch to the draft to edit.";
  } else if (pending) {
    statusLabel = "Unsaved changes…";
  }

  if (!started) {
    return (
      <Stack spacing={2} sx={{ p: 3, maxWidth: 720 }}>
        {openState === "importMjml" ? (
          <>
            <Typography variant="h6">
              Open this email in the visual editor
            </Typography>
            <Typography color="text.secondary">
              This template is MJML, so it can be opened as editable blocks.
              Anything the visual editor can&apos;t represent is kept as raw
              HTML.
            </Typography>
            <Button
              variant="contained"
              disabled={disabled}
              onClick={() => {
                setStartSource("mjml");
                setStarted(true);
              }}
            >
              Open in visual editor
            </Button>
          </>
        ) : null}
        {openState === "customHtml" ? (
          <>
            <Typography variant="h6">This email is custom HTML</Typography>
            <Typography color="text.secondary">
              It was written as HTML (Code tab or the AI composer), so it
              can&apos;t be converted into visual blocks without losing parts of
              it. You can keep editing it in the Code tab, or start a new visual
              design, which replaces the current body.
            </Typography>
            <Button
              variant="outlined"
              color="warning"
              disabled={disabled}
              onClick={() => {
                if (
                  window.confirm(
                    "Start a new visual design? This replaces the current email body.",
                  )
                ) {
                  setStartSource("starter");
                  setStarted(true);
                }
              }}
            >
              Start a new visual design
            </Button>
          </>
        ) : null}
        {openState === "stale" ? (
          <>
            <Typography variant="h6">
              This email changed outside the visual editor
            </Typography>
            <Typography color="text.secondary">
              The body was edited in the Code tab or by the AI composer after
              the last visual save. Choose which version to continue from.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={disabled}
                onClick={() => {
                  setStartSource("mjml");
                  setStarted(true);
                }}
              >
                Use the current body
              </Button>
              <Button
                variant="outlined"
                color="warning"
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "Reopen the last visual design? Changes made outside the visual editor will be replaced.",
                    )
                  ) {
                    setStartSource("design");
                    setStarted(true);
                  }
                }}
              >
                Reopen last visual design
              </Button>
            </Stack>
          </>
        ) : null}
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: "100%" }} data-testid="visual-email-editor">
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid #EFE7DE" }}
      >
        <Typography sx={{ fontSize: 12.5, color: "#7A6F67" }}>
          {statusLabel}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {!hasUnsubscribeLink(draft.body) ? (
          <Typography sx={{ fontSize: 12.5, color: "#B76E79" }}>
            Add an unsubscribe link before sending
          </Typography>
        ) : null}
      </Stack>
      {recovery ? (
        <Alert
          severity="info"
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={restoreBackup}>
                Restore
              </Button>
              <Button size="small" onClick={() => setRecovery(null)}>
                Dismiss
              </Button>
            </Stack>
          }
        >
          Unsaved visual edits from an earlier session were found.
        </Alert>
      ) : null}
      {warnings.length ? (
        <Alert severity="warning" sx={{ py: 0 }}>
          {warnings.join(" · ")}
        </Alert>
      ) : null}
      <Box
        sx={{
          flex: 1,
          minHeight: 640,
          position: "relative",
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.75 : 1,
        }}
      >
        <div ref={containerRef} style={{ height: "100%" }} />
      </Box>
    </Stack>
  );
}
