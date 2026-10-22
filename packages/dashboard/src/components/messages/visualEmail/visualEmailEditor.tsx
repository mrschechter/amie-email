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
  isMjmlBody,
  STARTER_MJML,
  VISUAL_EMAIL_VARIABLES,
  VISUAL_HTML_EDITOR_ID,
  visualDesignEditor,
  VisualOpenState,
  visualOpenState,
} from "./visualEmailDesign";
import {
  applyShellToCanvas,
  detectHtmlImportRisks,
  exportHtmlDocument,
  HTML_BLOCKS,
  HtmlImportRisk,
  HtmlShell,
  importHtmlIntoEditor,
  splitHtmlDocument,
} from "./visualEmailHtml";
import {
  visualDesignWarnings,
  visualHtmlWarnings,
} from "./visualEmailWarnings";

type StartSource = "design" | "mjml" | "html" | "starter";
type EditorMode = "mjml" | "html";

function editorModeFor(
  source: StartSource,
  design: CodeEmailContents["visualDesign"],
): EditorMode {
  if (source === "html") return "html";
  if (
    source === "design" &&
    visualDesignEditor(design) === VISUAL_HTML_EDITOR_ID
  ) {
    return "html";
  }
  return "mjml";
}

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
  /** Switch the template editor to its Code tab. */
  onOpenCode?: () => void;
}

function backupKey(templateId: string) {
  return `amie-visual-email-backup:${templateId}`;
}

function addMjmlBlocks(editor: Editor) {
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
  onOpenCode,
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
  const [startSource, setStartSource] = useState<StartSource>(
    openState === "design" ? "design" : "starter",
  );
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<string | null>(null);
  // HTML mode: risky content found before opening, awaiting the user's choice.
  const [riskReview, setRiskReview] = useState<HtmlImportRisk[] | null>(null);
  const [openedRisks, setOpenedRisks] = useState<HtmlImportRisk[]>([]);
  // HTML mode: the preserved doctype/head/body tags around the edited content.
  const shellRef = useRef<HtmlShell | null>(null);
  // HTML mode never autosaves: edits wait for an explicit Save.
  const dirtyRef = useRef(false);
  const mode = editorModeFor(startSource, draft.visualDesign);
  const modeRef = useRef(mode);

  // Reset when the template or draft/published view changes.
  useEffect(() => {
    const state = visualOpenState(draftRef.current);
    setOpenState(state);
    setStarted(state === "design" || state === "blank");
    setStartSource(state === "design" ? "design" : "starter");
    setRiskReview(null);
    setOpenedRisks([]);
  }, [resetKey]);

  /** Open the current HTML body visually, after showing any risky content. */
  const requestHtmlOpen = useCallback(() => {
    const risks = detectHtmlImportRisks(draftRef.current.body);
    if (risks.length) {
      setRiskReview(risks);
      return;
    }
    setOpenedRisks([]);
    setStartSource("html");
    setStarted(true);
  }, []);

  const flush = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    // GrapesJS ProjectData is a plain JSON object; we persist it opaquely.
    const project: Record<string, unknown> = JSON.parse(
      JSON.stringify(editor.getProjectData()),
    );
    if (modeRef.current === "html") {
      const shell = shellRef.current;
      if (!shell) return;
      const html = exportHtmlDocument(editor, shell);
      const design = buildVisualDesign({
        project,
        mjml: html,
        editor: VISUAL_HTML_EDITOR_ID,
      });
      setDraft((current) => applyVisualSave(current, design));
      setWarnings(visualHtmlWarnings(html));
      editor.clearDirtyCount();
      dirtyRef.current = false;
    } else {
      const mjml = editor.getHtml();
      const design = buildVisualDesign({
        project,
        mjml,
      });
      setDraft((current) => applyVisualSave(current, design));
      setWarnings(visualDesignWarnings(mjml));
    }
    setPending(false);
    try {
      window.localStorage.removeItem(backupKey(templateId));
    } catch {
      // storage unavailable — autosave to the server still happened
    }
  }, [disabled, setDraft, templateId]);

  const schedule = useCallback(() => {
    if (disabled) return;
    const editor = editorRef.current;
    // Loading content can emit updates; only real edits count in HTML mode.
    if (modeRef.current === "html" && editor && !editor.getDirtyCount()) return;
    setPending(true);
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
    if (modeRef.current === "html") {
      dirtyRef.current = true;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SYNC_DEBOUNCE_MS);
  }, [disabled, flush, templateId]);

  // Warn before leaving with an unsynced change.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!timerRef.current && !dirtyRef.current) return;
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
    const htmlMode =
      editorModeFor(startSource, current.visualDesign) === "html";
    modeRef.current = htmlMode ? "html" : "mjml";
    dirtyRef.current = false;
    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      undoManager: { trackSelection: false },
      // HTML mode: no GrapesJS page CSS (box-sizing etc.) — the canvas should
      // look like the email does in a client.
      ...(htmlMode ? { protectedCss: "" } : {}),
      plugins: htmlMode
        ? []
        : [
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

    let loadedDesign = false;
    let loadWarning: string | null = null;
    if (htmlMode) {
      // Body content goes into GrapesJS; doctype/head/body tags are kept aside.
      let split = splitHtmlDocument(design ? design.mjml : current.body);
      if (design?.project) {
        try {
          const project: Record<string, unknown> = JSON.parse(
            JSON.stringify(design.project),
          );
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          editor.loadProjectData(project as never);
          loadedDesign = true;
        } catch {
          loadWarning =
            "The saved visual design couldn't be loaded, so the email's current HTML was opened instead";
          split = splitHtmlDocument(current.body);
          setOpenedRisks(detectHtmlImportRisks(current.body));
        }
      }
      if (!loadedDesign) importHtmlIntoEditor(editor, split);
      const { shell } = split;
      shellRef.current = shell;
      const injectDocumentCss = () => {
        // null until the frame exists; canvas:frame:load runs this again
        const doc = editor.Canvas.getDocument();
        if (doc) applyShellToCanvas(doc, shell);
      };
      editor.on("canvas:frame:load", injectDocumentCss);
      editor.onReady(() => {
        injectDocumentCss();
        editor.clearDirtyCount();
      });
      HTML_BLOCKS.forEach(({ id, ...block }) =>
        editor.BlockManager.add(id, block),
      );
      editor.clearDirtyCount();
    } else if (design?.project) {
      try {
        // The draft store freezes state and GrapesJS mutates project data
        // while loading it, so hand it a private copy.
        const project: Record<string, unknown> = JSON.parse(
          JSON.stringify(design.project),
        );
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        editor.loadProjectData(project as never);
        loadedDesign = true;
      } catch {
        loadWarning =
          "The saved visual design couldn't be loaded, so the email's current MJML was opened instead";
      }
    }
    if (loadedDesign || htmlMode) {
      // design restored / HTML imported above
    } else if (design?.project && isMjmlBody(current.body)) {
      editor.setComponents(expandSelfClosingMjml(current.body));
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

    if (!htmlMode) addMjmlBlocks(editor);

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

    const contentWarnings = htmlMode
      ? visualHtmlWarnings(design && loadedDesign ? design.mjml : current.body)
      : visualDesignWarnings(editor.getHtml());
    setWarnings(
      loadWarning ? [loadWarning, ...contentWarnings] : contentWarnings,
    );
    // Starting from MJML or the starter writes the first design immediately.
    // HTML mode never writes on open: only the Save button changes the body.
    if (!design && !disabled && !htmlMode) flush();
    editor.on("update", schedule);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      editor.off("update", schedule);
      editor.destroy();
      editorRef.current = null;
      shellRef.current = null;
      dirtyRef.current = false;
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
  } else if (pending && mode === "html") {
    statusLabel = "Unsaved changes — click Save to update the email";
  } else if (pending) {
    statusLabel = "Unsaved changes…";
  } else if (mode === "html") {
    statusLabel = "No unsaved changes. Edits reach the email when you click Save.";
  }

  if (!started && riskReview) {
    return (
      <Stack spacing={2} sx={{ p: 3, maxWidth: 720 }}>
        <Typography variant="h6">
          Some of this email may not survive the visual editor
        </Typography>
        <Typography color="text.secondary">
          The visual editor would drop, move or rewrite these parts of the email
          body when you save. Opening it changes nothing; the body is only
          rewritten when you click Save in the editor. The email&apos;s head
          (styles, meta tags, title) is always kept exactly.
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {riskReview.map((risk) => (
            <li key={risk.id}>
              <Typography>{risk.message}</Typography>
            </li>
          ))}
        </Box>
        <Stack direction="row" spacing={1}>
          {onOpenCode ? (
            <Button
              variant="contained"
              onClick={() => {
                setRiskReview(null);
                onOpenCode();
              }}
            >
              Keep editing in the Code tab
            </Button>
          ) : null}
          <Button
            variant="outlined"
            color="warning"
            disabled={disabled}
            onClick={() => {
              setOpenedRisks(riskReview);
              setRiskReview(null);
              setStartSource("html");
              setStarted(true);
            }}
          >
            Open in visual editor anyway
          </Button>
          <Button onClick={() => setRiskReview(null)}>Cancel</Button>
        </Stack>
      </Stack>
    );
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
        {openState === "importHtml" ? (
          <>
            <Typography variant="h6">
              Open this HTML email in the visual editor
            </Typography>
            <Typography color="text.secondary">
              This template is HTML (for example, pasted from Mautic). It can be
              opened as editable blocks. The doctype, head styles, meta tags and
              title are kept exactly, and CSS is inlined when you save. Opening
              it doesn&apos;t change anything — the body is only rewritten when
              you click Save in the editor.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={disabled}
                onClick={requestHtmlOpen}
              >
                Open in visual editor
              </Button>
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
            </Stack>
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
                  if (!isMjmlBody(draftRef.current.body)) {
                    requestHtmlOpen();
                    return;
                  }
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
        {mode === "html" ? (
          <Button
            size="small"
            variant={pending ? "contained" : "outlined"}
            disabled={Boolean(disabled) || !pending}
            onClick={flush}
          >
            Save
          </Button>
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
      {mode === "html" && openedRisks.length ? (
        <Alert
          severity="warning"
          sx={{ py: 0 }}
          onClose={() => setOpenedRisks([])}
        >
          Opened with content the editor may change on save:{" "}
          {openedRisks.map((risk) => risk.message).join(" ")}
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
