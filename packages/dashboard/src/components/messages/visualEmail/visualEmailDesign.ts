import {
  AMIE_HOME_URL,
  AMIE_PLACEHOLDER_IMAGE_URL,
} from "isomorphic-lib/src/amieLinks";
import { withoutPreviewText } from "isomorphic-lib/src/emailPreviewText";
import {
  CodeEmailContents,
  EmailContentsType,
  VisualEmailDesign,
  VisualEmailEditorKind,
} from "isomorphic-lib/src/types";

export const VISUAL_EDITOR_ID = "grapesjs-mjml" as const;
/** Plain GrapesJS over a hand-written HTML document (see visualEmailHtml.ts). */
export const VISUAL_HTML_EDITOR_ID = "grapesjs-html" as const;

/**
 * Personalization the visual editor can insert. These are the exact Liquid
 * forms Amie Send renders (see backend-lib/src/liquid.ts): `user.*` profile
 * properties with a fallback, and the registered unsubscribe/view-in-browser
 * tags. Nothing here is Klaviyo/Mautic syntax.
 *
 * Entries with `linkText` are URLs: the text toolbar turns them into a link
 * (around the selected text, or labelled `linkText`), never plain text.
 */
export const VISUAL_EMAIL_VARIABLES: {
  label: string;
  value: string;
  linkText?: string;
}[] = [
  {
    label: "First name (fallback: there)",
    value: '{{ user.firstName | default: "there" }}',
  },
  { label: "Last name", value: '{{ user.lastName | default: "" }}' },
  { label: "Email address", value: "{{ user.email }}" },
  {
    label: "Unsubscribe URL",
    value: "{% unsubscribe_url %}",
    linkText: "Unsubscribe",
  },
  {
    label: "Manage subscriptions URL",
    value: "{% subscription_management_url %}",
    linkText: "Manage subscription",
  },
  {
    label: "View in browser URL",
    value: "{% view_in_browser_url %}",
    linkText: "View in browser",
  },
];

export const VISUAL_BRAND = {
  text: "#3E3733",
  muted: "#A39B93",
  teal: "#2D7A7A",
  rose: "#B76E79",
  page: "#FBF7F2",
};

export const VISUAL_FONT = "Helvetica, Arial, sans-serif";
const TEXT_ATTRS = `font-family="${VISUAL_FONT}" font-size="16px" line-height="26px" color="${VISUAL_BRAND.text}"`;
const BUTTON_ATTRS = `font-family="${VISUAL_FONT}" background-color="${VISUAL_BRAND.teal}" color="#FFFFFF" border-radius="999px" font-size="15px" font-weight="bold" inner-padding="14px 28px"`;

/**
 * Blank-but-sendable starting point: header, copy, CTA and the unsubscribe footer.
 * Styles are inline on each element (no <mj-attributes>) so the canvas shows
 * exactly what is sent and every value is editable in the style panel.
 */
export const STARTER_MJML = `<mjml>
  <mj-body background-color="${VISUAL_BRAND.page}" width="600px">
    <mj-section background-color="#FFFFFF" padding="28px 24px 8px">
      <mj-column>
        <mj-text align="center" font-family="Georgia, 'Times New Roman', serif" font-size="26px" font-weight="bold" color="${VISUAL_BRAND.text}">Amie<span style="color:${VISUAL_BRAND.rose};">.</span></mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#FFFFFF" padding="8px 24px">
      <mj-column>
        <mj-image src="${AMIE_PLACEHOLDER_IMAGE_URL}" alt="Describe this image" href="${AMIE_HOME_URL}" border-radius="12px"></mj-image>
        <mj-text ${TEXT_ATTRS}>Hi {{ user.firstName | default: "there" }},</mj-text>
        <mj-text ${TEXT_ATTRS}>Start writing here. Click any block to edit it, or drag new blocks in from the Blocks panel.</mj-text>
        <mj-button href="${AMIE_HOME_URL}" ${BUTTON_ATTRS}>Shop now</mj-button>
      </mj-column>
    </mj-section>
    <mj-section background-color="#FFFFFF" padding="16px 24px 28px" border-top="1px solid #F2EBE2">
      <mj-column>
        <mj-text align="center" font-family="${VISUAL_FONT}" font-size="12px" line-height="20px" color="${VISUAL_BRAND.muted}">{{ user.physicalAddress | default: "382 NE 191st St, Miami, FL 33179" }}</mj-text>
        <mj-text align="center" font-family="${VISUAL_FONT}" font-size="12px" line-height="20px" color="${VISUAL_BRAND.teal}"><a href="{% unsubscribe_url %}" target="_blank" style="color:${VISUAL_BRAND.teal};text-decoration:underline;">Unsubscribe</a></mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

/**
 * GrapesJS's parser treats `<mj-image ... />` as an open tag, nesting every
 * following sibling inside it (content disappears from the canvas and the
 * saved MJML is corrupted). Expand self-closing MJML tags before loading.
 */
export function expandSelfClosingMjml(mjml: string): string {
  return mjml.replace(
    /<(mj-[\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*\/>/g,
    "<$1$2></$1>",
  );
}

export type CodeEmailDraft = CodeEmailContents & { type: "Email" };

export function isMjmlBody(body: string | undefined | null): boolean {
  return /<mjml[\s>]/i.test(body ?? "");
}

export function hasUnsubscribeLink(mjmlOrHtml: string): boolean {
  return /\{%-?\s*(unsubscribe_url|unsubscribe_link|subscription_management_url|subscription_management_link)\b/.test(
    mjmlOrHtml,
  );
}

/**
 * How the visual editor should open a template:
 * - `design`: reopen the saved visual design (body still matches it).
 * - `stale`: a visual design exists but body was changed elsewhere (Code tab, AI).
 * - `importMjml`: no design yet, but body is MJML we can open visually.
 * - `importHtml`: no design yet and body is hand-written HTML (e.g. pasted from
 *   Mautic); it can be opened in the HTML visual editor after a risk check.
 * - `blank`: no design and no body — start from the starter template.
 */
export type VisualOpenState =
  | "design"
  | "stale"
  | "importMjml"
  | "importHtml"
  | "blank";

function normalize(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function visualOpenState(
  draft: Pick<CodeEmailContents, "body" | "visualDesign">,
): VisualOpenState {
  const design = draft.visualDesign;
  if (design) {
    // preview text is edited outside the visual editor (Subject/Settings)
    // and carried into every visual save, so it isn't an outside edit
    return normalize(withoutPreviewText(design.mjml)) ===
      normalize(withoutPreviewText(draft.body))
      ? "design"
      : "stale";
  }
  if (!draft.body.trim()) return "blank";
  return isMjmlBody(draft.body) ? "importMjml" : "importHtml";
}

/** Which editor a saved design belongs to (designs before HTML mode are MJML). */
export function visualDesignEditor(
  design: Pick<VisualEmailDesign, "editor"> | null | undefined,
): VisualEmailEditorKind {
  return design?.editor === VISUAL_HTML_EDITOR_ID
    ? VISUAL_HTML_EDITOR_ID
    : VISUAL_EDITOR_ID;
}

/**
 * `mjml` is the exact body the editor wrote — MJML for `grapesjs-mjml`, the
 * full HTML document for `grapesjs-html` (field name kept for compatibility).
 */
export function buildVisualDesign({
  project,
  mjml,
  editor = VISUAL_EDITOR_ID,
  now = new Date(),
}: {
  project: Record<string, unknown>;
  mjml: string;
  editor?: VisualEmailEditorKind;
  now?: Date;
}): VisualEmailDesign {
  return {
    version: 1,
    editor,
    project,
    mjml,
    updatedAt: now.toISOString(),
  };
}

/**
 * Apply a visual-editor save to a Code email draft. `body` becomes what the
 * editor produced — MJML or HTML (the send pipeline renders Liquid, then
 * compiles MJML only when the body is MJML; HTML is sent as rendered), and
 * AI composer blocks are cleared so the composer can't rebuild body over it.
 */
export function applyVisualSave<T extends CodeEmailContents>(
  draft: T,
  design: VisualEmailDesign,
): T & { amieBlocks: null; visualDesign: VisualEmailDesign } {
  return {
    ...draft,
    emailContentsType: EmailContentsType.Code,
    body: design.mjml,
    amieBlocks: null,
    visualDesign: design,
  };
}
