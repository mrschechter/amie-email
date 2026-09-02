export function escapePreviewText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function withPreviewText(html: string, previewText: string): string {
  const marker = 'mso-hide:all;">';
  const textStart = html.indexOf(marker);
  if (textStart === -1) {
    const preheader = `<div data-amie-preview-text style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapePreviewText(previewText)}</div>`;
    return html.includes("<body")
      ? html.replace(/(<body[^>]*>)/i, `$1${preheader}`)
      : `${preheader}${html}`;
  }
  const valueStart = textStart + marker.length;
  const valueEnd = html.indexOf("</td></tr>", valueStart);
  return valueEnd === -1
    ? html
    : `${html.slice(0, valueStart)}${escapePreviewText(previewText)}${html.slice(valueEnd)}`;
}

export function previewTextFromHtml(html: string): string {
  const marker = 'mso-hide:all;">';
  const start = html.indexOf(marker);
  if (start === -1) {
    const match = html.match(
      /<div[^>]*data-amie-preview-text[^>]*>([\s\S]*?)<\/div>/i,
    );
    return match?.[1]
      ? match[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
      : "";
  }
  const valueStart = start + marker.length;
  const end = html.indexOf("</td></tr>", valueStart);
  return end === -1
    ? ""
    : html
        .slice(valueStart, end)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
