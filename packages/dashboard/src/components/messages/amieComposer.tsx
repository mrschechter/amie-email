import {
  ArrowBack,
  ArrowDownward,
  ArrowUpward,
  AutoAwesome,
  DeleteOutline,
  Send,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import axios from "axios";
import { AmieAsset } from "isomorphic-lib/src/amieAssets";
import {
  AmieAssembleResponse,
  AmieBlockSpec,
  AmieComposeRequest,
  AmieComposeResponse,
  AmieSanitizeHtmlResponse,
  sanitizeAmieHtml,
} from "isomorphic-lib/src/amieComposer";
import { defaultEmailDefinition } from "isomorphic-lib/src/email";
import {
  ChannelType,
  CompletionStatus,
  EmailContentsType,
  ResourceTypeEnum,
} from "isomorphic-lib/src/types";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useAppStorePick } from "../../lib/appStore";
import {
  useAuthHeaders,
  useBaseApiUrl,
  useUniversalRouter,
} from "../../lib/authModeProvider";
import { useAmieComposerConfigQuery } from "../../lib/useAmieComposerConfigQuery";
import { useMessageTemplateQuery } from "../../lib/useMessageTemplateQuery";
import { useMessageTemplateUpdateMutation } from "../../lib/useMessageTemplateUpdateMutation";
import tokens from "../../themeCustomization/tokens";
import ImageAssetsPanel from "./imageAssetsPanel";

type ConversationMessage = NonNullable<
  AmieComposeRequest["conversation"]
>[number];

interface EditableField {
  key: string;
  label: string;
  multiline?: boolean;
  optional?: boolean;
}

function editableFields(block: AmieBlockSpec): EditableField[] {
  switch (block.type) {
    case "header":
    case "divider":
      return [];
    case "heroHeading":
      return [
        { key: "title", label: "Title" },
        { key: "subtitle", label: "Subtitle", multiline: true, optional: true },
      ];
    case "paragraph":
      return [{ key: "text", label: "Text", multiline: true }];
    case "ctaButton":
      return [
        { key: "label", label: "Button label" },
        { key: "url", label: "Button URL" },
      ];
    case "productCard":
      return [
        { key: "title", label: "Title" },
        { key: "description", label: "Description", multiline: true },
        { key: "price", label: "Price", optional: true },
        { key: "imageUrl", label: "Image URL", optional: true },
        { key: "ctaLabel", label: "Link label", optional: true },
        { key: "ctaUrl", label: "Link URL", optional: true },
      ];
    case "image":
      return [
        { key: "src", label: "Image URL" },
        { key: "alt", label: "Alt text" },
        { key: "href", label: "Link URL", optional: true },
      ];
    case "heroImage":
      return [
        { key: "src", label: "Image URL" },
        { key: "alt", label: "Alt text" },
        { key: "headline", label: "Headline", multiline: true, optional: true },
        { key: "href", label: "Link URL", optional: true },
      ];
    case "testimonial":
      return [
        { key: "quote", label: "Quote", multiline: true },
        { key: "attribution", label: "Attribution" },
      ];
    case "footer":
      return [
        { key: "addressLine", label: "Address" },
        { key: "unsubscribe", label: "Unsubscribe label" },
      ];
  }
}

function updateBlockField(
  block: AmieBlockSpec,
  field: EditableField,
  value: string,
): AmieBlockSpec {
  const params: Record<string, unknown> = { ...block.params };
  if (field.optional && value === "") {
    Reflect.deleteProperty(params, field.key);
  } else {
    params[field.key] = value;
  }
  // The editable field list above is exhaustive for each discriminated block.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return { ...block, params } as AmieBlockSpec;
}

function fieldValue(block: AmieBlockSpec, key: string): string {
  const value: unknown = Reflect.get(block.params, key);
  return typeof value === "string" ? value : "";
}

function swapBlocks(
  blocks: AmieBlockSpec[],
  firstIndex: number,
  secondIndex: number,
): AmieBlockSpec[] {
  const first = blocks[firstIndex];
  const second = blocks[secondIndex];
  if (first === undefined || second === undefined) {
    return blocks;
  }
  const next = [...blocks];
  next[firstIndex] = second;
  next[secondIndex] = first;
  return next;
}

function escapePreviewText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withPreviewText(html: string, previewText: string): string {
  const marker = 'mso-hide:all;">';
  const textStart = html.indexOf(marker);
  if (textStart === -1) {
    return html;
  }
  const valueStart = textStart + marker.length;
  const valueEnd = html.indexOf("</td></tr>", valueStart);
  if (valueEnd === -1) {
    return html;
  }
  return `${html.slice(0, valueStart)}${escapePreviewText(previewText)}${html.slice(valueEnd)}`;
}

function assistantConfirmation(revision: boolean): ConversationMessage {
  return {
    role: "assistant",
    content: revision
      ? "Done — I updated the email."
      : "Your draft is ready. Tell me what you’d like to refine.",
  };
}

function hasLiquidField(value: string): boolean {
  return /{{[\s\S]*?}}|{%[\s\S]*?%}/.test(value);
}

function hasUnsubscribeField(value: string): boolean {
  return /(?:{{[\s\S]*?unsubscribe[\s\S]*?}}|{%[\s\S]*?unsubscribe[\s\S]*?%})/i.test(
    value,
  );
}

export default function AmieComposer({
  templateId,
  templateName,
  isNew,
}: {
  templateId: string;
  templateName?: string;
  isNew?: boolean;
}) {
  const baseApiUrl = useBaseApiUrl();
  const authorization = useAuthHeaders().Authorization;
  const universalRouter = useUniversalRouter();
  const { workspace } = useAppStorePick(["workspace"]);
  const composerConfig = useAmieComposerConfigQuery();
  const templateQuery = useMessageTemplateQuery(templateId, {
    enabled: !isNew,
  });
  const { data: template } = templateQuery;
  const saveTemplate = useMessageTemplateUpdateMutation();

  const [input, setInput] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [blocks, setBlocks] = useState<AmieBlockSpec[] | null>(null);
  const [html, setHtml] = useState("");
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [isComposing, setIsComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [blockEditVersion, setBlockEditVersion] = useState(0);
  const [isAssembling, setIsAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isRawHtml, setIsRawHtml] = useState(false);
  const [pasteHtmlDialogOpen, setPasteHtmlDialogOpen] = useState(false);
  const [pastedHtml, setPastedHtml] = useState("");
  const [pasteHtmlError, setPasteHtmlError] = useState<string | null>(null);
  const [isSanitizingHtml, setIsSanitizingHtml] = useState(false);
  const [images, setImages] = useState<
    NonNullable<AmieComposeRequest["images"]>
  >([]);

  const workspaceId =
    workspace.type === CompletionStatus.Successful ? workspace.value.id : null;
  const hasDraft = blocks !== null || isRawHtml;

  const requestHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    }),
    [authorization],
  );

  const compose = useCallback(
    async (message: string) => {
      const cleanMessage = message.trim();
      if (!cleanMessage || !workspaceId || isComposing || isRawHtml) {
        return;
      }

      const revision = blocks !== null;
      const nextConversation: ConversationMessage[] = revision
        ? [...conversation, { role: "user", content: cleanMessage }]
        : [{ role: "user", content: cleanMessage }];
      const request: AmieComposeRequest = {
        workspaceId,
        prompt: revision ? originalPrompt : cleanMessage,
        ...(images.length ? { images } : {}),
        ...(revision
          ? { currentBlocks: blocks, conversation: nextConversation }
          : {}),
      };

      setIsComposing(true);
      setComposeError(null);
      setRetryMessage(cleanMessage);
      try {
        const response = await axios.post<AmieComposeResponse>(
          `${baseApiUrl}/content/templates/compose`,
          request,
          { headers: requestHeaders },
        );
        setSubject(response.data.subject);
        setPreviewText(response.data.previewText);
        setBlocks(response.data.blocks);
        setHtml(response.data.html);
        setBlockEditVersion(0);
        setConversation([...nextConversation, assistantConfirmation(revision)]);
        if (!revision) {
          setOriginalPrompt(cleanMessage);
        }
        setInput("");
        setRetryMessage(null);
      } catch {
        setComposeError(
          revision
            ? "That change didn’t go through. Your draft is untouched."
            : "The draft couldn’t be composed just now.",
        );
      } finally {
        setIsComposing(false);
      }
    },
    [
      baseApiUrl,
      blocks,
      conversation,
      isComposing,
      originalPrompt,
      requestHeaders,
      isRawHtml,
      images,
      workspaceId,
    ],
  );

  const attachImage = useCallback((asset: AmieAsset) => {
    setImages((current) =>
      current.some((image) => image.url === asset.url)
        ? current
        : [...current, { url: asset.url, alt: "" }],
    );
  }, []);

  const handlePasteHtml = async () => {
    if (!workspaceId || !pastedHtml.trim() || isSanitizingHtml) {
      return;
    }

    const clientSanitizedHtml = sanitizeAmieHtml(pastedHtml);
    if (!clientSanitizedHtml.trim()) {
      setPasteHtmlError("The pasted content did not contain usable HTML.");
      return;
    }

    setIsSanitizingHtml(true);
    setPasteHtmlError(null);
    try {
      const response = await axios.post<AmieSanitizeHtmlResponse>(
        `${baseApiUrl}/content/templates/compose/sanitize-html`,
        { workspaceId, html: clientSanitizedHtml },
        { headers: requestHeaders },
      );
      setHtml(response.data.html);
      setBlocks(null);
      setIsRawHtml(true);
      setPreviewText("");
      setConversation([]);
      setInput("");
      setComposeError(null);
      setAssembleError(null);
      setPastedHtml("");
      setPasteHtmlDialogOpen(false);
    } catch {
      setPasteHtmlError("The HTML couldn’t be prepared. Please try again.");
    } finally {
      setIsSanitizingHtml(false);
    }
  };

  useEffect(() => {
    if (!blocks || blockEditVersion === 0 || !workspaceId) {
      return undefined;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsAssembling(true);
      setAssembleError(null);
      try {
        const response = await axios.post<AmieAssembleResponse>(
          `${baseApiUrl}/content/templates/compose/assemble`,
          { workspaceId, blocks },
          { headers: requestHeaders, signal: controller.signal },
        );
        setHtml(withPreviewText(response.data.html, previewText));
      } catch (error) {
        if (!axios.isCancel(error)) {
          setAssembleError("Preview refresh paused. Edit again or retry.");
        }
      } finally {
        setIsAssembling(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    baseApiUrl,
    blockEditVersion,
    blocks,
    previewText,
    requestHeaders,
    workspaceId,
  ]);

  const editBlocks = useCallback(
    (updater: (current: AmieBlockSpec[]) => AmieBlockSpec[]) => {
      setBlocks((current) => (current ? updater(current) : current));
      setBlockEditVersion((version) => version + 1);
    },
    [],
  );

  const handleSave = async () => {
    if (
      !hasDraft ||
      !workspaceId ||
      !subject.trim() ||
      (!isNew && templateQuery.isLoading)
    ) {
      return;
    }
    setSaveError(null);
    try {
      let body = html;
      if (!isRawHtml) {
        if (!blocks) {
          return;
        }
        const assembled = await axios.post<AmieAssembleResponse>(
          `${baseApiUrl}/content/templates/compose/assemble`,
          { workspaceId, blocks },
          { headers: requestHeaders },
        );
        body = withPreviewText(assembled.data.html, previewText);
      }
      const existingDefinition = template?.definition ?? template?.draft;
      const baseDefinition =
        existingDefinition?.type === ChannelType.Email
          ? existingDefinition
          : defaultEmailDefinition({
              emailContentsType: EmailContentsType.Code,
            });
      const saved = await saveTemplate.mutateAsync({
        id: templateId,
        name:
          template?.name ??
          templateName?.trim() ??
          (subject.trim() || "AI email"),
        definition: {
          ...baseDefinition,
          type: ChannelType.Email,
          emailContentsType: EmailContentsType.Code,
          subject: subject.trim(),
          body,
        },
        ...(isNew ? { resourceType: ResourceTypeEnum.Declarative } : {}),
      });
      universalRouter.push(`/templates/email/${saved.id}`);
    } catch {
      setSaveError("The template wasn’t saved. Nothing was lost — try again.");
    }
  };

  const goBack = () => {
    universalRouter.push(
      isNew ? "/templates" : `/templates/email/${templateId}`,
    );
  };

  if (!composerConfig.data?.enabled) {
    return null;
  }

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ pb: 2 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <IconButton onClick={goBack} aria-label="Back to template">
            <ArrowBack />
          </IconButton>
          <Box>
            <Typography
              sx={{
                color: tokens.colors.heading,
                fontFamily: tokens.typography.displayFontFamily,
                fontSize: 27,
                fontWeight: 600,
                lineHeight: 1.15,
              }}
            >
              Compose with AI
            </Typography>
            <Typography variant="body2" sx={{ color: tokens.colors.caption }}>
              Shape a polished Amie email, then fine-tune every block.
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={
            !hasDraft ||
            !subject.trim() ||
            isComposing ||
            isAssembling ||
            saveTemplate.isPending ||
            (!isNew && templateQuery.isLoading)
          }
          startIcon={
            saveTemplate.isPending ? <CircularProgress size={16} /> : null
          }
        >
          {saveTemplate.isPending ? "Saving…" : "Save as template"}
        </Button>
      </Stack>

      {saveError && (
        <Typography
          variant="body2"
          sx={{ color: tokens.colors.roseText, mb: 1 }}
        >
          {saveError}{" "}
          <Button size="small" onClick={handleSave}>
            Retry
          </Button>
        </Typography>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(320px, 0.8fr) minmax(0, 1.4fr)",
          },
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          border: `1px solid ${tokens.colors.borderCard}`,
          borderRadius: `${tokens.radii.card}px`,
          boxShadow: tokens.shadows.medium,
          backgroundColor: tokens.colors.surface,
        }}
      >
        <Stack
          sx={{
            minHeight: 0,
            borderRight: { lg: `1px solid ${tokens.colors.chromeDivider}` },
            backgroundColor: tokens.colors.ivory,
          }}
        >
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 3 }}>
            {!hasDraft && (
              <Stack spacing={2.5} sx={{ maxWidth: 440, mx: "auto", pt: 5 }}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    color: tokens.colors.deepTeal,
                    backgroundColor: tokens.colors.tealTint,
                  }}
                >
                  <AutoAwesome />
                </Box>
                <Box>
                  <Typography
                    sx={{
                      color: tokens.colors.heading,
                      fontFamily: tokens.typography.displayFontFamily,
                      fontSize: 24,
                      fontWeight: 600,
                    }}
                  >
                    What are we writing?
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: tokens.colors.caption, mt: 0.5 }}
                  >
                    Include the goal, audience, offer, and any must-have
                    details.
                  </Typography>
                </Box>
                <TextField
                  multiline
                  minRows={7}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Describe the email…"
                  disabled={isComposing}
                  fullWidth
                />
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Stack direction="row" spacing={0.5}>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        setPasteHtmlError(null);
                        setPasteHtmlDialogOpen(true);
                      }}
                      sx={{ color: tokens.colors.caption }}
                    >
                      Paste HTML
                    </Button>
                    <ImageAssetsPanel
                      label="Add image"
                      onInsert={attachImage}
                      onUploaded={attachImage}
                    />
                  </Stack>
                  <Button
                    variant="contained"
                    onClick={() => compose(input)}
                    disabled={!input.trim() || isComposing || !workspaceId}
                    endIcon={<Send fontSize="small" />}
                  >
                    Send
                  </Button>
                </Stack>
              </Stack>
            )}
            {hasDraft && isRawHtml && (
              <Paper
                variant="outlined"
                sx={{ p: 2, borderColor: tokens.colors.borderCard }}
              >
                <Typography
                  sx={{ color: tokens.colors.heading, fontWeight: 600 }}
                >
                  Raw HTML template
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: tokens.colors.caption, mt: 0.5 }}
                >
                  AI editing is unavailable for pasted HTML.
                </Typography>
              </Paper>
            )}
            {hasDraft && !isRawHtml && (
              <Stack spacing={2}>
                {conversation.map((message, index) => (
                  <Box
                    // Conversation order is stable and messages have no server IDs.
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    sx={{
                      alignSelf:
                        message.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "88%",
                      px: 1.75,
                      py: 1.25,
                      borderRadius: `${tokens.radii.card}px`,
                      color:
                        message.role === "user"
                          ? tokens.colors.surface
                          : tokens.colors.text,
                      backgroundColor:
                        message.role === "user"
                          ? tokens.colors.deepTeal
                          : tokens.colors.surface,
                      border:
                        message.role === "assistant"
                          ? `1px solid ${tokens.colors.borderSoft}`
                          : "none",
                      boxShadow:
                        message.role === "assistant"
                          ? tokens.shadows.small
                          : "none",
                    }}
                  >
                    <Typography variant="body2">{message.content}</Typography>
                  </Box>
                ))}
              </Stack>
            )}

            {isComposing && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mt: 2 }}
              >
                <CircularProgress
                  size={17}
                  sx={{ color: tokens.colors.deepTeal }}
                />
                <Typography
                  variant="body2"
                  sx={{ color: tokens.colors.deepTeal, fontWeight: 600 }}
                >
                  Composing…
                </Typography>
              </Stack>
            )}

            {composeError && (
              <Typography
                variant="body2"
                sx={{ color: tokens.colors.roseText, mt: 2 }}
              >
                {composeError}{" "}
                <Button
                  size="small"
                  onClick={() => retryMessage && compose(retryMessage)}
                  disabled={!retryMessage || isComposing}
                >
                  Retry
                </Button>
              </Typography>
            )}
          </Box>

          {hasDraft && (
            <Box
              sx={{
                p: 2,
                borderTop: `1px solid ${tokens.colors.chromeDivider}`,
              }}
            >
              <TextField
                multiline
                minRows={3}
                maxRows={6}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  isRawHtml
                    ? "AI editing is unavailable for pasted HTML"
                    : "Tell it what to change…"
                }
                disabled={isComposing || isRawHtml}
                fullWidth
              />
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                {!isRawHtml && (
                  <ImageAssetsPanel
                    label="Add image"
                    onInsert={attachImage}
                    onUploaded={attachImage}
                    disabled={isComposing}
                  />
                )}
                <Button
                  variant="contained"
                  onClick={() => compose(input)}
                  disabled={!input.trim() || isComposing || isRawHtml}
                  endIcon={<Send fontSize="small" />}
                >
                  Send
                </Button>
              </Stack>
            </Box>
          )}
        </Stack>

        <Box
          sx={{
            minHeight: 0,
            overflowY: "auto",
            backgroundColor: tokens.colors.surfaceWarm,
          }}
        >
          <Stack spacing={2.5} sx={{ p: { xs: 2, md: 3 } }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={!hasDraft}
                fullWidth
                size="small"
              />
              <TextField
                label="Preview text"
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                disabled={!hasDraft || isRawHtml}
                helperText={
                  isRawHtml
                    ? "Use the pasted HTML’s own preview text."
                    : undefined
                }
                fullWidth
                size="small"
              />
            </Stack>

            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography
                variant="overline"
                sx={{ color: tokens.colors.faint }}
              >
                Live preview
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={previewWidth}
                onChange={(_event, value: "desktop" | "mobile" | null) => {
                  if (value) setPreviewWidth(value);
                }}
              >
                <ToggleButton value="desktop">Desktop</ToggleButton>
                <ToggleButton value="mobile">Mobile</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <Box sx={{ overflowX: "auto", pb: 0.5 }}>
              <Paper
                sx={{
                  width: previewWidth === "desktop" ? 600 : 375,
                  maxWidth: "100%",
                  mx: "auto",
                  overflow: "hidden",
                  borderRadius: `${tokens.radii.card}px`,
                  border: `1px solid ${tokens.colors.borderCard}`,
                  boxShadow: tokens.shadows.medium,
                  backgroundColor: tokens.colors.emailPreview,
                }}
              >
                {html ? (
                  <iframe
                    sandbox=""
                    srcDoc={html}
                    title="Composed email preview"
                    style={{
                      display: "block",
                      width: "100%",
                      height: 700,
                      border: 0,
                    }}
                  />
                ) : (
                  <Stack
                    alignItems="center"
                    justifyContent="center"
                    sx={{ height: 520, px: 4 }}
                  >
                    <AutoAwesome
                      sx={{ color: tokens.colors.placeholder, mb: 1 }}
                    />
                    <Typography
                      variant="body2"
                      align="center"
                      sx={{ color: tokens.colors.hint }}
                    >
                      Your email preview will appear here.
                    </Typography>
                  </Stack>
                )}
              </Paper>
            </Box>

            {isRawHtml && (
              <Paper
                variant="outlined"
                sx={{ p: 2, borderColor: tokens.colors.borderCard }}
              >
                <Typography
                  sx={{ color: tokens.colors.heading, fontWeight: 600 }}
                >
                  Raw HTML template
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: tokens.colors.caption, mt: 0.5 }}
                >
                  This preview uses your pasted HTML directly. The block editor
                  does not apply to this template.
                </Typography>
              </Paper>
            )}

            {blocks && (
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Box>
                    <Typography
                      sx={{ color: tokens.colors.heading, fontWeight: 600 }}
                    >
                      Email blocks
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: tokens.colors.caption }}
                    >
                      Edit copy, reorder sections, or remove anything you don’t
                      need.
                    </Typography>
                  </Box>
                  {isAssembling && (
                    <Typography
                      variant="caption"
                      sx={{ color: tokens.colors.deepTeal }}
                    >
                      Refreshing preview…
                    </Typography>
                  )}
                </Stack>

                {assembleError && (
                  <Typography
                    variant="body2"
                    sx={{ color: tokens.colors.roseText }}
                  >
                    {assembleError}{" "}
                    <Button
                      size="small"
                      onClick={() =>
                        setBlockEditVersion((version) => version + 1)
                      }
                    >
                      Retry
                    </Button>
                  </Typography>
                )}

                {blocks.map((block, index) => (
                  // Reordering means a positional key reflects the visible order.
                  // eslint-disable-next-line react/no-array-index-key
                  <React.Fragment key={`${block.type}-${index}`}>
                    <Paper
                      variant="outlined"
                      sx={{ p: 2, borderColor: tokens.colors.borderCard }}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ mb: editableFields(block).length ? 1.5 : 0 }}
                      >
                        <Typography
                          variant="overline"
                          sx={{
                            color: tokens.colors.deepTeal,
                            fontWeight: 700,
                          }}
                        >
                          {block.type}
                        </Typography>
                        <Stack direction="row" spacing={0.25}>
                          <Tooltip title="Move up">
                            <span>
                              <IconButton
                                size="small"
                                disabled={index === 0}
                                onClick={() =>
                                  editBlocks((current) =>
                                    swapBlocks(current, index - 1, index),
                                  )
                                }
                              >
                                <ArrowUpward fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Move down">
                            <span>
                              <IconButton
                                size="small"
                                disabled={index === blocks.length - 1}
                                onClick={() =>
                                  editBlocks((current) =>
                                    swapBlocks(current, index, index + 1),
                                  )
                                }
                              >
                                <ArrowDownward fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Delete block">
                            <IconButton
                              size="small"
                              onClick={() =>
                                editBlocks((current) =>
                                  current.filter(
                                    (_item, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                              sx={{ color: tokens.colors.roseGold }}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Stack>

                      <Stack spacing={1.25}>
                        {editableFields(block).map((field) => (
                          <TextField
                            key={field.key}
                            label={field.label}
                            value={fieldValue(block, field.key)}
                            multiline={field.multiline}
                            minRows={field.multiline ? 2 : undefined}
                            size="small"
                            fullWidth
                            onChange={(event) =>
                              editBlocks((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? updateBlockField(
                                        item,
                                        field,
                                        event.target.value,
                                      )
                                    : item,
                                ),
                              )
                            }
                          />
                        ))}
                      </Stack>
                    </Paper>
                    {index < blocks.length - 1 && (
                      <Box sx={{ display: "flex", justifyContent: "center" }}>
                        <ImageAssetsPanel
                          label="Insert image block"
                          onInsert={(asset) => {
                            attachImage(asset);
                            editBlocks((current) => [
                              ...current.slice(0, index + 1),
                              {
                                type: "image",
                                params: { src: asset.url, alt: "", width: 600 },
                              },
                              ...current.slice(index + 1),
                            ]);
                          }}
                          onUploaded={attachImage}
                        />
                      </Box>
                    )}
                  </React.Fragment>
                ))}
              </Stack>
            )}
          </Stack>
        </Box>
      </Box>

      <Dialog
        open={pasteHtmlDialogOpen}
        onClose={() => {
          if (!isSanitizingHtml) {
            setPasteHtmlDialogOpen(false);
          }
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Paste email HTML</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2" sx={{ color: tokens.colors.caption }}>
              Paste the complete email markup. Scripts and inline event handlers
              will be removed.
            </Typography>
            <TextField
              autoFocus
              multiline
              minRows={12}
              value={pastedHtml}
              onChange={(event) => {
                setPastedHtml(event.target.value);
                setPasteHtmlError(null);
              }}
              placeholder="<!doctype html>…"
              disabled={isSanitizingHtml}
              fullWidth
              inputProps={{ "aria-label": "Email HTML" }}
            />
            {pastedHtml.length > 0 && !hasUnsubscribeField(pastedHtml) && (
              <Alert severity="warning">
                No unsubscribe merge tag was found. You can still use this HTML,
                but marketing emails should include one.
              </Alert>
            )}
            {pastedHtml.length > 0 && !hasLiquidField(pastedHtml) && (
              <Alert severity="warning">
                No Liquid fields using {"{{ }}"} or {"{% %}"} were found.
              </Alert>
            )}
            {pasteHtmlError && <Alert severity="error">{pasteHtmlError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPasteHtmlDialogOpen(false)}
            disabled={isSanitizingHtml}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handlePasteHtml}
            disabled={!pastedHtml.trim() || !workspaceId || isSanitizingHtml}
            startIcon={isSanitizingHtml ? <CircularProgress size={16} /> : null}
          >
            {isSanitizingHtml ? "Preparing…" : "Use HTML"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
