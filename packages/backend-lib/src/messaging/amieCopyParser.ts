import {
  AMIE_MAX_BLOCKS,
  AmieBlockSpec,
  AmieComposeRequest,
} from "isomorphic-lib/src/amieComposer";

const PLACEHOLDER_IMAGE_URL = "https://tryamie.com/placeholder.png";

type SourceImage = NonNullable<AmieComposeRequest["images"]>[number];

export function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function imageForDescription(
  description: string,
  images: readonly SourceImage[],
): SourceImage | undefined {
  const needle = normalizeForComparison(description);
  return images.find((image) =>
    [image.name, image.alt].some((candidate) => {
      if (!candidate) return false;
      const normalized = normalizeForComparison(candidate);
      return (
        normalized === needle ||
        normalized.includes(needle) ||
        needle.includes(normalized)
      );
    }),
  );
}

function styled(block: AmieBlockSpec): AmieBlockSpec {
  switch (block.type) {
    case "heroHeading":
      return { ...block, style: { align: "center", padding: "loose" } };
    case "ctaButton":
      return {
        ...block,
        style: { align: "center", padding: "normal", buttonVariant: "primary" },
      };
    case "quoteCallout":
      return { ...block, style: { background: "blush", padding: "normal" } };
    case "heroImage":
    case "bigImage":
    case "image":
      return { ...block, style: { width: "full", padding: "none" } };
    default:
      return block;
  }
}

function htmlText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function textFromBlock(block: AmieBlockSpec): string[] {
  switch (block.type) {
    case "header":
    case "divider":
    case "spacer":
    case "sectionBreak":
    case "image":
    case "bigImage":
      return [];
    case "heroHeading":
      return [block.params.title, block.params.subtitle].filter(
        (value): value is string => Boolean(value),
      );
    case "paragraph":
      return [block.params.text];
    case "ctaButton":
      return [block.params.label];
    case "productCard":
      return [
        block.params.title,
        block.params.description,
        block.params.price,
        block.params.ctaLabel,
      ].filter((value): value is string => Boolean(value));
    case "heroImage":
      return block.params.headline ? [block.params.headline] : [];
    case "testimonial":
      return [block.params.quote, block.params.attribution];
    case "footer":
      return [block.params.addressLine, block.params.unsubscribe];
    case "twoColumn":
      return [
        block.params.heading,
        block.params.body,
        block.params.cta?.label,
      ].filter((value): value is string => Boolean(value));
    case "bulletList":
      return [block.params.heading, ...block.params.items].filter(
        (value): value is string => Boolean(value),
      );
    case "statsRow":
      return block.params.items.flatMap((item) => [item.value, item.label]);
    case "quoteCallout":
      return [block.params.quote, block.params.attribution].filter(
        (value): value is string => Boolean(value),
      );
    case "columns":
      return block.params.columns.flatMap((column) => [
        column.heading,
        column.text,
      ]);
    case "imageText":
      return [block.params.heading, block.params.text].filter(
        (value): value is string => Boolean(value),
      );
    case "customHtml":
    case "rawHtml":
      return [htmlText(block.params.html)];
  }
}

function sentenceUnits(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map((unit) => unit.trim())
    .filter(Boolean);
}

export function extractBlockCopy(blocks: readonly AmieBlockSpec[]): string[] {
  return blocks.flatMap(textFromBlock).flatMap(sentenceUnits);
}

export function parseSourceCopy(
  source: string,
  images: readonly SourceImage[] = [],
): AmieBlockSpec[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AmieBlockSpec[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let quotes: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(
        styled({ type: "paragraph", params: { text: paragraph.join("\n") } }),
      );
      paragraph = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(styled({ type: "bulletList", params: { items: bullets } }));
      bullets = [];
    }
  };
  const flushQuotes = () => {
    if (quotes.length) {
      blocks.push(
        styled({ type: "quoteCallout", params: { quote: quotes.join("\n") } }),
      );
      quotes = [];
    }
  };
  const flushText = () => {
    flushParagraph();
    flushBullets();
    flushQuotes();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushText();
      continue;
    }

    const heading = /^(?:#{1,6})\s+(.+)$/.exec(line);
    const button = /^\[Button:\s*([^\]]+)]\((https?:\/\/[^\s)]+)\)$/i.exec(
      line,
    );
    const cta = /^CTA:\s*(.+?)\s*(?:—|–|-)\s*(https?:\/\/\S+)$/i.exec(line);
    const markdownImage = /^!\[([^\]]*)]\((https?:\/\/[^\s)]+)\)$/.exec(line);
    const imageMarker = /^\[Image:\s*([^\]]+)]$/i.exec(line);
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (
      heading ||
      (/[A-Za-z]/.test(line) &&
        line === line.toLocaleUpperCase() &&
        line.length <= 120)
    ) {
      flushText();
      blocks.push(
        styled({
          type: "heroHeading",
          params: { title: heading?.[1]?.trim() ?? line },
        }),
      );
    } else if (button || cta) {
      flushText();
      blocks.push(
        styled({
          type: "ctaButton",
          params: {
            label: (button?.[1] ?? cta?.[1] ?? "").trim(),
            url: button?.[2] ?? cta?.[2] ?? "https://tryamie.com",
          },
        }),
      );
    } else if (markdownImage) {
      flushText();
      blocks.push(
        styled({
          type: blocks.some((block) => block.type === "heroImage")
            ? "bigImage"
            : "heroImage",
          params: {
            src: markdownImage[2] ?? PLACEHOLDER_IMAGE_URL,
            alt: markdownImage[1]?.trim()
              ? markdownImage[1].trim()
              : "Email image",
          },
        }),
      );
    } else if (imageMarker) {
      flushText();
      const description = imageMarker[1]?.trim() ?? "Email image";
      const asset = imageForDescription(description, images);
      blocks.push(
        styled({
          type: blocks.some((block) => block.type === "heroImage")
            ? "image"
            : "heroImage",
          params: {
            src: asset?.url ?? PLACEHOLDER_IMAGE_URL,
            alt: asset?.alt?.trim() ? asset.alt : description,
            ...(!asset
              ? { placeholder: true, sourceDescription: description }
              : {}),
          },
        }),
      );
    } else if (line === "---") {
      flushText();
      blocks.push(styled({ type: "divider", params: {} }));
    } else if (bullet) {
      flushParagraph();
      flushQuotes();
      bullets.push(bullet[1]?.trim() ?? "");
    } else if (quote) {
      flushParagraph();
      flushBullets();
      quotes.push(quote[1]?.trim() ?? "");
    } else {
      flushBullets();
      flushQuotes();
      paragraph.push(line);
    }
  }
  flushText();

  if (blocks.length <= AMIE_MAX_BLOCKS) return blocks;
  const kept = blocks.slice(0, AMIE_MAX_BLOCKS - 1);
  const overflow = extractBlockCopy(blocks.slice(AMIE_MAX_BLOCKS - 1));
  return [
    ...kept,
    styled({ type: "paragraph", params: { text: overflow.join("\n") } }),
  ];
}

export function sourceCopyUnits(
  source: string,
  images: readonly SourceImage[] = [],
): string[] {
  return extractBlockCopy(parseSourceCopy(source, images));
}

export function copyFidelity(
  source: string,
  blocks: readonly AmieBlockSpec[],
  images: readonly SourceImage[] = [],
): { coverage: number; missing: string[] } {
  const sourceUnits = sourceCopyUnits(source, images);
  const output = extractBlockCopy(blocks).map(normalizeForComparison);
  const unique = [
    ...new Map(
      sourceUnits.map((unit) => [normalizeForComparison(unit), unit]),
    ).entries(),
  ];
  const missing = unique
    .filter(([unit]) => !output.some((candidate) => candidate.includes(unit)))
    .map(([, original]) => original);
  return {
    coverage:
      unique.length === 0
        ? 1
        : (unique.length - missing.length) / unique.length,
    missing,
  };
}
