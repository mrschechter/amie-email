import {
  Add,
  ArrowBack,
  ArrowDownward,
  ArrowUpward,
  AutoAwesome,
  ContentCopy,
  DeleteOutline,
  DragIndicator,
  FormatQuote,
  ImageOutlined,
  Send,
  TextFields,
  ViewAgenda,
  ViewColumn,
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
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import axios from "axios";
import {
  AmieAsset,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";
import {
  AmieAssembleResponse,
  AmieBlockSpec,
  AmieBlockStyle,
  AmieBrandBackground,
  AmieComposeRequest,
  AmieComposeResponse,
  AmieDesignBrief,
} from "isomorphic-lib/src/amieComposer";
import { defaultEmailDefinition } from "isomorphic-lib/src/email";
import {
  ChannelType,
  CompletionStatus,
  EmailContentsType,
  ResourceTypeEnum,
} from "isomorphic-lib/src/types";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
import {
  AddableBlockType,
  BLOCK_LIBRARY,
  blockSummary,
  createBlock,
} from "./amieComposer/blockLibrary";
import { AMIE_RECIPES, AmieRecipe } from "./amieComposer/recipes";
import {
  AmieComposeStatus,
  previewTextFromHtml,
  streamAmieComposition,
  withPreviewText,
} from "./amieComposerHtml";
import ImageAssetsPanel from "./imageAssetsPanel";

type ConversationMessage = NonNullable<
  AmieComposeRequest["conversation"]
>[number];

interface EditableField {
  key: string;
  label: string;
  multiline?: boolean;
  optional?: boolean;
  helperText?: string;
}

const BACKGROUNDS: { token: AmieBrandBackground; hex: string }[] = [
  { token: "ivory", hex: "#FAF8F5" },
  { token: "blush", hex: "#F5E6E0" },
  { token: "white", hex: "#FFFFFF" },
  { token: "teal", hex: "#2D7A7A" },
  { token: "sage", hex: "#9CAF88" },
];

function editableFields(block: AmieBlockSpec): EditableField[] {
  switch (block.type) {
    case "header":
    case "divider":
    case "spacer":
    case "sectionBreak":
      return [];
    case "heroHeading":
      return [
        { key: "title", label: "Title", multiline: true },
        { key: "subtitle", label: "Subtitle", multiline: true, optional: true },
      ];
    case "paragraph":
      return [
        {
          key: "text",
          label: "Text",
          multiline: true,
          helperText: "Supports bold, italic, links, and line breaks.",
        },
      ];
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
    case "twoColumn":
      return [
        { key: "image.src", label: "Image URL" },
        { key: "image.alt", label: "Image alt text" },
        { key: "heading", label: "Heading", optional: true },
        { key: "body", label: "Body", multiline: true },
        { key: "cta.label", label: "CTA label", optional: true },
        { key: "cta.url", label: "CTA URL", optional: true },
      ];
    case "bulletList":
      return [
        { key: "heading", label: "Heading", optional: true },
        {
          key: "items",
          label: "Items",
          multiline: true,
          helperText: "One item per line.",
        },
      ];
    case "statsRow":
      return [
        {
          key: "items",
          label: "Stats",
          multiline: true,
          helperText: "One per line: value | label (2–4 rows).",
        },
      ];
    case "quoteCallout":
      return [
        { key: "quote", label: "Quote", multiline: true },
        { key: "attribution", label: "Attribution", optional: true },
      ];
    case "rawHtml":
      return [{ key: "html", label: "Imported HTML", multiline: true }];
  }
}

function fieldValue(block: AmieBlockSpec, key: string): string {
  if (block.type === "bulletList" && key === "items")
    return block.params.items.join("\n");
  if (block.type === "statsRow" && key === "items") {
    return block.params.items
      .map((item) => `${item.value} | ${item.label}`)
      .join("\n");
  }
  const path = key.split(".");
  let value: unknown = block.params;
  for (const part of path) {
    value =
      value && typeof value === "object" ? Reflect.get(value, part) : undefined;
  }
  return typeof value === "string" ? value : "";
}

function updateBlockField(
  block: AmieBlockSpec,
  field: EditableField,
  value: string,
): AmieBlockSpec {
  if (block.type === "bulletList" && field.key === "items") {
    const items = value.split(/\r?\n/).filter((item) => item.trim().length > 0);
    return {
      ...block,
      params: { ...block.params, items: items.length ? items : [""] },
    };
  }
  if (block.type === "statsRow" && field.key === "items") {
    const items = value
      .split(/\r?\n/)
      .slice(0, 4)
      .map((line) => {
        const [statValue, ...label] = line.split("|");
        return {
          value: statValue?.trim() ?? "",
          label: label.join("|").trim(),
        };
      });
    while (items.length < 2) items.push({ value: "", label: "" });
    return { ...block, params: { ...block.params, items } };
  }
  const params: Record<string, unknown> = { ...block.params };
  const [first, second] = field.key.split(".");
  if (!first) return block;
  if (second) {
    const nested = params[first];
    const next = nested && typeof nested === "object" ? { ...nested } : {};
    if (field.optional && value === "") Reflect.deleteProperty(next, second);
    else Reflect.set(next, second, value);
    params[first] = next;
  } else if (field.optional && value === "") {
    Reflect.deleteProperty(params, first);
  } else {
    params[first] = value;
  }
  // Field definitions are exhaustive for the discriminated block contract.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return { ...block, params } as AmieBlockSpec;
}

function swapBlocks(
  blocks: AmieBlockSpec[],
  from: number,
  to: number,
): AmieBlockSpec[] {
  if (from === to || !blocks[from] || !blocks[to]) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

function designerPreviewHtml(html: string): string {
  const bridge = `<script>(function(){function select(index){document.querySelectorAll('[data-amie-block]').forEach(function(node){node.style.outline='';node.style.outlineOffset='';});var node=document.querySelector('[data-amie-block="'+index+'"]');if(node){node.style.outline='3px solid #2D7A7A';node.style.outlineOffset='-3px';}}document.addEventListener('click',function(event){var target=event.target&&event.target.closest?event.target.closest('[data-amie-block]'):null;if(target){event.preventDefault();parent.postMessage({type:'amie-block-select',index:Number(target.getAttribute('data-amie-block'))},'*');}});window.addEventListener('message',function(event){if(event.data&&event.data.type==='amie-block-highlight')select(event.data.index);});})();</script>`;
  return html.includes("</body>")
    ? html.replace("</body>", `${bridge}</body>`)
    : `${html}${bridge}`;
}

function blockIcon(type: AmieBlockSpec["type"]) {
  if (type === "image" || type === "heroImage" || type === "productCard")
    return <ImageOutlined fontSize="small" />;
  if (type === "twoColumn") return <ViewColumn fontSize="small" />;
  if (type === "testimonial" || type === "quoteCallout")
    return <FormatQuote fontSize="small" />;
  if (type === "paragraph" || type === "heroHeading" || type === "bulletList")
    return <TextFields fontSize="small" />;
  return <ViewAgenda fontSize="small" />;
}

function brandBackground(value: unknown): AmieBrandBackground | null {
  return BACKGROUNDS.find((item) => item.token === value)?.token ?? null;
}

function designGoal(value: unknown): AmieDesignBrief["goal"] {
  if (
    value === "winback" ||
    value === "launch" ||
    value === "newsletter" ||
    value === "promo" ||
    value === "welcome"
  )
    return value;
  return undefined;
}

function designTone(value: unknown): AmieDesignBrief["tone"] {
  if (value === "warm" || value === "clinical" || value === "playful")
    return value;
  return undefined;
}

function designDensity(value: unknown): AmieDesignBrief["density"] {
  if (value === "airy" || value === "standard" || value === "dense")
    return value;
  return undefined;
}

function designHero(value: unknown): AmieDesignBrief["heroStyle"] {
  if (
    value === "bigImage" ||
    value === "headlineFirst" ||
    value === "productFirst"
  )
    return value;
  return undefined;
}

function fieldMinRows(
  block: AmieBlockSpec,
  field: EditableField,
): number | undefined {
  if (!field.multiline) return undefined;
  return block.type === "rawHtml" ? 10 : 2;
}

function AddBlockPicker({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: AddableBlockType) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        size="small"
        startIcon={<Add />}
        disabled={disabled}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        Add block
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        PaperProps={{ sx: { maxHeight: 480, width: 340 } }}
      >
        {BLOCK_LIBRARY.map((item) => (
          <MenuItem
            key={item.type}
            onClick={() => {
              onAdd(item.type);
              setAnchor(null);
            }}
            sx={{ gap: 1.5, py: 1 }}
          >
            <Box
              sx={{
                width: 42,
                height: 32,
                borderRadius: 1,
                bgcolor: item.color,
                border: "1px solid",
                borderColor: "divider",
                flex: "0 0 auto",
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>
                {item.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {item.description}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function Inspector({
  block,
  onChange,
  onChooseImage,
}: {
  block: AmieBlockSpec;
  onChange: (block: AmieBlockSpec) => void;
  onChooseImage: (asset: AmieAsset) => void;
}) {
  const style = block.style ?? {};
  const setStyle = (key: keyof AmieBlockStyle, value: string | null) => {
    const next = { ...style };
    if (!value) Reflect.deleteProperty(next, key);
    else Reflect.set(next, key, value);
    onChange({ ...block, style: next });
  };
  const imageBearing = [
    "image",
    "heroImage",
    "productCard",
    "twoColumn",
  ].includes(block.type);
  return (
    <Stack spacing={2}>
      <Box>
        <Typography
          variant="overline"
          sx={{ color: tokens.colors.deepTeal, fontWeight: 700 }}
        >
          Inspector
        </Typography>
        <Typography sx={{ fontWeight: 600 }}>
          {BLOCK_LIBRARY.find((item) => item.type === block.type)?.label ??
            "Imported HTML"}
        </Typography>
      </Box>
      {imageBearing && (
        <ImageAssetsPanel
          label="Choose image"
          onInsert={onChooseImage}
          onUploaded={onChooseImage}
        />
      )}
      {block.type === "twoColumn" && (
        <FormControl size="small" fullWidth>
          <InputLabel>Image side</InputLabel>
          <Select
            label="Image side"
            value={block.params.imageSide}
            onChange={(event) =>
              onChange({
                ...block,
                params: {
                  ...block.params,
                  imageSide: event.target.value === "right" ? "right" : "left",
                },
              })
            }
          >
            <MenuItem value="left">Left</MenuItem>
            <MenuItem value="right">Right</MenuItem>
          </Select>
        </FormControl>
      )}
      {block.type === "spacer" && (
        <FormControl size="small" fullWidth>
          <InputLabel>Height</InputLabel>
          <Select
            label="Height"
            value={block.params.height}
            onChange={(event) => {
              const height = Number(event.target.value);
              if (
                height === 16 ||
                height === 24 ||
                height === 32 ||
                height === 48
              )
                onChange({ ...block, params: { height } });
            }}
          >
            {[16, 24, 32, 48].map((height) => (
              <MenuItem key={height} value={height}>
                {height}px
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {block.type === "sectionBreak" && (
        <FormControl size="small" fullWidth>
          <InputLabel>Section background</InputLabel>
          <Select
            label="Section background"
            value={block.params.background}
            onChange={(event) => {
              const background = brandBackground(event.target.value);
              if (background) onChange({ ...block, params: { background } });
            }}
          >
            {BACKGROUNDS.map((item) => (
              <MenuItem key={item.token} value={item.token}>
                {item.token}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {editableFields(block).map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          value={fieldValue(block, field.key)}
          multiline={field.multiline}
          minRows={fieldMinRows(block, field)}
          helperText={field.helperText}
          size="small"
          fullWidth
          onChange={(event) =>
            onChange(updateBlockField(block, field, event.target.value))
          }
        />
      ))}
      {block.type !== "rawHtml" && (
        <Stack spacing={1.25}>
          <Typography variant="caption" fontWeight={700}>
            Background
          </Typography>
          <Stack direction="row" spacing={0.75}>
            {BACKGROUNDS.map((item) => (
              <Tooltip key={item.token} title={item.token}>
                <IconButton
                  aria-label={`${item.token} background`}
                  size="small"
                  onClick={() =>
                    setStyle(
                      "background",
                      style.background === item.token ? null : item.token,
                    )
                  }
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor: item.hex,
                    border: "2px solid",
                    borderColor:
                      style.background === item.token
                        ? tokens.colors.deepTeal
                        : tokens.colors.borderCard,
                    "&:hover": { bgcolor: item.hex },
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
          <Typography variant="caption" fontWeight={700}>
            Alignment
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={style.align ?? null}
            onChange={(_event, value) => setStyle("align", value)}
            fullWidth
          >
            <ToggleButton value="left">Left</ToggleButton>
            <ToggleButton value="center">Center</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" fontWeight={700}>
            Padding
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={style.padding ?? null}
            onChange={(_event, value) => setStyle("padding", value)}
            fullWidth
          >
            <ToggleButton value="tight">Tight</ToggleButton>
            <ToggleButton value="normal">Normal</ToggleButton>
            <ToggleButton value="loose">Loose</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" fontWeight={700}>
            Text size
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={style.textSize ?? null}
            onChange={(_event, value) => setStyle("textSize", value)}
            fullWidth
          >
            <ToggleButton value="s">S</ToggleButton>
            <ToggleButton value="m">M</ToggleButton>
            <ToggleButton value="l">L</ToggleButton>
          </ToggleButtonGroup>
          {(block.type === "ctaButton" || block.type === "twoColumn") && (
            <>
              <Typography variant="caption" fontWeight={700}>
                Button
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={style.buttonVariant ?? null}
                onChange={(_event, value) => setStyle("buttonVariant", value)}
                fullWidth
              >
                <ToggleButton value="primary">Primary</ToggleButton>
                <ToggleButton value="secondary">Outline</ToggleButton>
                <ToggleButton value="roseGold">Rose</ToggleButton>
              </ToggleButtonGroup>
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function assistantConfirmation(revision: boolean): ConversationMessage {
  return {
    role: "assistant",
    content: revision
      ? "Done — I updated the design."
      : "Your designed draft is ready. Tell me what you’d like to refine.",
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
  const authHeaders = useAuthHeaders();
  const universalRouter = useUniversalRouter();
  const { workspace } = useAppStorePick(["workspace"]);
  const composerConfig = useAmieComposerConfigQuery();
  const templateQuery = useMessageTemplateQuery(templateId, {
    enabled: !isNew,
  });
  const { data: template } = templateQuery;
  const saveTemplate = useMessageTemplateUpdateMutation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const restoredTemplateId = useRef<string | null>(null);

  const [input, setInput] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [blocks, setBlocks] = useState<AmieBlockSpec[] | null>(null);
  const [html, setHtml] = useState("");
  const [designNotes, setDesignNotes] = useState("");
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [isComposing, setIsComposing] = useState(false);
  const [composeStatus, setComposeStatus] =
    useState<AmieComposeStatus>("Thinking…");
  const [composeWarnings, setComposeWarnings] = useState<string[]>([]);
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
  const [isImportingHtml, setIsImportingHtml] = useState(false);
  const [assets, setAssets] = useState<AmieAsset[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [designBrief, setDesignBrief] = useState<AmieDesignBrief>({});

  const workspaceId =
    workspace.type === CompletionStatus.Successful ? workspace.value.id : null;
  const hasDraft = blocks !== null || isRawHtml;
  const previewHtml = useMemo(() => designerPreviewHtml(html), [html]);

  useEffect(() => {
    if (!workspaceId) return;
    void axios
      .get<AmieAssetListResponse>(`${baseApiUrl}/content/assets`, {
        params: { workspaceId },
        headers: authHeaders,
      })
      .then((response) => setAssets(response.data.assets))
      .catch(() => setAssets([]));
  }, [authHeaders, baseApiUrl, workspaceId]);

  useEffect(() => {
    if (isNew || !template || restoredTemplateId.current === template.id)
      return;
    const definition = template.definition ?? template.draft;
    if (
      definition?.type !== ChannelType.Email ||
      typeof definition.body !== "string"
    )
      return;
    restoredTemplateId.current = template.id;
    setSubject(definition.subject);
    setHtml(definition.body);
    setPreviewText(previewTextFromHtml(definition.body));
    const restoredBlocks =
      "amieBlocks" in definition ? definition.amieBlocks : undefined;
    if (restoredBlocks?.length) {
      setBlocks(restoredBlocks);
      setSelectedBlock(0);
      setIsRawHtml(false);
      setOriginalPrompt("Saved Amie block design");
    } else {
      setBlocks(null);
      setIsRawHtml(true);
    }
  }, [isNew, template]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (
        event.data?.type === "amie-block-select" &&
        Number.isInteger(event.data.index)
      )
        setSelectedBlock(event.data.index);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  useEffect(() => {
    if (selectedBlock !== null)
      iframeRef.current?.contentWindow?.postMessage(
        { type: "amie-block-highlight", index: selectedBlock },
        "*",
      );
  }, [previewHtml, selectedBlock]);

  const compose = useCallback(
    async (message: string, recipe?: AmieRecipe) => {
      const cleanMessage = message.trim();
      if (!cleanMessage || !workspaceId || isComposing || isRawHtml) return;
      const revision = blocks !== null && !recipe;
      const nextConversation: ConversationMessage[] = revision
        ? [...conversation, { role: "user", content: cleanMessage }]
        : [{ role: "user", content: cleanMessage }];
      const request: AmieComposeRequest = {
        workspaceId,
        prompt: revision ? originalPrompt : cleanMessage,
        images: assets.map((asset) => ({
          url: asset.url,
          name: asset.name,
          alt: asset.alt,
        })),
        ...(Object.keys(designBrief).length > 0 || recipe !== undefined
          ? {
              designBrief: recipe
                ? { ...designBrief, goal: recipe.id }
                : designBrief,
            }
          : {}),
        ...(recipe ? { seedBlocks: recipe.seedBlocks } : {}),
        ...(revision
          ? {
              currentBlocks: blocks,
              currentSubject: subject,
              currentPreviewText: previewText,
              conversation: nextConversation,
            }
          : {}),
      };
      setIsComposing(true);
      setComposeError(null);
      setComposeWarnings([]);
      setComposeStatus("Thinking…");
      setRetryMessage(cleanMessage);
      const assistantIndex = nextConversation.length;
      setConversation([
        ...nextConversation,
        { role: "assistant", content: "" },
      ]);
      try {
        const response = await streamAmieComposition({
          url: `${baseApiUrl}/content/templates/compose/stream`,
          request,
          headers: authHeaders,
          onStatus: setComposeStatus,
          onChunk: (text) =>
            setConversation((current) =>
              current.map((entry, index) =>
                index === assistantIndex
                  ? { ...entry, content: `${entry.content}${text}` }
                  : entry,
              ),
            ),
        });
        setSubject(response.subject);
        setPreviewText(response.previewText);
        setBlocks(response.blocks);
        setHtml(response.html);
        setDesignNotes(response.designNotes);
        setComposeWarnings(response.warnings ?? []);
        setSelectedBlock(response.blocks.length ? 0 : null);
        setBlockEditVersion(0);
        setConversation((current) =>
          current.map((entry, index) =>
            index === assistantIndex && !entry.content
              ? assistantConfirmation(revision)
              : entry,
          ),
        );
        if (!revision) setOriginalPrompt(cleanMessage);
        setInput("");
        setRetryMessage(null);
      } catch {
        setConversation(nextConversation);
        setComposeError(
          revision
            ? "That change didn’t go through. Your draft is untouched."
            : "The designed draft couldn’t be composed just now.",
        );
      } finally {
        setIsComposing(false);
      }
    },
    [
      assets,
      authHeaders,
      baseApiUrl,
      blocks,
      conversation,
      designBrief,
      isComposing,
      isRawHtml,
      originalPrompt,
      previewText,
      subject,
      workspaceId,
    ],
  );

  const editBlocks = useCallback(
    (updater: (current: AmieBlockSpec[]) => AmieBlockSpec[]) => {
      setBlocks((current) => (current ? updater(current) : current));
      setBlockEditVersion((version) => version + 1);
    },
    [],
  );

  useEffect(() => {
    if (!blocks || blockEditVersion === 0 || !workspaceId) return undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsAssembling(true);
      setAssembleError(null);
      try {
        const response = await axios.post<AmieAssembleResponse>(
          `${baseApiUrl}/content/templates/compose/assemble`,
          { workspaceId, blocks },
          { headers: authHeaders, signal: controller.signal },
        );
        setHtml(withPreviewText(response.data.html, previewText));
      } catch (error) {
        if (!axios.isCancel(error))
          setAssembleError(
            "Preview refresh paused. Check required fields and try again.",
          );
      } finally {
        setIsAssembling(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    authHeaders,
    baseApiUrl,
    blockEditVersion,
    blocks,
    previewText,
    workspaceId,
  ]);

  const chooseImage = (index: number, asset: AmieAsset) => {
    setAssets((current) =>
      current.some((item) => item.id === asset.id)
        ? current
        : [asset, ...current],
    );
    editBlocks((current) =>
      current.map((block, blockIndex) => {
        if (blockIndex !== index) return block;
        if (block.type === "image" || block.type === "heroImage")
          return {
            ...block,
            params: {
              ...block.params,
              src: asset.url,
              alt: asset.alt,
            },
          };
        if (block.type === "productCard")
          return { ...block, params: { ...block.params, imageUrl: asset.url } };
        if (block.type === "twoColumn")
          return {
            ...block,
            params: {
              ...block.params,
              image: {
                ...block.params.image,
                src: asset.url,
                alt: asset.alt,
              },
            },
          };
        return block;
      }),
    );
  };

  const handleImportHtml = async () => {
    if (!workspaceId || !pastedHtml.trim() || isImportingHtml) return;
    setIsImportingHtml(true);
    setPasteHtmlError(null);
    try {
      const response = await axios.post<AmieComposeResponse>(
        `${baseApiUrl}/content/templates/compose/import-html`,
        { workspaceId, html: pastedHtml },
        { headers: authHeaders },
      );
      const rawFallback =
        response.data.blocks.length === 1 &&
        response.data.blocks[0]?.type === "rawHtml";
      setSubject(response.data.subject);
      setPreviewText(response.data.previewText);
      setBlocks(response.data.blocks);
      setHtml(response.data.html);
      setDesignNotes(response.data.designNotes);
      setIsRawHtml(rawFallback);
      setSelectedBlock(0);
      setPastedHtml("");
      setPasteHtmlDialogOpen(false);
    } catch {
      setPasteHtmlError("The HTML couldn’t be converted. Please try again.");
    } finally {
      setIsImportingHtml(false);
    }
  };

  const handleSave = async () => {
    if (
      !hasDraft ||
      !workspaceId ||
      !subject.trim() ||
      (!isNew && templateQuery.isLoading)
    )
      return;
    setSaveError(null);
    try {
      let body = html;
      if (!isRawHtml && blocks) {
        const assembled = await axios.post<AmieAssembleResponse>(
          `${baseApiUrl}/content/templates/compose/assemble`,
          { workspaceId, blocks },
          { headers: authHeaders },
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
          amieBlocks: isRawHtml ? null : blocks,
        },
        ...(isNew ? { resourceType: ResourceTypeEnum.Declarative } : {}),
      });
      universalRouter.push(`/templates/email/${saved.id}`);
    } catch {
      setSaveError("The template wasn’t saved. Nothing was lost — try again.");
    }
  };

  if (!composerConfig.data?.enabled) return null;

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ pb: 2 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <IconButton
            onClick={() =>
              universalRouter.push(
                isNew ? "/templates" : `/templates/email/${templateId}`,
              )
            }
            aria-label="Back to template"
          >
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
              AI builds the full design; you refine brand-safe blocks.
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
        <Alert severity="error" sx={{ mb: 1 }}>
          {saveError}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(270px,.7fr) minmax(420px,1.25fr) minmax(330px,.8fr)",
          },
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          border: `1px solid ${tokens.colors.borderCard}`,
          borderRadius: `${tokens.radii.card}px`,
          boxShadow: tokens.shadows.medium,
          bgcolor: tokens.colors.surface,
        }}
      >
        <Stack
          sx={{
            minHeight: 0,
            borderRight: { lg: `1px solid ${tokens.colors.chromeDivider}` },
            bgcolor: tokens.colors.ivory,
          }}
        >
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2.5 }}>
            {!hasDraft ? (
              <Stack spacing={2.25}>
                <Box>
                  <AutoAwesome sx={{ color: tokens.colors.deepTeal }} />
                  <Typography
                    sx={{
                      fontFamily: tokens.typography.displayFontFamily,
                      fontSize: 22,
                      fontWeight: 600,
                    }}
                  >
                    Start from
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Choose a proven shape or describe your own.
                  </Typography>
                </Box>
                <Box sx={{ display: "grid", gap: 1 }}>
                  {AMIE_RECIPES.map((recipe) => (
                    <Button
                      key={recipe.id}
                      variant="outlined"
                      disabled={isComposing}
                      onClick={() => {
                        setDesignBrief((current) => ({
                          ...current,
                          goal: recipe.id,
                        }));
                        void compose(recipe.prompt, recipe);
                      }}
                      sx={{ display: "block", textAlign: "left", p: 1.5 }}
                    >
                      <Typography variant="body2" fontWeight={700}>
                        {recipe.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {recipe.description}
                      </Typography>
                    </Button>
                  ))}
                </Box>
                <TextField
                  multiline
                  minRows={5}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Or describe the email…"
                  disabled={isComposing}
                  fullWidth
                />
                <Button
                  variant="contained"
                  onClick={() => void compose(input)}
                  disabled={!input.trim() || isComposing || !workspaceId}
                  endIcon={<Send fontSize="small" />}
                >
                  Design email
                </Button>
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                {conversation.map((message) => (
                  <Box
                    key={`${message.role}-${message.content}`}
                    sx={{
                      alignSelf:
                        message.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "90%",
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      color:
                        message.role === "user" ? "white" : tokens.colors.text,
                      bgcolor:
                        message.role === "user"
                          ? tokens.colors.deepTeal
                          : tokens.colors.surface,
                      border:
                        message.role === "assistant"
                          ? `1px solid ${tokens.colors.borderSoft}`
                          : "none",
                    }}
                  >
                    <Typography variant="body2">{message.content}</Typography>
                  </Box>
                ))}
                {designNotes && (
                  <Alert
                    severity="info"
                    icon={<AutoAwesome fontSize="small" />}
                  >
                    {designNotes}
                  </Alert>
                )}
              </Stack>
            )}
            {isComposing && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mt: 2 }}
              >
                <CircularProgress size={17} />
                <Typography variant="body2" fontWeight={600}>
                  {composeStatus}
                </Typography>
              </Stack>
            )}
            {composeWarnings.length ? (
              <Alert
                severity="warning"
                icon={false}
                sx={{ mt: 1, fontSize: 12 }}
              >
                {composeWarnings.join(" ")}
              </Alert>
            ) : null}
            {composeError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {composeError}
                <Button
                  size="small"
                  onClick={() => retryMessage && void compose(retryMessage)}
                >
                  Retry
                </Button>
              </Alert>
            )}
          </Box>
          <Box
            sx={{ p: 2, borderTop: `1px solid ${tokens.colors.chromeDivider}` }}
          >
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Goal</InputLabel>
                  <Select
                    label="Goal"
                    value={designBrief.goal ?? ""}
                    onChange={(event) =>
                      setDesignBrief((current) => ({
                        ...current,
                        goal: designGoal(event.target.value),
                      }))
                    }
                  >
                    <MenuItem value="">
                      <em>Auto</em>
                    </MenuItem>
                    {[
                      ["winback", "Winback"],
                      ["launch", "Launch"],
                      ["newsletter", "Newsletter"],
                      ["promo", "Promo"],
                      ["welcome", "Welcome"],
                    ].map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Tone</InputLabel>
                  <Select
                    label="Tone"
                    value={designBrief.tone ?? ""}
                    onChange={(event) =>
                      setDesignBrief((current) => ({
                        ...current,
                        tone: designTone(event.target.value),
                      }))
                    }
                  >
                    <MenuItem value="">
                      <em>Auto</em>
                    </MenuItem>
                    <MenuItem value="warm">Warm</MenuItem>
                    <MenuItem value="clinical">Clinical</MenuItem>
                    <MenuItem value="playful">Playful</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <Stack direction="row" spacing={1}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Density</InputLabel>
                  <Select
                    label="Density"
                    value={designBrief.density ?? ""}
                    onChange={(event) =>
                      setDesignBrief((current) => ({
                        ...current,
                        density: designDensity(event.target.value),
                      }))
                    }
                  >
                    <MenuItem value="">
                      <em>Auto</em>
                    </MenuItem>
                    <MenuItem value="airy">Airy</MenuItem>
                    <MenuItem value="standard">Standard</MenuItem>
                    <MenuItem value="dense">Dense</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel>Hero</InputLabel>
                  <Select
                    label="Hero"
                    value={designBrief.heroStyle ?? ""}
                    onChange={(event) =>
                      setDesignBrief((current) => ({
                        ...current,
                        heroStyle: designHero(event.target.value),
                      }))
                    }
                  >
                    <MenuItem value="">
                      <em>Auto</em>
                    </MenuItem>
                    <MenuItem value="bigImage">Big image</MenuItem>
                    <MenuItem value="headlineFirst">Headline first</MenuItem>
                    <MenuItem value="productFirst">Product first</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <TextField
                size="small"
                label="CTA text"
                value={designBrief.ctaText ?? ""}
                onChange={(event) =>
                  setDesignBrief((current) => ({
                    ...current,
                    ctaText: event.target.value || undefined,
                  }))
                }
              />
              <TextField
                size="small"
                label="CTA URL"
                value={designBrief.ctaUrl ?? ""}
                onChange={(event) =>
                  setDesignBrief((current) => ({
                    ...current,
                    ctaUrl: event.target.value ? event.target.value : undefined,
                  }))
                }
              />
              {hasDraft && (
                <>
                  <TextField
                    multiline
                    minRows={3}
                    maxRows={5}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={
                      isRawHtml
                        ? "AI revision is unavailable for raw HTML"
                        : "Tell AI what to revise…"
                    }
                    disabled={isComposing || isRawHtml}
                  />
                  <Button
                    variant="contained"
                    onClick={() => void compose(input)}
                    disabled={!input.trim() || isComposing || isRawHtml}
                    endIcon={<Send fontSize="small" />}
                  >
                    Revise
                  </Button>
                </>
              )}
              <Stack direction="row" spacing={0.5}>
                <Button
                  size="small"
                  onClick={() => {
                    setPasteHtmlError(null);
                    setPasteHtmlDialogOpen(true);
                  }}
                >
                  Paste HTML
                </Button>
                <ImageAssetsPanel
                  label="Images"
                  onInsert={(asset) =>
                    setAssets((current) =>
                      current.some((item) => item.id === asset.id)
                        ? current
                        : [asset, ...current],
                    )
                  }
                  onUploaded={(asset) =>
                    setAssets((current) => [
                      asset,
                      ...current.filter((item) => item.id !== asset.id),
                    ])
                  }
                />
              </Stack>
            </Stack>
          </Box>
        </Stack>

        <Box
          sx={{
            minHeight: 0,
            overflowY: "auto",
            bgcolor: tokens.colors.surfaceWarm,
            p: { xs: 2, md: 2.5 },
          }}
        >
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                label="Subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={!hasDraft}
                fullWidth
                size="small"
                inputProps={{ maxLength: 60 }}
                helperText={`${subject.length}/60`}
              />
              <TextField
                label="Preview text"
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                disabled={!hasDraft || isRawHtml}
                fullWidth
                size="small"
              />
            </Stack>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="overline" color="text.secondary">
                Live preview
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={previewWidth}
                onChange={(_event, value) => value && setPreviewWidth(value)}
              >
                <ToggleButton value="desktop">Desktop</ToggleButton>
                <ToggleButton value="mobile">Mobile</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            {assembleError && (
              <Alert severity="warning">
                {assembleError}
                <Button
                  size="small"
                  onClick={() => setBlockEditVersion((version) => version + 1)}
                >
                  Retry
                </Button>
              </Alert>
            )}
            <Box sx={{ overflowX: "auto" }}>
              <Paper
                sx={{
                  width: previewWidth === "desktop" ? 600 : 375,
                  maxWidth: "100%",
                  mx: "auto",
                  overflow: "hidden",
                  border: `1px solid ${tokens.colors.borderCard}`,
                  boxShadow: tokens.shadows.medium,
                  bgcolor: tokens.colors.emailPreview,
                }}
              >
                {html ? (
                  <iframe
                    ref={iframeRef}
                    sandbox="allow-scripts"
                    srcDoc={previewHtml}
                    title="Composed email preview"
                    onLoad={() =>
                      selectedBlock !== null &&
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: "amie-block-highlight", index: selectedBlock },
                        "*",
                      )
                    }
                    style={{
                      display: "block",
                      width: "100%",
                      height: 760,
                      border: 0,
                    }}
                  />
                ) : (
                  <Stack
                    alignItems="center"
                    justifyContent="center"
                    sx={{ height: 520 }}
                  >
                    <AutoAwesome color="disabled" />
                    <Typography variant="body2" color="text.secondary">
                      Your preview will appear here.
                    </Typography>
                  </Stack>
                )}
              </Paper>
            </Box>
          </Stack>
        </Box>

        <Stack
          sx={{
            minHeight: 0,
            borderLeft: { lg: `1px solid ${tokens.colors.chromeDivider}` },
            bgcolor: tokens.colors.surface,
          }}
        >
          {blocks ? (
            <>
              <Box
                sx={{
                  p: 2,
                  borderBottom: `1px solid ${tokens.colors.chromeDivider}`,
                }}
              >
                <Stack direction="row" justifyContent="space-between">
                  <Box>
                    <Typography fontWeight={700}>Email blocks</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Drag to reorder · {blocks.length}/12
                    </Typography>
                  </Box>
                  {isAssembling && <CircularProgress size={16} />}
                </Stack>
              </Box>
              <Box
                sx={{
                  p: 1.5,
                  maxHeight: "44%",
                  overflowY: "auto",
                  borderBottom: `1px solid ${tokens.colors.chromeDivider}`,
                }}
              >
                <Stack alignItems="center">
                  <AddBlockPicker
                    disabled={blocks.length >= 12}
                    onAdd={(type) => {
                      editBlocks((current) => [createBlock(type), ...current]);
                      setSelectedBlock(0);
                    }}
                  />
                </Stack>
                {blocks.map((block, index) => (
                  // Blocks do not carry IDs; position is the persisted list identity.
                  // eslint-disable-next-line react/no-array-index-key
                  <React.Fragment key={`${block.type}-${index}`}>
                    <Paper
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragIndex !== null) {
                          editBlocks((current) =>
                            swapBlocks(current, dragIndex, index),
                          );
                          setSelectedBlock(index);
                        }
                        setDragIndex(null);
                      }}
                      onClick={() => setSelectedBlock(index)}
                      variant="outlined"
                      sx={{
                        my: 1,
                        p: 1,
                        cursor: "pointer",
                        borderColor:
                          selectedBlock === index
                            ? tokens.colors.deepTeal
                            : tokens.colors.borderCard,
                        bgcolor:
                          selectedBlock === index
                            ? tokens.colors.tealTint
                            : "white",
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={0.75}>
                        <DragIndicator fontSize="small" color="disabled" />
                        {blockIcon(block.type)}
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="caption" fontWeight={700}>
                            {block.type}
                          </Typography>
                          <Typography
                            variant="caption"
                            display="block"
                            noWrap
                            color="text.secondary"
                          >
                            {blockSummary(block)}
                          </Typography>
                        </Box>
                        <Tooltip title="Move up">
                          <span>
                            <IconButton
                              size="small"
                              disabled={index === 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                editBlocks((current) =>
                                  swapBlocks(current, index, index - 1),
                                );
                                setSelectedBlock(index - 1);
                              }}
                            >
                              <ArrowUpward fontSize="inherit" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Move down">
                          <span>
                            <IconButton
                              size="small"
                              disabled={index === blocks.length - 1}
                              onClick={(event) => {
                                event.stopPropagation();
                                editBlocks((current) =>
                                  swapBlocks(current, index, index + 1),
                                );
                                setSelectedBlock(index + 1);
                              }}
                            >
                              <ArrowDownward fontSize="inherit" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Duplicate">
                          <span>
                            <IconButton
                              size="small"
                              disabled={blocks.length >= 12}
                              onClick={(event) => {
                                event.stopPropagation();
                                editBlocks((current) => [
                                  ...current.slice(0, index + 1),
                                  structuredClone(block),
                                  ...current.slice(index + 1),
                                ]);
                                setSelectedBlock(index + 1);
                              }}
                            >
                              <ContentCopy fontSize="inherit" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip
                          title={
                            block.type === "footer"
                              ? "Footer is required"
                              : "Delete"
                          }
                        >
                          <span>
                            <IconButton
                              size="small"
                              disabled={block.type === "footer"}
                              onClick={(event) => {
                                event.stopPropagation();
                                editBlocks((current) =>
                                  current.filter(
                                    (_item, itemIndex) => itemIndex !== index,
                                  ),
                                );
                                setSelectedBlock((current) =>
                                  current === null
                                    ? null
                                    : Math.max(
                                        0,
                                        Math.min(current, blocks.length - 2),
                                      ),
                                );
                              }}
                            >
                              <DeleteOutline fontSize="inherit" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Paper>
                    <Stack alignItems="center">
                      <AddBlockPicker
                        disabled={blocks.length >= 12}
                        onAdd={(type) => {
                          editBlocks((current) => [
                            ...current.slice(0, index + 1),
                            createBlock(type),
                            ...current.slice(index + 1),
                          ]);
                          setSelectedBlock(index + 1);
                        }}
                      />
                    </Stack>
                  </React.Fragment>
                ))}
              </Box>
              <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: "auto" }}>
                {selectedBlock !== null && blocks[selectedBlock] ? (
                  <Inspector
                    block={blocks[selectedBlock]}
                    onChange={(next) =>
                      editBlocks((current) =>
                        current.map((block, index) =>
                          index === selectedBlock ? next : block,
                        ),
                      )
                    }
                    onChooseImage={(asset) => chooseImage(selectedBlock, asset)}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Select a block to edit it.
                  </Typography>
                )}
              </Box>
            </>
          ) : (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ height: "100%", p: 4 }}
            >
              <ViewAgenda color="disabled" />
              <Typography
                variant="body2"
                color="text.secondary"
                textAlign="center"
              >
                The block list and inspector appear after AI creates a design.
              </Typography>
            </Stack>
          )}
        </Stack>
      </Box>

      <Dialog
        open={pasteHtmlDialogOpen}
        onClose={() => !isImportingHtml && setPasteHtmlDialogOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Import email HTML</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              AI will convert the design into editable blocks. If conversion
              fails, the sanitized HTML stays intact as one block.
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
              disabled={isImportingHtml}
              fullWidth
            />
            {pastedHtml && !hasUnsubscribeField(pastedHtml) && (
              <Alert severity="warning">
                No unsubscribe merge tag was found.
              </Alert>
            )}
            {pastedHtml && !hasLiquidField(pastedHtml) && (
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
            disabled={isImportingHtml}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleImportHtml()}
            disabled={!pastedHtml.trim() || !workspaceId || isImportingHtml}
            startIcon={isImportingHtml ? <CircularProgress size={16} /> : null}
          >
            {isImportingHtml ? "Converting…" : "Convert to blocks"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
