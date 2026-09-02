import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { ArrowUpward, AutoAwesome } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ReactCodeMirror from "@uiw/react-codemirror";
import axios from "axios";
import {
  AmieAsset,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";
import {
  AmieBlockSpec,
  AmieComposeRequest,
  AmieComposeResponse,
} from "isomorphic-lib/src/amieComposer";
import {
  ChannelType,
  CodeEmailTemplateResource,
  CompletionStatus,
  EmailContentsType,
  MessageTemplateResourceDraft,
  ResourceTypeEnum,
} from "isomorphic-lib/src/types";
import Link from "next/link";
import React, {
  FormEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAppStorePick } from "../../lib/appStore";
import { useAuthHeaders, useBaseApiUrl } from "../../lib/authModeProvider";
import { useAmieComposerConfigQuery } from "../../lib/useAmieComposerConfigQuery";
import { useMessageTemplateUpdateMutation } from "../../lib/useMessageTemplateUpdateMutation";
import { PublisherStatusType } from "../publisher";
import { TemplateEditorLayoutParams } from "../templateEditor";
import { previewTextFromHtml, withPreviewText } from "./amieComposerHtml";
import ImageAssetsPanel from "./imageAssetsPanel";

const COLORS = {
  page: "#FAF8F5",
  text: "#4A4A4A",
  heading: "#3E3733",
  teal: "#2D7A7A",
  tealDark: "#256868",
  caption: "#A39B93",
  muted: "#8A8178",
  blush: "#F5E6E0",
  warm: "#FDFBF8",
  preview: "#F1EBE3",
  border: "#E6E1DA",
  borderSoft: "#F2EBE2",
  successBg: "#EFF3EA",
  success: "#5F7350",
};

type EditorTab = "compose" | "code" | "settings";
type PreviewWidth = "desktop" | "mobile";
type ConversationMessage = NonNullable<
  AmieComposeRequest["conversation"]
>[number];

interface DisplayMessage extends ConversationMessage {
  id: string;
  href?: string;
  hrefLabel?: string;
  showAuditChips?: boolean;
}

function isCodeEmailDraft(
  draft: MessageTemplateResourceDraft,
): draft is CodeEmailTemplateResource {
  return draft.type === ChannelType.Email && typeof draft.body === "string";
}

export function composerBlocksForDraft({
  body,
  blocks,
  lastAssembledBody,
}: {
  body: string;
  blocks?: AmieBlockSpec[] | null;
  lastAssembledBody: string | null;
}): AmieBlockSpec[] {
  if (blocks?.length && body === lastAssembledBody) return blocks;
  return [{ type: "rawHtml", params: { html: body } }];
}

export function emailHtmlToSms(html: string): string {
  if (typeof window !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");
    document
      .querySelectorAll(
        "style,script,head,[data-amie-preview-text],.preheader,[data-amie-block='footer']",
      )
      .forEach((node) => node.remove());
    const text = document.body.textContent ?? "";
    return text.replace(/\s+/g, " ").trim().slice(0, 1500);
  }
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

export function relativeSavedLabel(
  lastSavedAt: number | null,
  saving: boolean,
  now = Date.now(),
) {
  if (saving) return "Saving…";
  if (!lastSavedAt) return "Saved";
  const elapsedMilliseconds = Math.max(0, now - lastSavedAt);
  if (elapsedMilliseconds < 60_000) return "Saved just now";
  if (elapsedMilliseconds < 60 * 60_000) {
    return `Saved ${Math.floor(elapsedMilliseconds / 60_000)} min ago`;
  }
  if (elapsedMilliseconds < 24 * 60 * 60_000) {
    return `Saved ${Math.floor(elapsedMilliseconds / (60 * 60_000))} h ago`;
  }

  const savedDate = new Date(lastSavedAt);
  const currentDate = new Date(now);
  const startOfToday = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  ).getTime();
  const startOfSavedDay = new Date(
    savedDate.getFullYear(),
    savedDate.getMonth(),
    savedDate.getDate(),
  ).getTime();
  const yesterday = new Date(startOfToday);
  yesterday.setDate(yesterday.getDate() - 1);
  if (startOfSavedDay === yesterday.getTime()) return "Saved yesterday";

  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return `Saved on ${savedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(lastSavedAt < oneYearAgo.getTime() ? { year: "numeric" } : {}),
  })}`;
}

function containsBrandAndFooter(html: string) {
  return (
    /(?:<title>Amie<\/title>|data-amie-block)/i.test(html) &&
    /unsubscribe/i.test(html)
  );
}

export const StableEmailPreview = memo(function StableEmailPreview({
  body,
  subject,
  width,
  onRender,
}: {
  body: string;
  subject: string;
  width: PreviewWidth;
  onRender?: () => void;
}) {
  onRender?.();
  const previewWidth = width === "desktop" ? 600 : 390;
  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <Box
        data-testid="email-preview-frame"
        data-subject={subject}
        sx={{
          width: previewWidth,
          maxWidth: "100%",
          mx: "auto",
          bgcolor: "white",
          border: `1px solid ${COLORS.border}`,
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(74,58,52,.07)",
        }}
      >
        {body ? (
          <iframe
            srcDoc={body}
            title="email-body-preview"
            style={{
              display: "block",
              width: "100%",
              height: 620,
              border: 0,
              background: "white",
            }}
          />
        ) : (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={1}
            sx={{ height: 420, color: COLORS.caption }}
          >
            <AutoAwesome />
            <Typography variant="body2">
              Your preview will appear here.
            </Typography>
          </Stack>
        )}
      </Box>
      <Typography
        sx={{
          mt: 1.5,
          textAlign: "center",
          color: COLORS.caption,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10.5,
        }}
      >
        {previewWidth}px · {width} preview · updates live as you chat
      </Typography>
    </Box>
  );
});

function SegmentControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        display: "inline-flex",
        bgcolor: "#F1EAE1",
        borderRadius: "9px",
        p: "3px",
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            size="small"
            onClick={() => onChange(option.value)}
            sx={{
              minWidth: 0,
              px: 1.75,
              py: 0.625,
              color: selected ? COLORS.teal : COLORS.muted,
              bgcolor: selected ? "white" : "transparent",
              borderRadius: "7px",
              boxShadow: selected ? "0 1px 2px rgba(74,58,52,.08)" : "none",
              fontSize: 12.5,
              fontWeight: selected ? 600 : 400,
              textTransform: "none",
              "&:hover": {
                bgcolor: selected ? "white" : "rgba(255,255,255,.45)",
              },
            }}
          >
            {option.label}
          </Button>
        );
      })}
    </Box>
  );
}

function AssistantMessage({ message }: { message: DisplayMessage }) {
  return (
    <Box sx={{ alignSelf: "flex-start", maxWidth: "92%" }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{ mb: 0.75 }}
      >
        <Box
          component="span"
          sx={{
            width: 20,
            height: 20,
            borderRadius: "6px",
            bgcolor: "#EAF2F1",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: COLORS.teal,
            fontSize: 11,
          }}
        >
          ✦
        </Box>
        <Typography
          sx={{
            color: COLORS.caption,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".1em",
            textTransform: "uppercase",
          }}
        >
          Amie assistant
        </Typography>
      </Stack>
      <Box
        sx={{
          bgcolor: "white",
          border: `1px solid ${COLORS.border}`,
          borderRadius: "3px 12px 12px 12px",
          px: 1.75,
          py: 1.5,
          color: COLORS.text,
          fontSize: 13.5,
          lineHeight: 1.6,
          boxShadow: "0 1px 2px rgba(74,58,52,.04)",
        }}
      >
        {message.content}
        {message.href && message.hrefLabel ? (
          <Box sx={{ mt: 0.75 }}>
            <Link
              href={message.href}
              style={{ color: COLORS.teal, fontWeight: 600 }}
            >
              {message.hrefLabel} →
            </Link>
          </Box>
        ) : null}
        {message.showAuditChips ? (
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            flexWrap="wrap"
            sx={{ mt: 1.25 }}
          >
            {["✓ On-brand voice", "✓ CAN-SPAM footer"].map((label) => (
              <Box
                component="span"
                key={label}
                sx={{
                  color: COLORS.success,
                  bgcolor: COLORS.successBg,
                  borderRadius: 999,
                  px: 1.25,
                  py: 0.375,
                  fontSize: 11.5,
                }}
              >
                {label}
              </Box>
            ))}
          </Stack>
        ) : null}
      </Box>
    </Box>
  );
}

export default function EmailTemplateEditorV3({
  draft,
  setDraft,
  disabled,
  title,
  setTitle,
  rendered,
  userPropertiesJSON,
  setUserPropertiesJSON,
  publisherStatus,
  viewDraft,
  setViewDraft,
  lastSavedAt,
  isSaving,
  sendTestControl,
  editorOptions,
  editorBody,
  settingsMenu,
}: TemplateEditorLayoutParams) {
  const baseApiUrl = useBaseApiUrl();
  const authHeaders = useAuthHeaders();
  const { workspace } = useAppStorePick(["workspace"]);
  const composerConfig = useAmieComposerConfigQuery();
  const createTemplate = useMessageTemplateUpdateMutation();
  const [tab, setTab] = useState<EditorTab>("compose");
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>("desktop");
  const [input, setInput] = useState("");
  const [conversation, setConversation] = useState<DisplayMessage[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AmieAsset[]>([]);
  const [savedLabel, setSavedLabel] = useState(() =>
    relativeSavedLabel(lastSavedAt, isSaving),
  );
  const originalPromptRef = useRef("Revise the existing email template");
  const lastAssembledBodyRef = useRef<string | null>(
    isCodeEmailDraft(draft) && draft.amieBlocks?.length ? draft.body : null,
  );

  const workspaceId =
    workspace.type === CompletionStatus.Successful ? workspace.value.id : null;
  const emailDraft = isCodeEmailDraft(draft) ? draft : null;
  const previewText = emailDraft ? previewTextFromHtml(emailDraft.body) : "";
  const previewBody = rendered.body ?? emailDraft?.body ?? "";

  useEffect(() => {
    const updateLabel = () =>
      setSavedLabel(relativeSavedLabel(lastSavedAt, isSaving));
    updateLabel();
    const interval = window.setInterval(updateLabel, 30_000);
    return () => window.clearInterval(interval);
  }, [isSaving, lastSavedAt]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    void axios
      .get<AmieAssetListResponse>(`${baseApiUrl}/content/assets`, {
        params: { workspaceId },
        headers: authHeaders,
        signal: controller.signal,
      })
      .then((response) => setAssets(response.data.assets))
      .catch((requestError: unknown) => {
        if (!axios.isCancel(requestError)) setAssets([]);
      });
    return () => controller.abort();
  }, [authHeaders, baseApiUrl, workspaceId]);

  const applyComposerResponse = useCallback(
    (response: AmieComposeResponse) => {
      const body = withPreviewText(response.html, response.previewText);
      lastAssembledBodyRef.current = body;
      setDraft((current) => {
        if (!isCodeEmailDraft(current)) return current;
        return {
          ...current,
          emailContentsType: EmailContentsType.Code,
          subject: response.subject,
          body,
          amieBlocks: response.blocks,
        };
      });
    },
    [setDraft],
  );

  const requestComposition = useCallback(
    async (message: string, mode: "apply" | "variant" = "apply") => {
      const cleanMessage = message.trim();
      if (
        !cleanMessage ||
        !workspaceId ||
        !emailDraft ||
        isComposing ||
        composerConfig.data?.enabled !== true
      ) {
        return;
      }
      const apiConversation = conversation.map(({ role, content }) => ({
        role,
        content,
      }));
      const nextConversation: ConversationMessage[] = [
        ...apiConversation,
        { role: "user", content: cleanMessage },
      ];
      const currentBlocks = composerBlocksForDraft({
        body: emailDraft.body,
        blocks: emailDraft.amieBlocks,
        lastAssembledBody: lastAssembledBodyRef.current,
      });
      const request: AmieComposeRequest = {
        workspaceId,
        prompt: originalPromptRef.current,
        currentBlocks,
        conversation: nextConversation,
        images: assets.map((asset) => ({
          url: asset.url,
          name: asset.name,
          alt: asset.alt,
        })),
      };
      setIsComposing(true);
      setError(null);
      setConversation((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: "user", content: cleanMessage },
      ]);
      try {
        const response = await axios.post<AmieComposeResponse>(
          `${baseApiUrl}/content/templates/compose`,
          request,
          { headers: authHeaders },
        );
        const responseBody = withPreviewText(
          response.data.html,
          response.data.previewText,
        );
        if (mode === "variant") {
          const created = await createTemplate.mutateAsync({
            name: `${title} — Variant B`,
            definition: {
              ...emailDraft,
              emailContentsType: EmailContentsType.Code,
              subject: response.data.subject,
              body: responseBody,
              amieBlocks: response.data.blocks,
            },
            resourceType: ResourceTypeEnum.Declarative,
          });
          setConversation((current) => [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content:
                "Variant B is ready with an alternative subject and body.",
              href: `/templates/email/${created.id}`,
              hrefLabel: "Open Variant B",
              showAuditChips: containsBrandAndFooter(responseBody),
            },
          ]);
        } else {
          applyComposerResponse(response.data);
          setConversation((current) => [
            ...current,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: conversation.length
                ? `Updated. ${response.data.designNotes} Preview refreshed →`
                : `Drafted it — subject, preview text, and body are on the right. ${response.data.designNotes}`,
              showAuditChips: containsBrandAndFooter(responseBody),
            },
          ]);
        }
        if (conversation.length === 0) originalPromptRef.current = cleanMessage;
        setInput("");
      } catch {
        setError("That change didn’t go through. Your draft is untouched.");
      } finally {
        setIsComposing(false);
      }
    },
    [
      applyComposerResponse,
      assets,
      authHeaders,
      baseApiUrl,
      composerConfig.data?.enabled,
      conversation,
      createTemplate,
      emailDraft,
      isComposing,
      title,
      workspaceId,
    ],
  );

  const createSmsVersion = useCallback(async () => {
    if (!emailDraft || createTemplate.isPending) return;
    setError(null);
    setConversation((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: "Make an SMS version",
      },
    ]);
    try {
      const created = await createTemplate.mutateAsync({
        name: `${title} — SMS`,
        definition: {
          type: ChannelType.Sms,
          body: emailHtmlToSms(rendered.body ?? emailDraft.body),
        },
        resourceType: ResourceTypeEnum.Declarative,
      });
      setConversation((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "I created an SMS template from this email’s content.",
          href: `/templates/sms/${created.id}`,
          hrefLabel: "Open SMS template",
        },
      ]);
    } catch {
      setError("The SMS version couldn’t be created. Nothing was changed.");
    }
  }, [createTemplate, emailDraft, rendered.body, title]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void requestComposition(input);
  };

  const insertImage = (asset: AmieAsset) => {
    setAssets((current) =>
      current.some((item) => item.id === asset.id)
        ? current
        : [asset, ...current],
    );
    const markup = `<img src="${asset.url}" alt="${asset.alt}" width="600" style="display:block;max-width:100%;height:auto;border:0">`;
    setDraft((current) => {
      if (!isCodeEmailDraft(current)) return current;
      return { ...current, body: `${current.body}${markup}` };
    });
  };

  const updateEmailField = (
    field: "from" | "replyTo" | "subject",
    value: string,
  ) => {
    setDraft((current) =>
      current.type === ChannelType.Email
        ? { ...current, [field]: value }
        : current,
    );
  };

  const updatePreviewText = (value: string) => {
    if (!emailDraft) return;
    const body = withPreviewText(emailDraft.body, value);
    if (
      emailDraft.amieBlocks?.length &&
      emailDraft.body === lastAssembledBodyRef.current
    ) {
      lastAssembledBodyRef.current = body;
    }
    setDraft((current) =>
      isCodeEmailDraft(current) ? { ...current, body } : current,
    );
  };

  const canPublish =
    publisherStatus?.type === PublisherStatusType.OutOfDate &&
    !publisherStatus.disabled;
  const isPublisherUpdating =
    publisherStatus?.type === PublisherStatusType.OutOfDate &&
    publisherStatus.isUpdating;
  const composerUnavailable =
    composerConfig.isError || composerConfig.data?.enabled === false;
  const composerReady = composerConfig.data?.enabled === true;
  const assistantDisabled =
    disabled || !emailDraft || isComposing || !composerReady;

  const subjectEditor = (
    <Box
      sx={{
        width: previewWidth === "desktop" ? 600 : 390,
        maxWidth: "100%",
        mb: 1.75,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 0.75 }}
      >
        <Typography
          sx={{
            color: COLORS.caption,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: ".12em",
            textTransform: "uppercase",
          }}
        >
          Subject
        </Typography>
        <Typography
          sx={{
            color: COLORS.teal,
            bgcolor: "#EAF2F1",
            borderRadius: 999,
            px: 1,
            py: 0.25,
            fontSize: 10.5,
          }}
        >
          ✦ drafted by AI · edit inline
        </Typography>
      </Stack>
      <TextField
        fullWidth
        size="small"
        inputProps={{ "aria-label": "Subject", maxLength: 60 }}
        value={emailDraft?.subject ?? ""}
        disabled={disabled || !emailDraft}
        onChange={(event) => updateEmailField("subject", event.target.value)}
        sx={{
          bgcolor: "white",
          "& .MuiOutlinedInput-root": { borderRadius: "8px" },
        }}
      />
      <TextField
        fullWidth
        size="small"
        inputProps={{ "aria-label": "Preview text" }}
        value={previewText}
        placeholder="Preview text"
        disabled={disabled || !emailDraft}
        onChange={(event) => updatePreviewText(event.target.value)}
        sx={{
          mt: 0.75,
          bgcolor: "white",
          "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12.5 },
        }}
      />
    </Box>
  );

  const previewPanel = (
    <Box
      sx={{
        bgcolor: COLORS.preview,
        p: { xs: 2, md: 2.75 },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: 0,
        overflowY: "auto",
      }}
    >
      {subjectEditor}
      <StableEmailPreview
        body={previewBody}
        subject={emailDraft?.subject ?? ""}
        width={previewWidth}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        color: COLORS.text,
        bgcolor: COLORS.page,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <Link href="/templates" style={{ color: COLORS.teal, fontSize: 13 }}>
        ← All templates
      </Link>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
        spacing={2}
        sx={{ mt: 1.25 }}
      >
        <Stack
          direction="row"
          alignItems="baseline"
          spacing={1.5}
          sx={{ minWidth: 0 }}
        >
          <TextField
            variant="standard"
            value={title}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
            inputProps={{ "aria-label": "Template name" }}
            sx={{
              minWidth: 220,
              maxWidth: 520,
              "& .MuiInputBase-input": {
                color: COLORS.heading,
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: 26,
                fontWeight: 600,
                lineHeight: 1.15,
                py: 0,
              },
              "& .MuiInput-underline:before": {
                borderBottomColor: "transparent",
              },
            }}
          />
          <Typography
            sx={{ color: COLORS.caption, fontSize: 12, whiteSpace: "nowrap" }}
          >
            {savedLabel}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              "& .MuiButton-root": {
                color: COLORS.text,
                borderColor: "#E3DAD1",
                borderRadius: "8px",
                px: 1.75,
                py: 1,
                fontSize: 13.5,
                textTransform: "none",
              },
            }}
          >
            {sendTestControl}
          </Box>
          <Button
            variant="contained"
            disabled={!canPublish || isPublisherUpdating}
            onClick={() => {
              if (publisherStatus?.type === PublisherStatusType.OutOfDate)
                publisherStatus.onPublish();
            }}
            sx={{
              bgcolor: COLORS.teal,
              borderRadius: "8px",
              px: 2,
              py: 1.1,
              fontSize: 13.5,
              textTransform: "none",
              boxShadow: "0 1px 2px rgba(45,90,90,.2)",
              "&:hover": { bgcolor: COLORS.tealDark },
            }}
          >
            {isPublisherUpdating ? "Publishing…" : "Publish"}
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          mt: 2.25,
          bgcolor: "white",
          border: `1px solid ${COLORS.border}`,
          borderRadius: "12px",
          boxShadow:
            "0 1px 2px rgba(74,58,52,.04), 0 6px 18px rgba(74,58,52,.05)",
          overflow: "hidden",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{
            px: 1.75,
            py: 1.25,
            borderBottom: `1px solid ${COLORS.borderSoft}`,
          }}
        >
          <SegmentControl
            label="Editor tab"
            value={tab}
            options={[
              { value: "compose", label: "Compose" },
              { value: "code", label: "Code" },
              { value: "settings", label: "Settings" },
            ]}
            onChange={setTab}
          />
          <SegmentControl
            label="Preview size"
            value={previewWidth}
            options={[
              { value: "desktop", label: "Desktop" },
              { value: "mobile", label: "Mobile" },
            ]}
            onChange={setPreviewWidth}
          />
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              lg: "420px minmax(0,1fr)",
            },
            minHeight: 620,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Box
              sx={{
                display: tab === "compose" ? "block" : "none",
                minHeight: 620,
              }}
            >
              <Stack
                sx={{
                  minHeight: 0,
                  borderRight: { lg: `1px solid ${COLORS.borderSoft}` },
                  bgcolor: COLORS.warm,
                }}
              >
                <Stack
                  spacing={1.5}
                  sx={{
                    flex: 1,
                    minHeight: 360,
                    maxHeight: 620,
                    overflowY: "auto",
                    px: 2.25,
                    pt: 2.25,
                    pb: 1,
                  }}
                >
                  {conversation.length === 0 ? (
                    <AssistantMessage
                      message={{
                        id: "empty-state",
                        role: "assistant",
                        content:
                          "Describe the email you need, or ask for a change to this draft. I’ll update the subject, preview text, and body on the right.",
                      }}
                    />
                  ) : null}
                  {conversation.map((message) =>
                    message.role === "user" ? (
                      <Box
                        key={message.id}
                        sx={{
                          alignSelf: "flex-end",
                          maxWidth: "85%",
                          bgcolor: COLORS.blush,
                          borderRadius: "12px 12px 3px 12px",
                          px: 1.75,
                          py: 1.25,
                          fontSize: 13.5,
                          lineHeight: 1.55,
                        }}
                      >
                        {message.content}
                      </Box>
                    ) : (
                      <AssistantMessage key={message.id} message={message} />
                    ),
                  )}
                  {isComposing ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ color: COLORS.muted }}
                    >
                      <CircularProgress size={16} />
                      <Typography variant="body2">
                        Writing and reviewing…
                      </Typography>
                    </Stack>
                  ) : null}
                  {error ? <Alert severity="error">{error}</Alert> : null}
                  {composerUnavailable ? (
                    <Alert severity="info">
                      The assistant is unavailable. Code editing remains
                      available.
                    </Alert>
                  ) : null}
                  {!emailDraft ? (
                    <Alert severity="info">
                      Switch this visual template to HTML in Code before
                      composing with the assistant.
                    </Alert>
                  ) : null}
                </Stack>
                <Box sx={{ px: 2.25, pb: 2, pt: 1 }}>
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    flexWrap="wrap"
                    sx={{ mb: 1.25 }}
                  >
                    {[
                      {
                        label: "Shorten it",
                        prompt:
                          "Shorten the copy while preserving the meaning and CTA.",
                      },
                      {
                        label: "Add 15% offer",
                        prompt: "Add a warm, low-pressure 15% offer.",
                      },
                    ].map(({ label, prompt }) => (
                      <Button
                        key={label}
                        size="small"
                        variant="outlined"
                        disabled={assistantDisabled}
                        onClick={() => void requestComposition(prompt)}
                        sx={{
                          color: COLORS.teal,
                          borderColor: "#D8E5E4",
                          borderRadius: 999,
                          px: 1.5,
                          fontSize: 12,
                          textTransform: "none",
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={assistantDisabled}
                      onClick={() =>
                        void requestComposition(
                          "Create a meaningfully different subject and body for an A/B test.",
                          "variant",
                        )
                      }
                      sx={{
                        color: COLORS.teal,
                        borderColor: "#D8E5E4",
                        borderRadius: 999,
                        px: 1.5,
                        fontSize: 12,
                        textTransform: "none",
                      }}
                    >
                      A/B a variant
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={
                        disabled || !emailDraft || createTemplate.isPending
                      }
                      onClick={() => void createSmsVersion()}
                      sx={{
                        color: COLORS.teal,
                        borderColor: "#D8E5E4",
                        borderRadius: 999,
                        px: 1.5,
                        fontSize: 12,
                        textTransform: "none",
                      }}
                    >
                      Make an SMS version
                    </Button>
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    sx={{ mb: 1 }}
                  >
                    <ImageAssetsPanel
                      disabled={disabled}
                      label="Images"
                      onInsert={insertImage}
                      onUploaded={(asset) =>
                        setAssets((current) => [
                          asset,
                          ...current.filter((item) => item.id !== asset.id),
                        ])
                      }
                    />
                  </Stack>
                  <Box
                    component="form"
                    onSubmit={handleSubmit}
                    sx={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: 1,
                      bgcolor: "white",
                      border: "1px solid #E3DAD1",
                      borderRadius: "12px",
                      p: "10px 10px 10px 14px",
                      boxShadow: "0 1px 2px rgba(74,58,52,.04)",
                    }}
                  >
                    <TextField
                      variant="standard"
                      fullWidth
                      multiline
                      maxRows={5}
                      value={input}
                      disabled={assistantDisabled}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "Enter" ||
                          event.shiftKey ||
                          event.nativeEvent.isComposing
                        ) {
                          return;
                        }
                        event.preventDefault();
                        if (!input.trim() || assistantDisabled) return;
                        void requestComposition(input);
                      }}
                      placeholder="Describe a change, or ask for a new draft…"
                      InputProps={{
                        disableUnderline: true,
                        inputProps: { "aria-label": "Assistant prompt" },
                      }}
                    />
                    <Button
                      type="submit"
                      aria-label="Send prompt"
                      disabled={!input.trim() || assistantDisabled}
                      sx={{
                        minWidth: 34,
                        width: 34,
                        height: 34,
                        bgcolor: COLORS.teal,
                        color: "white",
                        borderRadius: "9px",
                        p: 0,
                        "&:hover": { bgcolor: COLORS.tealDark },
                      }}
                    >
                      <ArrowUpward fontSize="small" />
                    </Button>
                  </Box>
                  <Typography
                    sx={{
                      mt: 1,
                      color: COLORS.caption,
                      fontSize: 11,
                      textAlign: "center",
                    }}
                  >
                    ↵ to send · shift+↵ for a new line · The assistant writes in
                    Amie&apos;s voice and always includes the unsubscribe
                    footer.
                  </Typography>
                </Box>
              </Stack>
            </Box>

            <Box
              sx={{
                display: tab === "code" ? "block" : "none",
                minHeight: 620,
              }}
            >
              <Box
                data-testid="code-editor-panel"
                sx={{
                  minWidth: 0,
                  height: 700,
                  overflow: "hidden",
                  borderRight: { lg: `1px solid ${COLORS.borderSoft}` },
                }}
              >
                {editorBody}
              </Box>
            </Box>

            <Box
              sx={{
                display: tab === "settings" ? "block" : "none",
                minHeight: 620,
              }}
            >
              <Stack
                spacing={2}
                sx={{
                  p: 2.5,
                  bgcolor: COLORS.warm,
                  borderRight: { lg: `1px solid ${COLORS.borderSoft}` },
                  overflowY: "auto",
                }}
              >
                <Typography
                  sx={{
                    color: COLORS.heading,
                    fontFamily: "'Cormorant Garamond', Georgia, serif",
                    fontSize: 22,
                    fontWeight: 600,
                  }}
                >
                  Delivery settings
                </Typography>
                <TextField
                  label="To"
                  value={`{{user.${emailDraft?.identifierKey ?? "email"}}}`}
                  disabled
                  fullWidth
                />
                <TextField
                  label="From"
                  value={emailDraft?.from ?? ""}
                  disabled={disabled || !emailDraft}
                  onChange={(event) =>
                    updateEmailField("from", event.target.value)
                  }
                  fullWidth
                  required
                />
                <TextField
                  label="Reply-to"
                  value={emailDraft?.replyTo ?? ""}
                  disabled={disabled || !emailDraft}
                  onChange={(event) =>
                    updateEmailField("replyTo", event.target.value)
                  }
                  fullWidth
                />
                <TextField
                  label="Subject"
                  value={emailDraft?.subject ?? ""}
                  disabled={disabled || !emailDraft}
                  onChange={(event) =>
                    updateEmailField("subject", event.target.value)
                  }
                  fullWidth
                  required
                />
                <TextField
                  label="Preview text"
                  value={previewText}
                  disabled={disabled || !emailDraft}
                  onChange={(event) => updatePreviewText(event.target.value)}
                  fullWidth
                />
                <Box
                  sx={{
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: "8px",
                    bgcolor: "white",
                    p: 1.5,
                  }}
                >
                  <Typography
                    sx={{
                      color: COLORS.heading,
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    Subscription & unsubscribe
                  </Typography>
                  <Typography
                    sx={{ mt: 0.5, color: COLORS.muted, fontSize: 12.5 }}
                  >
                    Subscription groups are selected by the journey or broadcast
                    that uses this template. The Amie footer keeps the
                    unsubscribe link in every AI draft.
                  </Typography>
                  <Typography
                    sx={{
                      mt: 1,
                      color: containsBrandAndFooter(emailDraft?.body ?? "")
                        ? COLORS.success
                        : "#B76E79",
                      fontSize: 12,
                    }}
                  >
                    {containsBrandAndFooter(emailDraft?.body ?? "")
                      ? "✓ Unsubscribe footer detected"
                      : "Unsubscribe footer not detected"}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <FormControlLabel
                    control={
                      <Switch
                        checked={viewDraft}
                        onChange={(_event, checked) => setViewDraft(checked)}
                      />
                    }
                    label={viewDraft ? "Editing draft" : "Viewing published"}
                  />
                  {publisherStatus?.type === PublisherStatusType.OutOfDate ? (
                    <Button
                      color="warning"
                      disabled={publisherStatus.isUpdating}
                      onClick={publisherStatus.onRevert}
                      sx={{ textTransform: "none" }}
                    >
                      Revert draft
                    </Button>
                  ) : null}
                </Stack>
                <Box sx={{ "& > .MuiButton-root": { textTransform: "none" } }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {editorOptions}
                    {settingsMenu}
                  </Stack>
                </Box>
                <Box>
                  <Typography
                    sx={{
                      mb: 0.75,
                      color: COLORS.heading,
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    User-properties test JSON
                  </Typography>
                  <Box
                    sx={{
                      height: 260,
                      overflow: "hidden",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: "8px",
                      bgcolor: "white",
                    }}
                  >
                    <ReactCodeMirror
                      value={userPropertiesJSON}
                      height="260px"
                      onChange={setUserPropertiesJSON}
                      extensions={[json(), EditorView.lineWrapping]}
                      basicSetup={{ lineNumbers: false }}
                    />
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Box>
          {previewPanel}
        </Box>
      </Box>
    </Box>
  );
}
