import {
  AmieBlockSpec,
  AmieCtaButtonParams,
  AmieDividerParams,
  AmieFooterParams,
  AmieHeaderParams,
  AmieHeroHeadingParams,
  AmieHeroImageParams,
  AmieImageParams,
  AmieParagraphParams,
  AmieProductCardParams,
  AmieTestimonialParams,
} from "isomorphic-lib/src/amieComposer";
import { assertUnreachable } from "isomorphic-lib/src/typeAssertions";

const TABLE_RESET =
  "border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;";
const DEFAULT_AMIE_MAILING_ADDRESS =
  "Amie Health · 382 NE 191st St, Miami, FL 33179";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textWithLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function httpUrl(value: string): string | null {
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

export function header(_params: AmieHeaderParams = {}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td align="center" style="padding:23px 24px 19px;border-bottom:1px solid #F2EBE2;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:28px;font-weight:bold;color:#3E3733;">Amie<span style="color:#B76E79;">.</span></td>
  </tr>
</table>`;
}

export function heroHeading(params: AmieHeroHeadingParams): string {
  const subtitle = params.subtitle
    ? `<tr>
    <td style="padding:14px 48px 0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;font-weight:normal;color:#6B635B;">${textWithLineBreaks(params.subtitle)}</td>
  </tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td style="padding:36px 48px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;font-weight:bold;color:#3E3733;">${textWithLineBreaks(params.title)}</td>
  </tr>
  ${subtitle}
</table>`;
}

export function paragraph(params: AmieParagraphParams): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td style="padding:22px 48px 0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;font-weight:normal;color:#4A4A4A;">${textWithLineBreaks(params.text)}</td>
  </tr>
</table>`;
}

export function ctaButton(params: AmieCtaButtonParams): string {
  const url = httpUrl(params.url) ?? "#";
  const label = escapeHtml(params.label);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td align="left" style="padding:22px 48px 0;">
      <!--[if mso]>
      <v:roundrect href="${url}" style="height:46px;v-text-anchor:middle;width:230px;" arcsize="17%" stroke="f" fillcolor="#2D7A7A">
        <w:anchorlock/>
        <center style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt;">
        <tr>
          <td align="center" bgcolor="#2D7A7A" style="border-radius:8px;background-color:#2D7A7A;">
            <a href="${url}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">${label}</a>
          </td>
        </tr>
      </table>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

export function productCard(params: AmieProductCardParams): string {
  const imageUrl = params.imageUrl ? httpUrl(params.imageUrl) : null;
  const imageContent = imageUrl
    ? `<tr>
    <td style="padding:0 0 18px;"><img src="${imageUrl}" width="504" alt="${escapeHtml(params.title)}" style="display:block;width:100%;max-width:504px;height:auto;border:0;outline:none;text-decoration:none;"></td>
  </tr>`
    : "";
  const price = params.price
    ? `<tr>
    <td style="padding:8px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;font-weight:bold;color:#B76E79;">${escapeHtml(params.price)}</td>
  </tr>`
    : "";
  const cardCta =
    params.ctaLabel && params.ctaUrl
      ? `<tr>
    <td style="padding:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;font-weight:bold;"><a href="${httpUrl(params.ctaUrl) ?? "#"}" target="_blank" style="color:#2D7A7A;text-decoration:none;">${escapeHtml(params.ctaLabel)} →</a></td>
  </tr>`
      : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td style="padding:26px 48px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}border:1px solid #F2EBE2;">
        <tr>
          <td style="padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
              ${imageContent}
              <tr>
                <td style="padding:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:29px;font-weight:bold;color:#3E3733;">${textWithLineBreaks(params.title)}</td>
              </tr>
              <tr>
                <td style="padding:9px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#6B635B;">${textWithLineBreaks(params.description)}</td>
              </tr>
              ${price}
              ${cardCta}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function image(params: AmieImageParams): string {
  const src = httpUrl(params.src) ?? "";
  const width = params.width ?? 600;
  const imageHtml = `<img src="${src}" width="${width}" alt="${escapeHtml(params.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const content = params.href
    ? `<a href="${httpUrl(params.href) ?? "#"}" target="_blank" style="text-decoration:none;">${imageHtml}</a>`
    : imageHtml;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td align="center" style="padding:26px 0 0;">${content}</td>
  </tr>
</table>`;
}

export function heroImage(params: AmieHeroImageParams): string {
  const src = httpUrl(params.src) ?? "";
  const imageHtml = `<img src="${src}" width="600" alt="${escapeHtml(params.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const content = params.href
    ? `<a href="${httpUrl(params.href) ?? "#"}" target="_blank" style="text-decoration:none;">${imageHtml}</a>`
    : imageHtml;
  const headline = params.headline
    ? `<tr><td style="padding:28px 48px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;font-weight:bold;color:#3E3733;">${textWithLineBreaks(params.headline)}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr><td align="center" style="padding:0;">${content}</td></tr>
  ${headline}
</table>`;
}

export function testimonial(params: AmieTestimonialParams): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td style="padding:26px 48px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}background-color:#FAF8F5;">
        <tr>
          <td style="padding:24px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:30px;font-style:italic;color:#3E3733;">“${textWithLineBreaks(params.quote)}”</td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;font-weight:bold;color:#8A8178;">— ${escapeHtml(params.attribution)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function divider(_params: AmieDividerParams = {}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
  <tr>
    <td style="padding:26px 48px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;background-color:#F2EBE2;">&nbsp;</td></tr></table></td>
  </tr>
</table>`;
}

export function footer(params: AmieFooterParams): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}background-color:#FAF8F5;">
  <tr>
    <td align="center" style="padding:24px 48px 28px;border-top:1px solid #F2EBE2;font-family:Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}">
        <tr><td align="center" style="padding:0;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:22px;font-weight:bold;color:#3E3733;">Amie<span style="color:#B76E79;">.</span></td></tr>
        <tr><td align="center" style="padding:8px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#A39B93;">${textWithLineBreaks(params.addressLine)}</td></tr>
        <tr><td align="center" style="padding:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#2D7A7A;"><a href="{% unsubscribe_url %}" target="_blank" style="color:#2D7A7A;text-decoration:underline;">${escapeHtml(params.unsubscribe)}</a></td></tr>
        <tr><td align="center" style="padding:10px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:17px;color:#C2B9AE;">You&#39;re receiving this because you opted in to hear from Amie.</td></tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function renderBlock(block: AmieBlockSpec): string {
  switch (block.type) {
    case "header":
      return header(block.params);
    case "heroHeading":
      return heroHeading(block.params);
    case "paragraph":
      return paragraph(block.params);
    case "ctaButton":
      return ctaButton(block.params);
    case "productCard":
      return productCard(block.params);
    case "image":
      return image(block.params);
    case "heroImage":
      return heroImage(block.params);
    case "testimonial":
      return testimonial(block.params);
    case "divider":
      return divider(block.params);
    case "footer":
      return footer(block.params);
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
  const rows = blocks
    .map((block) => {
      const renderedBlock: AmieBlockSpec =
        block.type === "footer"
          ? {
              ...block,
              params: { ...block.params, addressLine: mailingAddress },
            }
          : block;
      return `<tr><td style="padding:0;">${renderBlock(renderedBlock)}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title>Amie</title>
    <!--[if mso]>
      <xml>
        <o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office">
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
    <![endif]-->
  </head>
  <body style="width:100%;margin:0;padding:0;background-color:#F1EBE3;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${TABLE_RESET}background-color:#F1EBE3;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <!--[if mso]>
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;${TABLE_RESET}">
            <tr><td>
          <![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;${TABLE_RESET}background-color:#FFFFFF;">
            <tr><td style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(previewText)}</td></tr>
            ${rows}
          </table>
          <!--[if mso]>
            </td></tr>
          </table>
          <![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
