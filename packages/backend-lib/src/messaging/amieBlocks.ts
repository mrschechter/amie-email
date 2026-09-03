import {
  AmieBigImageParams,
  AmieBlockSpec,
  AmieBlockStyle,
  AmieBrandBackground,
  AmieBulletListParams,
  AmieColumnsParams,
  AmieCtaButtonParams,
  AmieCustomHtmlParams,
  AmieDividerParams,
  AmieFooterParams,
  AmieHeaderParams,
  AmieHeroHeadingParams,
  AmieHeroImageParams,
  AmieImageParams,
  AmieImageTextParams,
  AmieParagraphParams,
  AmieProductCardParams,
  AmieQuoteCalloutParams,
  AmieRawHtmlParams,
  AmieSectionBreakParams,
  AmieSpacerParams,
  AmieStatsRowParams,
  AmieTestimonialParams,
  AmieTwoColumnParams,
  sanitizeAmieHtml,
} from "isomorphic-lib/src/amieComposer";
import { assertUnreachable } from "isomorphic-lib/src/typeAssertions";

const TABLE_RESET =
  "border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;";
const DEFAULT_AMIE_MAILING_ADDRESS =
  "Amie Health · 382 NE 191st St, Miami, FL 33179";

export const AMIE_BACKGROUND_COLORS: Record<AmieBrandBackground, string> = {
  ivory: "#FAF8F5",
  blush: "#F5E6E0",
  white: "#FFFFFF",
  teal: "#2D7A7A",
  sage: "#9CAF88",
};

function escapeHtml(value: string): string {
  return value
    .split(/({{[\s\S]*?}}|{%[\s\S]*?%})/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/&(?!(?:nbsp);)/gi, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
    )
    .join("");
}

/** Escape first, then apply the deliberately small Markdown-lite grammar. */
export function markdownLite(value: string): string {
  return escapeHtml(value)
    .replace(
      /\[([^\]\r\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" style="color:#2D7A7A;text-decoration:underline;">$1</a>',
    )
    .replace(/\*\*([^*\r\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\r\n]+)\*/g, "<em>$1</em>")
    .replace(/\r?\n/g, "<br>");
}

function textWithLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function httpUrl(value: string): string | null {
  if (/^\s*{{[\s\S]*}}\s*$/.test(value)) return escapeHtml(value.trim());
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return escapeHtml(parsed.toString());
  } catch {
    return null;
  }
}

function align(style?: AmieBlockStyle): "left" | "center" {
  return style?.align ?? "left";
}

function pad(style: AmieBlockStyle | undefined, normal: number): number {
  if (style?.padding === "none") return 0;
  if (style?.padding === "tight") return 14;
  if (style?.padding === "loose") return 38;
  return normal;
}

function fontSize(
  style: AmieBlockStyle | undefined,
  normal: number,
): { size: number; line: number } {
  let delta = 0;
  if (style?.textSize === "s") delta = -2;
  if (style?.textSize === "l") delta = 4;
  const size = normal + delta;
  return { size, line: size + (normal >= 24 ? 9 : 10) };
}

function background(style?: AmieBlockStyle): string | undefined {
  if (style?.background === "custom") return style.backgroundHex;
  return style?.background
    ? AMIE_BACKGROUND_COLORS[style.background]
    : undefined;
}

function horizontalPadding(
  style: AmieBlockStyle | undefined,
  fallback: number,
): number {
  if (style?.width === "full") return 0;
  if (style?.width === "inset") return 24;
  return fallback;
}

function table(content: string, style?: AmieBlockStyle): string {
  const bg = background(style);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${bg ? ` bgcolor="${bg}"` : ""} style="width:100%;${TABLE_RESET}${bg ? `background-color:${bg};` : ""}">${content}</table>`;
}

function buttonMarkup(
  labelValue: string,
  urlValue: string,
  style?: AmieBlockStyle,
): string {
  const url = httpUrl(urlValue) ?? "#";
  const label = escapeHtml(labelValue);
  const variant = style?.buttonVariant ?? "primary";
  let fill = "#2D7A7A";
  if (variant === "roseGold") fill = "#B76E79";
  if (variant === "secondary") fill = "#FFFFFF";
  const text = variant === "secondary" ? "#2D7A7A" : "#FFFFFF";
  const border = variant === "secondary" ? "border:2px solid #2D7A7A;" : "";
  const stroke =
    variant === "secondary" ? 'stroke="t" strokecolor="#2D7A7A"' : 'stroke="f"';
  return `<!--[if mso]><v:roundrect href="${url}" style="height:46px;v-text-anchor:middle;width:230px;" arcsize="17%" ${stroke} fillcolor="${fill}"><w:anchorlock/><center style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:${text};">${label}</center></v:roundrect><![endif]--><!--[if !mso]><!-- --><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt;"><tr><td align="center" bgcolor="${fill}" style="border-radius:8px;background-color:${fill};${border}"><a href="${url}" target="_blank" style="display:inline-block;padding:12px 25px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:bold;color:${text};text-decoration:none;border-radius:8px;">${label}</a></td></tr></table><!--<![endif]-->`;
}

export function header(
  _params: AmieHeaderParams = {},
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td align="${style?.align ?? "center"}" style="padding:${pad(style, 22)}px 48px 19px;border-bottom:1px solid #F2EBE2;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:28px;font-weight:bold;color:#3E3733;">Amie<span style="color:#B76E79;">.</span></td></tr>`,
    style,
  );
}

export function heroHeading(
  params: AmieHeroHeadingParams,
  style?: AmieBlockStyle,
): string {
  const type = fontSize(style, 30);
  const subtitle = params.subtitle
    ? `<tr><td align="${align(style)}" style="padding:14px 48px 0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#6B635B;">${markdownLite(params.subtitle)}</td></tr>`
    : "";
  return table(
    `<tr><td align="${align(style)}" style="padding:${pad(style, 36)}px 48px 0;font-family:Georgia,'Times New Roman',serif;font-size:${type.size}px;line-height:${type.line}px;font-weight:bold;color:#3E3733;">${markdownLite(params.title)}</td></tr>${subtitle}`,
    style,
  );
}

export function paragraph(
  params: AmieParagraphParams,
  style?: AmieBlockStyle,
): string {
  const type = fontSize(style, 16);
  return table(
    `<tr><td align="${align(style)}" style="padding:${pad(style, 22)}px 48px 0;font-family:Helvetica,Arial,sans-serif;font-size:${type.size}px;line-height:${type.line}px;color:#4A4A4A;">${markdownLite(params.text)}</td></tr>`,
    style,
  );
}

export function ctaButton(
  params: AmieCtaButtonParams,
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td align="${align(style)}" style="padding:${pad(style, 22)}px 48px 0;">${buttonMarkup(params.label, params.url, style)}</td></tr>`,
    style,
  );
}

export function productCard(
  params: AmieProductCardParams,
  style?: AmieBlockStyle,
): string {
  const imageUrl = params.imageUrl ? httpUrl(params.imageUrl) : null;
  const imageContent = imageUrl
    ? `<tr><td style="padding:0 0 18px;"><img src="${imageUrl}" width="504" alt="${escapeHtml(params.title)}" style="display:block;width:100%;max-width:504px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>`
    : "";
  const price = params.price
    ? `<tr><td align="${align(style)}" style="padding:8px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;font-weight:bold;color:#B76E79;">${escapeHtml(params.price)}</td></tr>`
    : "";
  const cardCta =
    params.ctaLabel && params.ctaUrl
      ? `<tr><td align="${align(style)}" style="padding:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;font-weight:bold;"><a href="${httpUrl(params.ctaUrl) ?? "#"}" target="_blank" style="color:#2D7A7A;text-decoration:none;">${escapeHtml(params.ctaLabel)} →</a></td></tr>`
      : "";
  return table(
    `<tr><td style="padding:${pad(style, 26)}px 48px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}border:1px solid #F2EBE2;"><tr><td style="padding:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">${imageContent}<tr><td align="${align(style)}" style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:29px;font-weight:bold;color:#3E3733;">${textWithLineBreaks(params.title)}</td></tr><tr><td align="${align(style)}" style="padding:9px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#6B635B;">${textWithLineBreaks(params.description)}</td></tr>${price}${cardCta}</table></td></tr></table></td></tr>`,
    style,
  );
}

export function image(params: AmieImageParams, style?: AmieBlockStyle): string {
  const src = httpUrl(params.src) ?? "";
  const width = params.width ?? 600;
  const imageHtml = `<img src="${src}" width="${width}" alt="${escapeHtml(params.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const content = params.href
    ? `<a href="${httpUrl(params.href) ?? "#"}" target="_blank" style="text-decoration:none;">${imageHtml}</a>`
    : imageHtml;
  return table(
    `<tr><td align="${style?.align ?? "center"}" style="padding:${pad(style, 26)}px ${horizontalPadding(style, 0)}px 0;">${content}</td></tr>`,
    style,
  );
}

export function bigImage(
  params: AmieBigImageParams,
  style?: AmieBlockStyle,
): string {
  const src = httpUrl(params.src) ?? "";
  const imageHtml = `<img src="${src}" width="600" alt="${escapeHtml(params.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const content = params.href
    ? `<a href="${httpUrl(params.href) ?? "#"}" target="_blank" style="text-decoration:none;">${imageHtml}</a>`
    : imageHtml;
  return table(
    `<tr><td align="center" style="padding:${pad(style, 26)}px ${horizontalPadding(style, 0)}px 0;">${content}</td></tr>`,
    style,
  );
}

export function heroImage(
  params: AmieHeroImageParams,
  style?: AmieBlockStyle,
): string {
  const src = httpUrl(params.src) ?? "";
  const imageHtml = `<img src="${src}" width="600" alt="${escapeHtml(params.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const content = params.href
    ? `<a href="${httpUrl(params.href) ?? "#"}" target="_blank" style="text-decoration:none;">${imageHtml}</a>`
    : imageHtml;
  const headline = params.headline
    ? `<tr><td align="${align(style)}" style="padding:${pad(style, 28)}px 48px 0;font-family:Georgia,'Times New Roman',serif;font-size:${fontSize(style, 30).size}px;line-height:38px;font-weight:bold;color:#3E3733;">${markdownLite(params.headline)}</td></tr>`
    : "";
  return table(`<tr><td align="center">${content}</td></tr>${headline}`, style);
}

export function testimonial(
  params: AmieTestimonialParams,
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td style="padding:${pad(style, 26)}px 48px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}background-color:#FAF8F5;"><tr><td align="${align(style)}" style="padding:24px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:30px;font-style:italic;color:#3E3733;">“${textWithLineBreaks(params.quote)}”</td></tr><tr><td align="${align(style)}" style="padding:0 24px 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;font-weight:bold;color:#8A8178;">— ${escapeHtml(params.attribution)}</td></tr></table></td></tr>`,
    style,
  );
}

export function divider(
  _params: AmieDividerParams = {},
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td style="padding:${pad(style, 26)}px 48px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;background-color:#F2EBE2;">&nbsp;</td></tr></table></td></tr>`,
    style,
  );
}

export function footer(
  params: AmieFooterParams,
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td align="center" style="padding:${pad(style, 24)}px 48px 28px;border-top:1px solid #F2EBE2;font-family:Helvetica,Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr><td align="center" style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:22px;font-weight:bold;color:#3E3733;">Amie<span style="color:#B76E79;">.</span></td></tr><tr><td align="center" style="padding:8px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#A39B93;">${textWithLineBreaks(params.addressLine)}</td></tr><tr><td align="center" style="padding:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#2D7A7A;"><a href="{% unsubscribe_url %}" target="_blank" style="color:#2D7A7A;text-decoration:underline;">${escapeHtml(params.unsubscribe)}</a></td></tr><tr><td align="center" style="padding:10px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:17px;color:#C2B9AE;">You&#39;re receiving this because you opted in to hear from Amie.</td></tr></table></td></tr>`,
    style ?? { background: "ivory" },
  );
}

function ratioWidths(
  ratio: "50/50" | "40/60" | "60/40" | undefined,
): [number, number] {
  if (ratio === "40/60") return [40, 60];
  if (ratio === "60/40") return [60, 40];
  return [50, 50];
}

export function twoColumn(
  params: AmieTwoColumnParams,
  style?: AmieBlockStyle,
): string {
  const src = httpUrl(params.image.src) ?? "";
  const imageTag = `<img src="${src}" width="246" alt="${escapeHtml(params.image.alt)}" style="display:block;width:100%;max-width:246px;height:auto;border:0;">`;
  const imageContent = params.image.href
    ? `<a href="${httpUrl(params.image.href) ?? "#"}" target="_blank">${imageTag}</a>`
    : imageTag;
  const heading = params.heading
    ? `<tr><td align="${align(style)}" style="padding:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:29px;font-weight:bold;color:#3E3733;">${textWithLineBreaks(params.heading)}</td></tr>`
    : "";
  const cta = params.cta
    ? `<tr><td align="${align(style)}" style="padding:16px 0 0;">${buttonMarkup(params.cta.label, params.cta.url, style)}</td></tr>`
    : "";
  const [imageWidth, copyWidth] = ratioWidths(params.ratio);
  const imageCell = `<td class="amie-stack-column" width="${imageWidth}%" valign="middle" style="width:${imageWidth}%;padding:0 12px;">${imageContent}</td>`;
  const copyCell = `<td class="amie-stack-column" width="${copyWidth}%" valign="middle" style="width:${copyWidth}%;padding:0 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">${heading}<tr><td align="${align(style)}" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4A4A4A;">${textWithLineBreaks(params.body)}</td></tr>${cta}</table></td>`;
  return table(
    `<tr><td style="padding:${pad(style, 28)}px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr>${(params.imageSide ?? "left") === "left" ? imageCell + copyCell : copyCell + imageCell}</tr></table></td></tr>`,
    style,
  );
}

function linkedImage(
  imageValue: { src: string; alt: string; href?: string },
  width: number,
): string {
  const tag = `<img src="${httpUrl(imageValue.src) ?? ""}" width="${width}" alt="${escapeHtml(imageValue.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;">`;
  return imageValue.href
    ? `<a href="${httpUrl(imageValue.href) ?? "#"}" target="_blank">${tag}</a>`
    : tag;
}

export function columns(
  params: AmieColumnsParams,
  style?: AmieBlockStyle,
): string {
  const width = Math.floor(100 / params.columns.length);
  const cells = params.columns
    .map((column) => {
      const imageContent = column.image
        ? `<tr><td style="padding:0 0 12px;">${linkedImage(column.image, 240)}</td></tr>`
        : "";
      return `<td class="amie-stack-column" width="${width}%" valign="top" style="width:${width}%;padding:12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">${imageContent}<tr><td align="${align(style)}" style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:27px;font-weight:bold;color:#3E3733;">${markdownLite(column.heading)}</td></tr><tr><td align="${align(style)}" style="padding-top:8px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4A4A4A;">${markdownLite(column.text)}</td></tr></table></td>`;
    })
    .join("");
  return table(
    `<tr><td style="padding:${pad(style, 24)}px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr>${cells}</tr></table></td></tr>`,
    style,
  );
}

export function imageText(
  params: AmieImageTextParams,
  style?: AmieBlockStyle,
): string {
  const [imageWidth, copyWidth] = ratioWidths(params.ratio);
  const imageCell = `<td class="amie-stack-column" width="${imageWidth}%" valign="middle" style="width:${imageWidth}%;padding:0 12px;">${linkedImage(params.image, 300)}</td>`;
  const heading = params.heading
    ? `<tr><td align="${align(style)}" style="padding:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:29px;font-weight:bold;color:#3E3733;">${markdownLite(params.heading)}</td></tr>`
    : "";
  const copyCell = `<td class="amie-stack-column" width="${copyWidth}%" valign="middle" style="width:${copyWidth}%;padding:0 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">${heading}<tr><td align="${align(style)}" style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#4A4A4A;">${markdownLite(params.text)}</td></tr></table></td>`;
  return table(
    `<tr><td style="padding:${pad(style, 28)}px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr>${(params.imageSide ?? "left") === "left" ? imageCell + copyCell : copyCell + imageCell}</tr></table></td></tr>`,
    style,
  );
}

export function customHtml(
  params: AmieCustomHtmlParams,
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td style="padding:${pad(style, 22)}px ${horizontalPadding(style, 24)}px 0;">${sanitizeAmieHtml(params.html)}</td></tr>`,
    style,
  );
}

export function bulletList(
  params: AmieBulletListParams,
  style?: AmieBlockStyle,
): string {
  const heading = params.heading
    ? `<tr><td colspan="2" align="${align(style)}" style="padding:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:29px;font-weight:bold;color:#3E3733;">${markdownLite(params.heading)}</td></tr>`
    : "";
  const items = params.items
    .map(
      (item) =>
        `<tr><td width="24" valign="top" style="width:24px;padding:4px 8px 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#2D7A7A;">✓</td><td align="${align(style)}" style="padding:4px 0;font-family:Helvetica,Arial,sans-serif;font-size:${fontSize(style, 16).size}px;line-height:25px;color:#4A4A4A;">${markdownLite(item)}</td></tr>`,
    )
    .join("");
  return table(
    `<tr><td style="padding:${pad(style, 24)}px 48px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">${heading}${items}</table></td></tr>`,
    style,
  );
}

export function statsRow(
  params: AmieStatsRowParams,
  style?: AmieBlockStyle,
): string {
  const width = Math.floor(100 / params.items.length);
  const cells = params.items
    .map(
      (item) =>
        `<td width="${width}%" align="center" valign="top" style="width:${width}%;padding:12px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr><td align="center" style="font-family:Georgia,'Times New Roman',serif;font-size:${fontSize(style, 28).size}px;line-height:34px;font-weight:bold;color:#2D7A7A;">${escapeHtml(item.value)}</td></tr><tr><td align="center" style="padding-top:5px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:19px;color:#6B635B;">${escapeHtml(item.label)}</td></tr></table></td>`,
    )
    .join("");
  return table(
    `<tr><td style="padding:${pad(style, 24)}px 40px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr>${cells}</tr></table></td></tr>`,
    style,
  );
}

export function quoteCallout(
  params: AmieQuoteCalloutParams,
  style?: AmieBlockStyle,
): string {
  const attribution = params.attribution
    ? `<tr><td align="${align(style)}" style="padding:12px 28px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;font-weight:bold;color:#8A8178;">— ${escapeHtml(params.attribution)}</td></tr>`
    : "";
  return table(
    `<tr><td style="padding:${pad(style, 28)}px 48px 0;border-left:4px solid #B76E79;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr><td align="${align(style)}" style="padding:0 28px;font-family:Georgia,'Times New Roman',serif;font-size:${fontSize(style, 24).size}px;line-height:34px;color:#3E3733;">${markdownLite(params.quote)}</td></tr>${attribution}</table></td></tr>`,
    style,
  );
}

export function spacer(
  params: AmieSpacerParams,
  style?: AmieBlockStyle,
): string {
  return table(
    `<tr><td height="${params.height}" style="height:${params.height}px;line-height:${params.height}px;font-size:1px;">&nbsp;</td></tr>`,
    style,
  );
}

export function sectionBreak(
  params: AmieSectionBreakParams,
  style?: AmieBlockStyle,
): string {
  return table(
    '<tr><td height="1" style="height:1px;line-height:1px;font-size:1px;">&nbsp;</td></tr>',
    {
      ...style,
      background: params.background,
    },
  );
}

export function rawHtml(params: AmieRawHtmlParams): string {
  return sanitizeAmieHtml(params.html);
}

export function renderBlock(block: AmieBlockSpec): string {
  switch (block.type) {
    case "header":
      return header(block.params, block.style);
    case "heroHeading":
      return heroHeading(block.params, block.style);
    case "paragraph":
      return paragraph(block.params, block.style);
    case "ctaButton":
      return ctaButton(block.params, block.style);
    case "productCard":
      return productCard(block.params, block.style);
    case "image":
      return image(block.params, block.style);
    case "bigImage":
      return bigImage(block.params, block.style);
    case "heroImage":
      return heroImage(block.params, block.style);
    case "testimonial":
      return testimonial(block.params, block.style);
    case "divider":
      return divider(block.params, block.style);
    case "footer":
      return footer(block.params, block.style);
    case "twoColumn":
      return twoColumn(block.params, block.style);
    case "bulletList":
      return bulletList(block.params, block.style);
    case "statsRow":
      return statsRow(block.params, block.style);
    case "quoteCallout":
      return quoteCallout(block.params, block.style);
    case "spacer":
      return spacer(block.params, block.style);
    case "sectionBreak":
      return sectionBreak(block.params, block.style);
    case "columns":
      return columns(block.params, block.style);
    case "imageText":
      return imageText(block.params, block.style);
    case "customHtml":
      return customHtml(block.params, block.style);
    case "rawHtml":
      return rawHtml(block.params);
    default:
      return assertUnreachable(block);
  }
}

export function assembleEmail(
  blocks: AmieBlockSpec[],
  previewText = "A thoughtful update from Amie.",
): string {
  const mailingAddress =
    process.env.AMIE_MAILING_ADDRESS ?? DEFAULT_AMIE_MAILING_ADDRESS;
  let sectionBackground: AmieBrandBackground = "white";
  const rows = blocks
    .map((block, index) => {
      if (block.type === "sectionBreak")
        sectionBackground = block.params.background;
      const renderedBlock: AmieBlockSpec =
        block.type === "footer"
          ? {
              ...block,
              params: { ...block.params, addressLine: mailingAddress },
            }
          : block;
      let rowBackground = AMIE_BACKGROUND_COLORS[sectionBackground];
      if (block.style?.background === "custom")
        rowBackground = block.style.backgroundHex ?? rowBackground;
      else if (block.style?.background)
        rowBackground = AMIE_BACKGROUND_COLORS[block.style.background];
      return `<tr><td data-amie-block="${block.id ?? index}" bgcolor="${rowBackground}" style="padding:0;background-color:${rowBackground};">${renderBlock(renderedBlock)}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no"><title>Amie</title><style>@media screen and (max-width:600px){.amie-stack-column{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;padding-top:12px!important;padding-bottom:12px!important;}}</style><!--[if mso]><xml><o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office"><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]--></head>
  <body style="width:100%;margin:0;padding:0;background-color:#F1EBE3;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}background-color:#F1EBE3;"><tr><td align="center" style="padding:32px 16px;"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;${TABLE_RESET}"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;${TABLE_RESET}background-color:#FFFFFF;"><tr><td style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(previewText)}</td></tr>${rows}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table>
  </body>
</html>`;
}
