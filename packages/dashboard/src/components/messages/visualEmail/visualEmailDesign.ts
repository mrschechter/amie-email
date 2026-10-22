import {
  AMIE_HOME_URL,
  AMIE_PLACEHOLDER_IMAGE_URL,
} from "isomorphic-lib/src/amieLinks";
import {
  CodeEmailContents,
  EmailContentsType,
  VisualEmailDesign,
} from "isomorphic-lib/src/types";

export const VISUAL_EDITOR_ID = "grapesjs-mjml" as const;

/**
 * Personalization the visual editor can insert. These are the exact Liquid
 * forms Amie Send renders (see backend-lib/src/liquid.ts): `user.*` profile
 * properties with a fallback, and the registered unsubscribe/view-in-browser
 * tags. Nothing here is Klaviyo/Mautic syntax.
 */
export const VISUAL_EMAIL_VARIABLES: { label: string; value: string }[] = [
  {
    label: "First name (fallback: there)",
    value: '{{ user.firstName | default: "there" }}',
  },
  { label: "Last name", value: '{{ user.lastName | default: "" }}' },
  { label: "Email address", value: "{{ user.email }}" },
  { label: "Unsubscribe URL", value: "{% unsubscribe_url %}" },
  {
    label: "Manage subscriptions URL",
    value: "{% subscription_management_url %}",
  },
  { label: "View in browser URL", value: "{% view_in_browser_url %}" },
];

const BRAND = {
  text: "#3E3733",
  muted: "#A39B93",
  teal: "#2D7A7A",
  rose: "#B76E79",
  page: "#FBF7F2",
};

const FONT = "Helvetica, Arial, sans-serif";
const TEXT_ATTRS = `font-family="${FONT}" font-size="16px" line-height="26px" color="${BRAND.text}"`;
const BUTTON_ATTRS = `font-family="${FONT}" background-color="${BRAND.teal}" color="#FFFFFF" border-radius="999px" font-size="15px" font-weight="bold" inner-padding="14px 28px"`;

/**
 * Blank-but-sendable starting point: header, copy, CTA and the unsubscribe footer.
 * Styles are inline on each element (no <mj-attributes>) so the canvas shows
 * exactly what is sent and every value is editable in the style panel.
 */
export const STARTER_MJML = `<mjml>
  <mj-body background-color="${BRAND.page}" width="600px">
    <mj-section background-color="#FFFFFF" padding="28px 24px 8px">
      <mj-column>
        <mj-text align="center" font-family="Georgia, 'Times New Roman', serif" font-size="26px" font-weight="bold" color="${BRAND.text}">Amie<span style="color:${BRAND.rose};">.</span></mj-text>
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
        <mj-text align="center" font-family="${FONT}" font-size="12px" line-height="20px" color="${BRAND.muted}">{{ user.physicalAddress | default: "382 NE 191st St, Miami, FL 33179" }}</mj-text>
        <mj-text align="center" font-family="${FONT}" font-size="12px" line-height="20px" color="${BRAND.teal}"><a href="{% unsubscribe_url %}" target="_blank" style="color:${BRAND.teal};text-decoration:underline;">Unsubscribe</a></mj-text>
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
 * - `blank`: no design and no body — start from the starter template.
 * - `customHtml`: body is hand-written HTML; we never auto-convert it.
 */
export type VisualOpenState =
  | "design"
  | "stale"
  | "importMjml"
  | "blank"
  | "customHtml";

function normalize(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function visualOpenState(
  draft: Pick<CodeEmailContents, "body" | "visualDesign">,
): VisualOpenState {
  const design = draft.visualDesign;
  if (design) {
    return normalize(design.mjml) === normalize(draft.body)
      ? "design"
      : "stale";
  }
  if (!draft.body.trim()) return "blank";
  return isMjmlBody(draft.body) ? "importMjml" : "customHtml";
}

export function buildVisualDesign({
  project,
  mjml,
  now = new Date(),
}: {
  project: Record<string, unknown>;
  mjml: string;
  now?: Date;
}): VisualEmailDesign {
  return {
    version: 1,
    editor: VISUAL_EDITOR_ID,
    project,
    mjml,
    updatedAt: now.toISOString(),
  };
}

/**
 * Apply a visual-editor save to a Code email draft. `body` becomes the MJML the
 * editor produced (the send pipeline renders Liquid, then compiles MJML), and
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
