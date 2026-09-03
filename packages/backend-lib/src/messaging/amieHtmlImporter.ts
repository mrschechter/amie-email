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
  const separator = node.tag === "br" ? "\n" : "";
  return `${separator}${node.children.map(textContent).join("")}`;
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

function inlineMarkdown(node: HtmlNode): string {
  if (node.kind === "text") return decodeEntities(node.value);
  const content = node.children.map(inlineMarkdown).join("");
  if (node.tag === "br") return "\n";
  if (node.tag === "strong" || node.tag === "b") return `**${content}**`;
  if (node.tag === "em" || node.tag === "i") return `*${content}*`;
  const { href } = node.attributes;
  if (node.tag === "a" && href && /^https?:\/\//i.test(href))
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

function safeImage(node: HtmlElement): { src: string; alt: string } | null {
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
  const evidence = [
    node.attributes.role,
    node.attributes.class,
    node.attributes.style,
    parent?.attributes.bgcolor,
    parent?.attributes.style,
  ].join(" ");
  return /role\s*=\s*button|\b(?:btn|button)\b|background(?:-color)?\s*:|padding\s*:/i.test(
    evidence,
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
  const paragraphs = descendants(cell, "p").map(cleanText).filter(Boolean);
  const fullText = cleanText(cell);
  const headingText = heading ? cleanText(heading) : "";
  const text =
    paragraphs.join("\n") || fullText.replace(headingText, "").trim();
  return {
    heading: headingText,
    text,
    ...(imageValue ? { image: imageValue } : {}),
  };
}

interface ImportState {
  blocks: AmieBlockSpec[];
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

function mapElement(
  node: HtmlElement,
  state: ImportState,
  parent?: HtmlElement,
) {
  if (
    ["html", "body", "root", "table", "tbody", "thead", "tfoot"].includes(
      node.tag,
    )
  ) {
    node.children.forEach(
      (child) => child.kind === "element" && mapElement(child, state, node),
    );
    return;
  }
  if (["head", "style", "title", "meta"].includes(node.tag)) return;

  const text = cleanText(node);
  if (
    (node.tag === "footer" || /unsubscribe|manage preferences/i.test(text)) &&
    text.length < 1600
  ) {
    state.blocks.push({
      type: "footer",
      params: {
        addressLine:
          text.replace(/unsubscribe|manage preferences/gi, "").trim() ||
          "Configured by server",
        unsubscribe: /manage preferences/i.test(text)
          ? "Manage preferences"
          : "Unsubscribe",
      },
    });
    return;
  }

  if (node.tag === "tr") {
    const cells = node.children.filter(
      (child): child is HtmlElement =>
        child.kind === "element" && (child.tag === "td" || child.tag === "th"),
    );
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
    cells.forEach((cell) => mapElement(cell, state, node));
    return;
  }

  if (
    node.tag === "td" ||
    node.tag === "th" ||
    node.tag === "div" ||
    node.tag === "section" ||
    node.tag === "main"
  ) {
    const elementChildren = node.children.filter(
      (child): child is HtmlElement => child.kind === "element",
    );
    if (elementChildren.length) {
      const directText = node.children
        .filter((child): child is HtmlText => child.kind === "text")
        .map((child) => decodeEntities(child.value).trim())
        .filter(Boolean)
        .join(" ");
      if (directText)
        state.blocks.push({ type: "paragraph", params: { text: directText } });
      elementChildren.forEach((child) => mapElement(child, state, node));
    } else if (text) {
      pushCustom(node, state);
    }
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
    const image = safeImage(node);
    if (!image) {
      pushCustom(node, state);
      return;
    }
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
    return;
  }
  if (
    node.tag === "a" &&
    isButton(node, parent) &&
    /^https?:\/\//i.test(node.attributes.href ?? "")
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
  if (node.tag === "br") return;
  pushCustom(node, state);
}

/** Deterministic, dependency-free import of common marketing-email HTML. */
export function importAmieHtml(html: string): AmieImportHtmlResponse {
  const sanitized = sanitizeAmieHtml(html);
  const root = parseHtml(sanitized);
  const state: ImportState = { blocks: [] };
  mapElement(root, state);
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
