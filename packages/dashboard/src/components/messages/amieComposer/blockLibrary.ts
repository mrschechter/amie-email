import { AmieBlockSpec } from "isomorphic-lib/src/amieComposer";

export type AddableBlockType = Exclude<AmieBlockSpec["type"], "rawHtml">;

export interface BlockLibraryItem {
  type: AddableBlockType;
  label: string;
  description: string;
  color: string;
  category?: "Advanced";
}

export const BLOCK_LIBRARY: BlockLibraryItem[] = [
  {
    type: "header",
    label: "Header",
    description: "Amie brand header",
    color: "#FAF8F5",
  },
  {
    type: "heroHeading",
    label: "Hero heading",
    description: "Lead headline and subhead",
    color: "#F5E6E0",
  },
  {
    type: "heroImage",
    label: "Hero image",
    description: "Full-width image with headline",
    color: "#9CAF88",
  },
  {
    type: "paragraph",
    label: "Paragraph",
    description: "Markdown-lite editorial copy",
    color: "#FFFFFF",
  },
  {
    type: "image",
    label: "Image",
    description: "Standalone brand image",
    color: "#9CAF88",
  },
  {
    type: "bigImage",
    label: "Big image",
    description: "Large flexible-width image",
    color: "#9CAF88",
  },
  {
    type: "twoColumn",
    label: "Two column",
    description: "Image beside copy and CTA",
    color: "#F5E6E0",
  },
  {
    type: "imageText",
    label: "Image + text",
    description: "Flexible image and copy split",
    color: "#F5E6E0",
  },
  {
    type: "columns",
    label: "Columns",
    description: "Two or three responsive columns",
    color: "#FAF8F5",
  },
  {
    type: "bulletList",
    label: "Bullet list",
    description: "Scannable benefit list",
    color: "#FAF8F5",
  },
  {
    type: "statsRow",
    label: "Stats row",
    description: "Two to four key metrics",
    color: "#2D7A7A",
  },
  {
    type: "productCard",
    label: "Product card",
    description: "Product, price, image, and link",
    color: "#FFFFFF",
  },
  {
    type: "ctaButton",
    label: "CTA button",
    description: "Brand-safe action button",
    color: "#2D7A7A",
  },
  {
    type: "quoteCallout",
    label: "Quote callout",
    description: "Editorial pull quote",
    color: "#F5E6E0",
  },
  {
    type: "testimonial",
    label: "Testimonial",
    description: "Customer quote and attribution",
    color: "#FAF8F5",
  },
  {
    type: "divider",
    label: "Divider",
    description: "Subtle visual separator",
    color: "#FFFFFF",
  },
  {
    type: "spacer",
    label: "Spacer",
    description: "Controlled vertical breathing room",
    color: "#FAF8F5",
  },
  {
    type: "sectionBreak",
    label: "Section break",
    description: "Start a branded background section",
    color: "#F5E6E0",
  },
  {
    type: "footer",
    label: "Footer",
    description: "Required address and unsubscribe",
    color: "#FAF8F5",
  },
  {
    type: "customHtml",
    label: "Custom HTML",
    description: "Advanced sanitized HTML section",
    color: "#FFFFFF",
    category: "Advanced",
  },
];

export function createBlock(type: AddableBlockType): AmieBlockSpec {
  switch (type) {
    case "header":
      return { type, params: {} };
    case "heroHeading":
      return {
        type,
        params: {
          title: "Your headline",
          subtitle: "Add a supporting thought.",
        },
      };
    case "paragraph":
      return { type, params: { text: "Add your copy here." } };
    case "ctaButton":
      return {
        type,
        params: { label: "Learn more", url: "https://tryamie.com" },
      };
    case "productCard":
      return {
        type,
        params: {
          title: "Featured product",
          description: "Describe why it belongs in her routine.",
          ctaLabel: "See details",
          ctaUrl: "https://tryamie.com",
        },
      };
    case "image":
      return {
        type,
        params: {
          src: "https://tryamie.com/placeholder.png",
          alt: "Choose an image",
        },
      };
    case "bigImage":
      return {
        type,
        params: {
          src: "https://tryamie.com/placeholder.png",
          alt: "Choose a large image",
        },
        style: { width: "full" },
      };
    case "heroImage":
      return {
        type,
        params: {
          src: "https://tryamie.com/placeholder.png",
          alt: "Choose a hero image",
          headline: "A more thoughtful way forward",
        },
      };
    case "testimonial":
      return {
        type,
        params: {
          quote: "Add a customer story.",
          attribution: "Customer name",
        },
      };
    case "divider":
      return { type, params: {} };
    case "footer":
      return {
        type,
        params: {
          addressLine: "Configured by server",
          unsubscribe: "Unsubscribe",
        },
      };
    case "twoColumn":
      return {
        type,
        params: {
          image: {
            src: "https://tryamie.com/placeholder.png",
            alt: "Choose an image",
          },
          imageSide: "left",
          heading: "A useful detail",
          body: "Pair a concise message with a brand image.",
          cta: { label: "Learn more", url: "https://tryamie.com" },
        },
      };
    case "imageText":
      return {
        type,
        params: {
          image: {
            src: "https://tryamie.com/placeholder.png",
            alt: "Choose an image",
          },
          imageSide: "left",
          ratio: "50/50",
          heading: "A useful detail",
          text: "Pair a concise message with a brand image.",
        },
      };
    case "columns":
      return {
        type,
        params: {
          columns: [
            { heading: "First idea", text: "Add supporting copy." },
            { heading: "Second idea", text: "Add supporting copy." },
          ],
        },
      };
    case "bulletList":
      return {
        type,
        params: {
          heading: "Why it matters",
          items: ["First benefit", "Second benefit", "Third benefit"],
        },
      };
    case "statsRow":
      return {
        type,
        params: {
          items: [
            { value: "01", label: "First proof point" },
            { value: "02", label: "Second proof point" },
          ],
        },
      };
    case "quoteCallout":
      return {
        type,
        params: {
          quote: "Add an editorial pull quote.",
          attribution: "Optional source",
        },
      };
    case "spacer":
      return { type, params: { height: 24 } };
    case "sectionBreak":
      return { type, params: { background: "ivory" } };
    case "customHtml":
      return {
        type,
        params: {
          html: "<p>Add your custom HTML here.</p>",
          label: "Custom section",
        },
        style: { width: "inset" },
      };
  }
}

export function blockSummary(block: AmieBlockSpec): string {
  switch (block.type) {
    case "heroHeading":
      return block.params.title;
    case "paragraph":
      return block.params.text;
    case "ctaButton":
      return block.params.label;
    case "productCard":
      return block.params.title;
    case "image":
      return block.params.alt;
    case "bigImage":
      return block.params.alt;
    case "heroImage":
      return block.params.headline ?? block.params.alt;
    case "testimonial":
      return block.params.quote;
    case "twoColumn":
      return block.params.heading ?? block.params.body;
    case "imageText":
      return block.params.heading ?? block.params.text;
    case "columns":
      return `${block.params.columns.length} columns`;
    case "bulletList":
      return block.params.heading ?? `${block.params.items.length} items`;
    case "statsRow":
      return block.params.items.map((item) => item.value).join(" · ");
    case "quoteCallout":
      return block.params.quote;
    case "spacer":
      return `${block.params.height}px`;
    case "sectionBreak":
      return block.params.background;
    case "footer":
      return block.params.unsubscribe;
    case "rawHtml":
      return "Imported HTML";
    case "customHtml":
      return block.params.label ?? "Custom HTML";
    case "header":
      return "Amie brand";
    case "divider":
      return "Separator";
  }
}
