import {
  AMIE_MAX_BLOCKS,
  AmieBlockSpec,
  AmieImportHtmlResponse,
  sanitizeAmieHtml,
} from "isomorphic-lib/src/amieComposer";

interface HtmlElement {
  kind: "element";
  tag: string;
  attributes: Record<string, string>;
  opening: string;
  children: HtmlNode[];
}

interface HtmlText {
  kind: "text";
  value: string;
}

type HtmlNode = HtmlElement | HtmlText;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function attributes(opening: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = opening.replace(/^<\s*[^\s/>]+/, "").replace(/\/?>\s*$/, "");
  for (const match of content.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const key = match[1]?.toLocaleLowerCase();
    if (key) result[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return result;
}

function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = {
    kind: "element",
    tag: "root",
    attributes: {},
    opening: "",
    children: [],
  };
  const stack = [root];
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || /^<![^-]/.test(token)) continue;
    const closing = /^<\s*\/\s*([\w:-]+)/.exec(token);
    if (closing) {
      const tag = closing[1]?.toLocaleLowerCase();
      const index = stack.map((item) => item.tag).lastIndexOf(tag ?? "");
      if (index > 0) stack.splice(index);
      continue;
    }
    const opening = /^<\s*([\w:-]+)/.exec(token);
    if (opening) {
      const tag = opening[1]?.toLocaleLowerCase() ?? "div";
      const element: HtmlElement = {
        kind: "element",
        tag,
        attributes: attributes(token),
        opening: token,
        children: [],
      };
      stack.at(-1)?.children.push(element);
      if (!VOID_ELEMENTS.has(tag) && !/\/\s*>$/.test(token))
        stack.push(element);
    } else if (token) {
      stack.at(-1)?.children.push({ kind: "text", value: token });
    }
  }
  return root;
}

function serialize(node: HtmlNode): string {
  if (node.kind === "text") return node.value;
  if (VOID_ELEMENTS.has(node.tag)) return node.opening;
  return `${node.opening}${node.children.map(serialize).join("")}</${node.tag}>`;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

function textContent(node: HtmlNode): string {
  if (node.kind === "text") return decodeEntities(node.value);
  if (node.tag === "br") return "\n";
  const content = node.children.map(textContent).join("");
  const blockSeparator = [
    "address",
    "blockquote",
    "div",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "p",
    "section",
    "td",
    "th",
    "tr",
  ].includes(node.tag)
    ? "\n"
    : "";
  return `${content}${blockSeparator}`;
}

function cleanText(node: HtmlNode): string {
  return textContent(node)
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function descendants(node: HtmlElement, tag: string): HtmlElement[] {
  return node.children.flatMap((child): HtmlElement[] => {
    if (child.kind === "text") return [];
    return [...(child.tag === tag ? [child] : []), ...descendants(child, tag)];
  });
}

function firstDescendant(
  node: HtmlElement,
  tag: string,
): HtmlElement | undefined {
  return descendants(node, tag)[0];
}

function isAllowedLink(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^\s*\{\{[\s\S]*\}\}\s*$/.test(value);
}

function inlineMarkdown(node: HtmlNode): string {
  if (node.kind === "text") return decodeEntities(node.value);
  const content = node.children.map(inlineMarkdown).join("");
  if (node.tag === "br") return "\n";
  if (node.tag === "strong" || node.tag === "b") return `**${content}**`;
  if (node.tag === "em" || node.tag === "i") return `*${content}*`;
  const { href } = node.attributes;
  if (node.tag === "a" && href && isAllowedLink(href))
    return `[${content}](${href})`;
  return content;
}

function imageWidth(node: HtmlElement): number {
  const direct = Number.parseInt(node.attributes.width ?? "", 10);
  if (Number.isFinite(direct)) return direct;
  const styled = /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(
    node.attributes.style ?? "",
  );
  return styled?.[1] ? Number.parseInt(styled[1], 10) : 0;
}

function safeImage(
  node: HtmlElement,
): { src: string; alt: string; href?: string } | null {
  const { src } = node.attributes;
  if (!src || !/^https?:\/\//i.test(src)) return null;
  return {
    src,
    alt: node.attributes.alt?.trim()
      ? node.attributes.alt.trim()
      : "Imported email image",
  };
}

function isButton(node: HtmlElement, parent?: HtmlElement): boolean {
  if (node.tag !== "a") return false;
  return (
    node.attributes.role?.toLocaleLowerCase() === "button" ||
    /btn|button/i.test(node.attributes.class ?? "") ||
    /(?:^|;)\s*(?:background(?:-color)?|padding)\s*:/i.test(
      node.attributes.style ?? "",
    ) ||
    Boolean(parent?.attributes.bgcolor) ||
    /(?:^|;)\s*(?:background(?:-color)?|padding)\s*:/i.test(
      parent?.attributes.style ?? "",
    )
  );
}

function ratioForCells(cells: HtmlElement[]): "50/50" | "40/60" | "60/40" {
  const first = Number.parseInt(cells[0]?.attributes.width ?? "", 10);
  if (first <= 45) return "40/60";
  if (first >= 55) return "60/40";
  return "50/50";
}

function columnContent(cell: HtmlElement) {
  const heading = ["h1", "h2", "h3", "h4", "h5", "h6"]
    .map((tag) => firstDescendant(cell, tag))
    .find(Boolean);
  const image = firstDescendant(cell, "img");
  const imageValue = image ? safeImage(image) : null;
  const fullText = cleanText(cell);
  const headingText = heading ? cleanText(heading) : "";
  const text = fullText.replace(headingText, "").trim();
  return {
    heading: headingText,
    text,
    ...(imageValue ? { image: imageValue } : {}),
  };
}

interface ImportState {
  blocks: AmieBlockSpec[];
}

interface HtmlSegment {
  node: HtmlNode;
  parent?: HtmlElement;
}

const IGNORED_ELEMENTS = new Set(["head", "style", "title", "meta", "link"]);
const STRUCTURAL_ELEMENTS = new Set([
  "body",
  "center",
  "html",
  "root",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
]);

function meaningfulChildren(node: HtmlElement): HtmlNode[] {
  return node.children.filter(
    (child) =>
      (child.kind === "text" && cleanText(child).length > 0) ||
      (child.kind === "element" && !IGNORED_ELEMENTS.has(child.tag)),
  );
}

function rowCells(node: HtmlElement): HtmlElement[] {
  return node.children.filter(
    (child): child is HtmlElement =>
      child.kind === "element" && (child.tag === "td" || child.tag === "th"),
  );
}

function collectSegments(
  node: HtmlNode,
  segments: HtmlSegment[],
  parent?: HtmlElement,
) {
  if (node.kind === "text") {
    if (cleanText(node)) segments.push({ node, parent });
    return;
  }
  if (IGNORED_ELEMENTS.has(node.tag)) return;

  if (node.tag === "tr") {
    const cells = rowCells(node);
    if (cells.length >= 2 && cells.length <= 3) {
      segments.push({ node, parent });
      return;
    }
    if (cells.length === 1) {
      const cell = cells[0];
      if (!cell) return;
      meaningfulChildren(cell).forEach((child) =>
        collectSegments(child, segments, cell),
      );
      return;
    }
  }

  if (STRUCTURAL_ELEMENTS.has(node.tag)) {
    meaningfulChildren(node).forEach((child) =>
      collectSegments(child, segments, node),
    );
    return;
  }

  if (node.tag === "div" || node.tag === "section" || node.tag === "main") {
    const children = meaningfulChildren(node);
    const onlyChild = children[0];
    if (children.length === 1 && onlyChild?.kind === "text") {
      segments.push({ node, parent });
      return;
    }
    // Retain the wrapper around a single unknown element so custom HTML keeps
    // the complete unsupported section, including classes and inline styles.
    if (
      children.length === 1 &&
      onlyChild?.kind === "element" &&
      !STRUCTURAL_ELEMENTS.has(onlyChild.tag) &&
      ![
        "a",
        "blockquote",
        "div",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "img",
        "main",
        "ol",
        "p",
        "section",
        "ul",
      ].includes(onlyChild.tag)
    ) {
      segments.push({ node });
      return;
    }
    children.forEach((child) => collectSegments(child, segments, node));
    return;
  }

  segments.push({ node, parent });
}

function hasSmallTextStyling(node: HtmlElement): boolean {
  if (node.tag === "small") return true;
  const fontSize = /(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt)/i.exec(
    node.attributes.style ?? "",
  );
  if (fontSize?.[1]) {
    const size = Number.parseFloat(fontSize[1]);
    if (fontSize[2]?.toLocaleLowerCase() === "pt" ? size <= 10 : size <= 13)
      return true;
  }
  return node.children.some(
    (child) => child.kind === "element" && hasSmallTextStyling(child),
  );
}

function hasFooterTextEvidence(node: HtmlElement): boolean {
  const text = cleanText(node);
  return (
    /unsubscribe|manage (?:email )?preferences/i.test(text) ||
    hasSmallTextStyling(node) ||
    node.tag === "address" ||
    /(?:\bP\.?O\.? Box\b|\b\d{1,6}\s+[\w.'-]+(?:\s+[\w.'-]+){0,5}\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?)\b)/i.test(
      text,
    )
  );
}

function hasFooterSignal(segment: HtmlSegment): boolean {
  if (segment.node.kind === "text") return false;
  if (segment.node.tag === "footer") return true;
  if (segment.node.tag === "tr") {
    const cells = rowCells(segment.node);
    return (
      cells.length > 0 &&
      cells.every((cell) => hasFooterTextEvidence(cell)) &&
      cells.some((cell) => hasFooterTextEvidence(cell))
    );
  }
  if (
    !["a", "address", "div", "p", "section", "small", "span"].includes(
      segment.node.tag,
    )
  )
    return false;
  return hasFooterTextEvidence(segment.node);
}

function isFooterSupport(segment: HtmlSegment): boolean {
  if (segment.node.kind === "text") return false;
  const text = cleanText(segment.node);
  return (
    hasFooterSignal(segment) ||
    (["a", "address", "br", "p", "small", "span"].includes(segment.node.tag) &&
      /^(?:©|copyright\b)|privacy policy|terms(?: of (?:use|service))?/i.test(
        text,
      ))
  );
}

function trailingFooterStart(segments: HtmlSegment[]): number {
  const finalSegment = segments.at(-1);
  if (!finalSegment || !hasFooterSignal(finalSegment)) return segments.length;
  let start = segments.length - 1;
  while (start > 0) {
    const previousSegment = segments[start - 1];
    if (!previousSegment || !isFooterSupport(previousSegment)) break;
    start -= 1;
  }
  return start;
}

function pushFooter(segments: HtmlSegment[], state: ImportState) {
  const text = segments
    .map(({ node }) => cleanText(node))
    .filter(Boolean)
    .join("\n");
  const unsubscribe = /manage (?:email )?preferences/i.test(text)
    ? "Manage preferences"
    : /unsubscribe/i.exec(text)?.[0] ?? "Unsubscribe";
  const addressLine = text
    .replace(/unsubscribe|manage (?:email )?preferences/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  state.blocks.push({
    type: "footer",
    params: {
      addressLine: addressLine || "Configured by server",
      unsubscribe,
    },
  });
}

function pushCustom(node: HtmlElement, state: ImportState) {
  const html = serialize(node).trim();
  if (!html) return;
  state.blocks.push({
    type: "customHtml",
    params: { html, label: `Imported <${node.tag}> section` },
    style: { width: "inset" },
  });
}

function pushImage(
  node: HtmlElement,
  state: ImportState,
  parent?: HtmlElement,
  href?: string,
) {
  const image = safeImage(node);
  if (!image) {
    pushCustom(node, state);
    return;
  }
  if (href && isAllowedLink(href)) image.href = href;
  const large =
    imageWidth(node) >= 200 || parent?.tag === "td" || parent?.tag === "a";
  let type: "heroImage" | "bigImage" | "image" = "image";
  if (large) {
    type = state.blocks.some((block) => block.type === "heroImage")
      ? "bigImage"
      : "heroImage";
  }
  state.blocks.push({
    type,
    params: image,
    style: { width: "full", padding: "none" },
  });
}

function mapElement(
  node: HtmlElement,
  state: ImportState,
  parent?: HtmlElement,
) {
  const text = cleanText(node);

  if (node.tag === "tr") {
    const cells = rowCells(node);
    if (cells.length >= 2 && cells.length <= 3) {
      const contents = cells.map(columnContent);
      const imageIndex = contents.findIndex((content) => content.image);
      const textIndex = contents.findIndex(
        (content, index) =>
          index !== imageIndex && (content.heading || content.text),
      );
      if (cells.length === 2 && imageIndex >= 0 && textIndex >= 0) {
        const image = contents[imageIndex]?.image;
        const copy = contents[textIndex];
        if (image && copy) {
          state.blocks.push({
            type: "twoColumn",
            params: {
              image,
              imageSide: imageIndex === 0 ? "left" : "right",
              ratio: ratioForCells(cells),
              ...(copy.heading ? { heading: copy.heading } : {}),
              body: copy.text,
            },
          });
          return;
        }
      }
      if (contents.every((content) => content.heading || content.text)) {
        state.blocks.push({ type: "columns", params: { columns: contents } });
        return;
      }
    }
    pushCustom(node, state);
    return;
  }

  if (/^h[1-6]$/.test(node.tag)) {
    state.blocks.push({ type: "heroHeading", params: { title: text } });
    return;
  }
  if (node.tag === "p") {
    const value = inlineMarkdown(node)
      .replace(/[\t ]+/g, " ")
      .trim();
    if (value)
      state.blocks.push({ type: "paragraph", params: { text: value } });
    return;
  }
  if (node.tag === "ul" || node.tag === "ol") {
    const items = descendants(node, "li").map(cleanText).filter(Boolean);
    if (items.length)
      state.blocks.push({ type: "bulletList", params: { items } });
    else pushCustom(node, state);
    return;
  }
  if (node.tag === "blockquote") {
    if (text)
      state.blocks.push({ type: "quoteCallout", params: { quote: text } });
    return;
  }
  if (node.tag === "hr") {
    state.blocks.push({ type: "divider", params: {} });
    return;
  }
  if (node.tag === "img") {
    pushImage(node, state, parent);
    return;
  }
  if (
    node.tag === "a" &&
    isButton(node, parent) &&
    isAllowedLink(node.attributes.href ?? "")
  ) {
    state.blocks.push({
      type: "ctaButton",
      params: {
        label: text || "Learn more",
        url: node.attributes.href ?? "https://tryamie.com",
      },
    });
    return;
  }
  if (node.tag === "a") {
    const image = firstDescendant(node, "img");
    if (image) {
      pushImage(image, state, node, node.attributes.href);
      return;
    }
  }
  if (node.tag === "br") return;
  pushCustom(node, state);
}

function mapSegment(segment: HtmlSegment, state: ImportState) {
  if (segment.node.kind === "text") {
    const text = cleanText(segment.node);
    if (text) state.blocks.push({ type: "paragraph", params: { text } });
    return;
  }
  mapElement(segment.node, state, segment.parent);
}

/** Deterministic, dependency-free import of common marketing-email HTML. */
export function importAmieHtml(html: string): AmieImportHtmlResponse {
  const sanitized = sanitizeAmieHtml(html);
  const root = parseHtml(sanitized);
  const state: ImportState = { blocks: [] };
  const segments: HtmlSegment[] = [];
  collectSegments(root, segments);
  const footerStart = trailingFooterStart(segments);
  segments
    .slice(0, footerStart)
    .forEach((segment) => mapSegment(segment, state));
  if (footerStart < segments.length)
    pushFooter(segments.slice(footerStart), state);
  const warnings: string[] = [];
  let { blocks } = state;
  if (blocks.length > AMIE_MAX_BLOCKS) {
    blocks = [
      {
        type: "customHtml",
        params: {
          html: sanitized,
          label: "Imported email HTML",
        },
      },
    ];
    warnings.push(
      `The import exceeded ${AMIE_MAX_BLOCKS} blocks; the complete sanitized email was kept as one custom HTML section.`,
    );
  }
  const unmapped = blocks.filter((block) => block.type === "customHtml").length;
  if (unmapped)
    warnings.push(
      `${unmapped} section${unmapped === 1 ? "" : "s"} kept as editable custom HTML.`,
    );
  if (!blocks.length) warnings.push("No visible email content was found.");
  return { blocks, unmapped, warnings };
}
