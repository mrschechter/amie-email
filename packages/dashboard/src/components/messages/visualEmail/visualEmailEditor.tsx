import "grapesjs/dist/css/grapes.min.css";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import axios from "axios";
import grapesjs, { Editor } from "grapesjs";
import grapesjsMjml from "grapesjs-mjml";
import {
  AmieAsset,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";
import { AMIE_PLACEHOLDER_IMAGE_URL } from "isomorphic-lib/src/amieLinks";
import {
  readPreviewText,
  stripLegacyMjmlPreview,
  writePreviewText,
} from "isomorphic-lib/src/emailPreviewText";
import { CodeEmailContents, VisualEmailDesign } from "isomorphic-lib/src/types";
import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  configureHtmlModeComponents,
  installImageSettings,
  repairComponentLinks,
} from "./visualEmailComponents";
import { convertMjmlToHtml, readMjmlBackup } from "./visualEmailConvert";
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
import { installCanvasFonts, withMjmlFonts } from "./visualEmailFonts";
import {
  applyShellToCanvas,
  detectHtmlImportRisks,
  exportHtmlDocument,
  HTML_BLOCKS,
  HtmlImportRisk,
  HtmlShell,
  importHtmlIntoEditor,
  splitHtmlDocument,
  STARTER_HTML,
} from "./visualEmailHtml";
import {
  countBrokenLiquidLinks,
  repairLiquidLinks,
  validateHref,
} from "./visualEmailLinks";
import {
  hasSyncContent,
  installRichTextToolbar,
  LinkOptions,
  RTE_CHANGE_EVENT,
  RTE_TOOLBAR_CSS,
} from "./visualEmailRte";
import {
  visualDesignWarnings,
  visualHtmlWarnings,
} from "./visualEmailWarnings";

type StartSource =
  | "design"
  | "mjml"
  | "html"
  | "starter"
  | "htmlStarter"
  | "htmlConverted";
type NewDesignKind = "html" | "mjml";
type EditorMode = "mjml" | "html";

function editorModeFor(
  source: StartSource,
  design: CodeEmailContents["visualDesign"],
): EditorMode {
  if (
    source === "html" ||
    source === "htmlStarter" ||
    source === "htmlConverted"
  ) {
    return "html";
  }
  if (
    source === "design" &&
    visualDesignEditor(design) === VISUAL_HTML_EDITOR_ID
  ) {
    return "html";
  }
  return "mjml";
}

const SYNC_DEBOUNCE_MS = 700;

/** Liquid URL tags offered in the link dialog (same forms as the variables list). */
const LINK_VARIABLES = VISUAL_EMAIL_VARIABLES.filter((v) =>
  v.value.startsWith("{%"),
);

interface LinkDialogState {
  href: string;
  newTab: boolean;
  editing: boolean;
  apply: (link: LinkOptions | null) => void;
}

const TOOLBAR_STYLE_ID = "amie-rte-toolbar-css";

/**
 * The template's preview text (set in the Subject / Settings panel) lives in
 * the body. Every visual save carries it over into what the editor wrote —
 * `<mj-preview>` for MJML, the hidden preheader for HTML — so a visual save
 * never drops or duplicates it.
 */
function withDraftPreview(
  design: VisualEmailDesign,
  current: CodeEmailContents,
): VisualEmailDesign {
  return {
    ...design,
    mjml: writePreviewText(design.mjml, readPreviewText(current.body)),
  };
}

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
  // A blank template shows the HTML/MJML choice first; nothing is written
  // until a design is started.
  const [started, setStarted] = useState(() => openState === "design");
  const [startSource, setStartSource] = useState<StartSource>(
    openState === "design" ? "design" : "starter",
  );
  const [pending, setPending] = useState(false);
  // Liquid links mangled into dashboard URLs, found on open; Save repairs them.
  const [repairableLinks, setRepairableLinks] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<string | null>(null);
  // HTML mode: risky content found before opening, awaiting the user's choice.
  const [riskReview, setRiskReview] = useState<HtmlImportRisk[] | null>(null);
  const [openedRisks, setOpenedRisks] = useState<HtmlImportRisk[]>([]);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const [newKind, setNewKind] = useState<NewDesignKind>("html");
  // Convert to HTML: the confirm dialog's answer, and the compiled HTML the
  // re-initialised HTML editor opens.
  const [convertPrompt, setConvertPrompt] = useState<
    ((ok: boolean) => void) | null
  >(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const convertedHtmlRef = useRef<string | null>(null);
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
    setStarted(state === "design");
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

  /**
   * Write the editor's design to the draft. `repair` restores Liquid links
   * that were mangled into dashboard URLs — explicit saves only, never the
   * automatic first write when an MJML email is opened.
   */
  const saveDesign = useCallback(
    (repair: boolean) => {
      const editor = editorRef.current;
      if (!editor || disabled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      const run = () => {
        if (repair) {
          repairComponentLinks(editor);
          setRepairableLinks(0);
        }
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
          setDraft((current) =>
            applyVisualSave(current, withDraftPreview(design, current)),
          );
          setWarnings(visualHtmlWarnings(html));
          editor.clearDirtyCount();
          dirtyRef.current = false;
        } else {
          // declares Montserrat with <mj-font> when the email uses it
          const fonts = withMjmlFonts(editor.getHtml());
          const mjml = repair ? repairLiquidLinks(fonts).markup : fonts;
          const design = buildVisualDesign({
            project,
            mjml,
          });
          setDraft((current) =>
            applyVisualSave(current, withDraftPreview(design, current)),
          );
          setWarnings(visualDesignWarnings(mjml));
        }
        setPending(false);
        try {
          window.localStorage.removeItem(backupKey(templateId));
        } catch {
          // storage unavailable — autosave to the server still happened
        }
      };
      // HTML mode: text being edited right now is written to the model first,
      // so a toolbar edit (link, color …) isn't lost when Save is clicked.
      const view: unknown =
        modeRef.current === "html" ? editor.getSelected()?.getView() : null;
      if (hasSyncContent(view)) {
        void view.syncContent().then(run);
      } else {
        run();
      }
    },
    [disabled, setDraft, templateId],
  );

  const flush = useCallback(() => saveDesign(true), [saveDesign]);

  const schedule = useCallback(
    (force = false) => {
      if (disabled) return;
      const editor = editorRef.current;
      // Loading content can emit updates; only real edits count in HTML mode.
      // Toolbar edits (`force`) don't change GrapesJS's dirty count.
      if (
        !force &&
        modeRef.current === "html" &&
        editor &&
        !editor.getDirtyCount()
      ) {
        return;
      }
      setPending(true);
      if (editor) {
        try {
          window.localStorage.setItem(
            backupKey(templateId),
            JSON.stringify({
              at: Date.now(),
              project: editor.getProjectData(),
            }),
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
    },
    [disabled, flush, templateId],
  );

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

    // Component types and toolbar go in before any content loads, so
    // imported images/cells pick them up.
    if (htmlMode) configureHtmlModeComponents(editor);
    else installImageSettings(editor, "mjml");
    installCanvasFonts(editor);
    installRichTextToolbar(editor, {
      mode: htmlMode ? "html" : "mjml",
      openLinkDialog: (existing, apply) =>
        setLinkDialog({
          href: existing?.href ?? "",
          newTab: existing ? existing.target === "_blank" : true,
          editing: Boolean(existing),
          apply,
        }),
    });
    if (!document.getElementById(TOOLBAR_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = TOOLBAR_STYLE_ID;
      style.textContent = RTE_TOOLBAR_CSS;
      document.head.appendChild(style);
    }

    let loadedDesign = false;
    let loadWarning: string | null = null;
    if (htmlMode) {
      // Body content goes into GrapesJS; doctype/head/body tags are kept aside.
      let htmlSource = design ? design.mjml : current.body;
      if (startSource === "htmlStarter") htmlSource = STARTER_HTML;
      if (startSource === "htmlConverted") {
        htmlSource = convertedHtmlRef.current ?? current.body;
      }
      let split = splitHtmlDocument(htmlSource);
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
      editor.setComponents(
        expandSelfClosingMjml(stripLegacyMjmlPreview(current.body)),
      );
    } else if (startSource === "mjml" && current.body) {
      editor.setComponents(
        expandSelfClosingMjml(stripLegacyMjmlPreview(current.body)),
      );
    } else {
      editor.setComponents(STARTER_MJML);
    }

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
    if (!design && !disabled && !htmlMode) saveDesign(false);
    let openedMarkup = editor.getHtml();
    if (htmlMode)
      openedMarkup = design && loadedDesign ? design.mjml : current.body;
    const broken = countBrokenLiquidLinks(openedMarkup);
    setRepairableLinks(broken);
    // A new HTML design or a confirmed conversion is an explicit action, so
    // it writes the HTML document right away (opening an email never does).
    if (
      !disabled &&
      (startSource === "htmlStarter" || startSource === "htmlConverted")
    ) {
      flush();
      convertedHtmlRef.current = null;
    }
    const onUpdate = () => schedule(false);
    editor.on("update", onUpdate);
    // Toolbar actions and paste edit the DOM without GrapesJS counting a
    // change: mark the edit, and save (MJML) once the text is synced back to
    // the model when editing stops.
    let rteEdited = false;
    const onRteChange = () => {
      rteEdited = true;
      schedule(true);
    };
    const onRteDisable = () => {
      if (!rteEdited) return;
      rteEdited = false;
      setTimeout(() => schedule(true), 50);
    };
    const listenCanvas = () => {
      const doc = editor.Canvas.getDocument();
      doc?.removeEventListener(RTE_CHANGE_EVENT, onRteChange);
      doc?.addEventListener(RTE_CHANGE_EVENT, onRteChange);
    };
    editor.on("canvas:frame:load", listenCanvas);
    editor.onReady(listenCanvas);
    editor.on("rte:disable", onRteDisable);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      editor.off("update", onUpdate);
      editor.off("rte:disable", onRteDisable);
      editor.Canvas.getDocument()?.removeEventListener(
        RTE_CHANGE_EVENT,
        onRteChange,
      );
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
    statusLabel =
      "No unsaved changes. Edits reach the email when you click Save.";
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

  const startNewDesign = (replaces: boolean) => {
    if (
      replaces &&
      !window.confirm(
        "Start a new visual design? This replaces the current email body.",
      )
    ) {
      return;
    }
    setStartSource(newKind === "html" ? "htmlStarter" : "starter");
    setStarted(true);
  };

  const newDesignChooser = (replaces: boolean) => (
    <Stack spacing={1.5} data-testid="new-visual-design">
      <Typography variant={replaces ? "subtitle1" : "h6"}>
        Start a new visual design
      </Typography>
      <RadioGroup
        value={newKind}
        onChange={(event) =>
          setNewKind(event.target.value === "mjml" ? "mjml" : "html")
        }
      >
        <FormControlLabel
          value="html"
          control={<Radio />}
          label="HTML email (recommended) — the Code tab shows editable HTML"
        />
        <FormControlLabel
          value="mjml"
          control={<Radio />}
          label="MJML email — the Code tab shows MJML"
        />
      </RadioGroup>
      <Box>
        <Button
          variant={replaces ? "outlined" : "contained"}
          color={replaces ? "warning" : "primary"}
          disabled={disabled}
          onClick={() => startNewDesign(replaces)}
        >
          Start a new visual design
        </Button>
      </Box>
    </Stack>
  );

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
            </Stack>
            {newDesignChooser(true)}
          </>
        ) : null}
        {openState === "blank" ? newDesignChooser(false) : null}
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

  const convertToHtml = async () => {
    const editor = editorRef.current;
    if (!editor || disabled || modeRef.current !== "mjml") return;
    setConvertError(null);
    // keep the latest edits in the MJML that's backed up and converted
    flush();
    const mjml = withMjmlFonts(editor.getHtml());
    const result = await convertMjmlToHtml({
      templateId,
      mjml,
      visualDesign: draftRef.current.visualDesign,
      confirm: () =>
        new Promise<boolean>((resolve) => {
          setConvertPrompt(() => resolve);
        }),
      compile: async (source) => {
        setConverting(true);
        try {
          const response = await axios.post<{ html: string }>(
            `${baseApiUrl}/content/templates/mjml-to-html`,
            { workspaceId, mjml: source },
            { headers: authHeaders },
          );
          return { ok: true, html: response.data.html };
        } catch (e) {
          const message =
            axios.isAxiosError<{ message?: string }>(e) &&
            e.response?.data.message
              ? e.response.data.message
              : "The email couldn't be converted. Nothing was changed.";
          return { ok: false, message };
        } finally {
          setConverting(false);
        }
      },
    });
    if (result.status === "error") setConvertError(result.message);
    if (result.status === "converted") {
      convertedHtmlRef.current = result.html;
      setStartSource("htmlConverted");
    }
  };

  const answerConvert = (ok: boolean) => {
    convertPrompt?.(ok);
    setConvertPrompt(null);
  };

  const convertDialogEl = (
    <Dialog
      open={Boolean(convertPrompt)}
      onClose={() => answerConvert(false)}
      maxWidth="sm"
    >
      <DialogTitle>Convert to an HTML email?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography>
            This turns the email into an HTML email, compiled exactly as it
            would be sent. The Code tab will show HTML you can edit, and the
            visual editor keeps working in HTML mode.
          </Typography>
          <Typography>
            <b>This is one-way</b> — it won&apos;t turn back into MJML blocks.
            The current MJML is kept as a backup in this browser (you can
            restore it from the editor toolbar), and the published version
            doesn&apos;t change until you publish.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => answerConvert(false)}>Cancel</Button>
        <Button variant="contained" onClick={() => answerConvert(true)}>
          Convert to HTML email
        </Button>
      </DialogActions>
    </Dialog>
  );

  const mjmlBackup =
    mode === "html" && draft.visualDesign?.editor === VISUAL_HTML_EDITOR_ID
      ? readMjmlBackup(templateId)
      : null;
  const restoreMjml = () => {
    if (!mjmlBackup) return;
    if (
      !window.confirm(
        "Restore the MJML version from before the conversion? The current HTML email is replaced.",
      )
    ) {
      return;
    }
    setDraft((current) => ({
      ...current,
      body: mjmlBackup.body,
      visualDesign: mjmlBackup.visualDesign ?? null,
    }));
    setStartSource(mjmlBackup.visualDesign ? "design" : "mjml");
  };

  const linkDialogError = linkDialog?.href.trim()
    ? validateHref(linkDialog.href)
    : null;

  const linkDialogEl = (
    <Dialog
      open={Boolean(linkDialog)}
      onClose={() => setLinkDialog(null)}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>
        {linkDialog?.editing ? "Edit link" : "Insert link"}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            label="Link URL"
            // plain text, not type="url": Liquid like {% unsubscribe_url %}
            // isn't a URL and must be stored exactly as typed
            type="text"
            placeholder="https://tryamie.com/… or {% unsubscribe_url %}"
            value={linkDialog?.href ?? ""}
            error={Boolean(linkDialogError)}
            helperText={
              linkDialogError ??
              "Web link, mailto:, tel:, or a Liquid tag — saved exactly as typed."
            }
            onChange={(event) =>
              setLinkDialog((d) => (d ? { ...d, href: event.target.value } : d))
            }
          />
          <TextField
            select
            label="Or use a link variable"
            value=""
            onChange={(event) =>
              setLinkDialog((d) => (d ? { ...d, href: event.target.value } : d))
            }
          >
            {LINK_VARIABLES.map((v) => (
              <MenuItem key={v.value} value={v.value}>
                {v.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={linkDialog?.newTab ?? true}
                onChange={(event) =>
                  setLinkDialog((d) =>
                    d ? { ...d, newTab: event.target.checked } : d,
                  )
                }
              />
            }
            label="Open in a new tab"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {linkDialog?.editing ? (
          <Button
            color="warning"
            onClick={() => {
              linkDialog.apply(null);
              setLinkDialog(null);
            }}
          >
            Remove link
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => setLinkDialog(null)}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!linkDialog?.href.trim() || Boolean(linkDialogError)}
          onClick={() => {
            if (!linkDialog) return;
            linkDialog.apply({
              href: linkDialog.href.trim(),
              target: linkDialog.newTab ? "_blank" : "",
            });
            setLinkDialog(null);
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );

  return (
    <Stack sx={{ height: "100%" }} data-testid="visual-email-editor">
      {linkDialogEl}
      {convertDialogEl}
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
        <TextField
          size="small"
          placeholder="Preview text (shown after the subject in the inbox)"
          inputProps={{ "aria-label": "Preview text" }}
          value={readPreviewText(draft.body)}
          disabled={Boolean(disabled)}
          // Same field as Subject / Settings: stored in the body
          // (<mj-preview> or the hidden preheader); every save keeps it.
          onChange={(event) => {
            const { value } = event.target;
            setDraft((current) => ({
              ...current,
              body: writePreviewText(current.body, value),
            }));
          }}
          sx={{
            width: 340,
            "& .MuiInputBase-input": { fontSize: 12.5, py: 0.5 },
          }}
        />
        {!hasUnsubscribeLink(draft.body) ? (
          <Typography sx={{ fontSize: 12.5, color: "#B76E79" }}>
            Add an unsubscribe link before sending
          </Typography>
        ) : null}
        {mode === "mjml" && !disabled ? (
          <Button
            size="small"
            variant="outlined"
            disabled={converting}
            onClick={() => {
              void convertToHtml();
            }}
          >
            {converting ? "Converting…" : "Convert to HTML email"}
          </Button>
        ) : null}
        {mjmlBackup && !disabled ? (
          <Button size="small" color="warning" onClick={restoreMjml}>
            Restore MJML version
          </Button>
        ) : null}
        {mode === "html" ? (
          <Button
            size="small"
            variant={pending || repairableLinks ? "contained" : "outlined"}
            disabled={Boolean(disabled) || (!pending && !repairableLinks)}
            onClick={flush}
          >
            Save
          </Button>
        ) : null}
      </Stack>
      {convertError ? (
        <Alert severity="error" onClose={() => setConvertError(null)}>
          {convertError}
        </Alert>
      ) : null}
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
