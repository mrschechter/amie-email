import { AmieBlockSpec } from "isomorphic-lib/src/amieComposer";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";

import {
  assembleEmail,
  bulletList,
  ctaButton,
  divider,
  footer,
  header,
  heroHeading,
  heroImage,
  image,
  paragraph,
  productCard,
  quoteCallout,
  sectionBreak,
  spacer,
  statsRow,
  testimonial,
  twoColumn,
} from "./amieBlocks";

const UNSAFE_SCRIPT_URL = ["java", "script:alert(1)"].join("");

function expectEmailSafeBlock(html: string) {
  expect(html).toMatch(/^<table/);
  expect(html).not.toMatch(/<\/?div\b/i);
  expect(html).not.toMatch(/<style\b/i);
  expect(html).not.toMatch(/\sstyle\s*=\s*["'][^"']*url\s*\(/i);

  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    expect(match[1]).toMatch(/^(?:https?:\/\/|#|\{% unsubscribe_url %\})/);
  }
}

describe("Amie email blocks", () => {
  it("preserves quotes inside Liquid while escaping surrounding HTML", () => {
    const html = assembleEmail(
      [
        {
          type: "paragraph",
          params: {
            text: "Hi <friend>, {{ user.firstName | default: 'Queen' }}",
          },
        },
      ],
      `A note for {{ user.firstName | default: "Queen" }} & friends`,
    );

    expect(html).toContain(
      "Hi &lt;friend&gt;, {{ user.firstName | default: 'Queen' }}",
    );
    expect(html).toContain(
      `{{ user.firstName | default: "Queen" }} &amp; friends`,
    );
    expect(html).not.toContain("default: &#39;Queen&#39;");
    expect(html).not.toContain("default: &quot;Queen&quot;");
  });

  it("keeps a normalized Liquid user-property URL in CTA hrefs", () => {
    expect(
      ctaButton({
        label: "Finish checkout",
        url: "{{ user.checkoutUrl | default: 'https://tryamie.com' }}",
      }),
    ).toContain(
      `href="{{ user.checkoutUrl | default: 'https://tryamie.com' }}"`,
    );
  });

  const renderedBlocks: { name: string; html: string }[] = [
    { name: "header", html: header() },
    {
      name: "hero heading",
      html: heroHeading({ title: "A gentler way", subtitle: "For you" }),
    },
    { name: "paragraph", html: paragraph({ text: "Warm, specific copy." }) },
    {
      name: "CTA button",
      html: ctaButton({
        label: "Learn more",
        url: "https://example.com/path",
      }),
    },
    {
      name: "product card",
      html: productCard({
        title: "Evening formula",
        description: "Made for your routine.",
        price: "$40",
        imageUrl: "https://example.com/product.jpg",
        ctaLabel: "See details",
        ctaUrl: "https://example.com/product",
      }),
    },
    {
      name: "image",
      html: image({
        src: "https://assets.example.com/lifestyle.jpg",
        alt: "A calm morning",
      }),
    },
    {
      name: "hero image",
      html: heroImage({
        src: "https://assets.example.com/hero.jpg",
        alt: "Amie products",
        headline: "Feel like yourself again",
      }),
    },
    {
      name: "testimonial",
      html: testimonial({
        quote: "It fits my routine.",
        attribution: "Maya, 48",
      }),
    },
    { name: "divider", html: divider() },
    {
      name: "footer",
      html: footer({
        addressLine: "123 Main St",
        unsubscribe: "Unsubscribe",
      }),
    },
    {
      name: "two column",
      html: twoColumn({
        image: { src: "https://example.com/image.jpg", alt: "Routine" },
        imageSide: "left",
        heading: "A useful detail",
        body: "Paired copy",
        cta: { label: "Learn more", url: "https://example.com" },
      }),
    },
    {
      name: "bullet list",
      html: bulletList({ heading: "Benefits", items: ["One", "Two"] }),
    },
    {
      name: "stats row",
      html: statsRow({
        items: [
          { value: "2x", label: "First" },
          { value: "80%", label: "Second" },
        ],
      }),
    },
    {
      name: "quote callout",
      html: quoteCallout({
        quote: "An editorial thought",
        attribution: "Amie",
      }),
    },
    { name: "spacer", html: spacer({ height: 24 }) },
    { name: "section break", html: sectionBreak({ background: "blush" }) },
  ];

  it.each(renderedBlocks)(
    "renders the $name as table-based inline HTML",
    ({ html }) => {
      expectEmailSafeBlock(html);
    },
  );

  it("escapes model-provided text and unsafe URLs", () => {
    const html = ctaButton({
      label: '<script>alert("x")</script>',
      url: UNSAFE_SCRIPT_URL,
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain(UNSAFE_SCRIPT_URL);
    expect(html).toContain('href="#"');
  });

  it("renders Markdown-lite only after escaping XSS strings", () => {
    const html = paragraph({
      text: '**Strong** *gentle* [safe](https://example.com)\n<script src="x">bad</script> [bad](javascript:alert(1))',
    });

    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain("<em>gentle</em>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(
      "&lt;script src=&quot;x&quot;&gt;bad&lt;/script&gt;",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
  });

  it("validates a complete styled design tree and rejects non-brand tokens", () => {
    const valid: AmieBlockSpec[] = [
      { type: "sectionBreak", params: { background: "blush" } },
      {
        type: "heroHeading",
        params: { title: "**A better routine**" },
        style: {
          background: "blush",
          align: "center",
          padding: "loose",
          textSize: "l",
        },
      },
      {
        type: "statsRow",
        params: {
          items: [
            { value: "2x", label: "Benefit" },
            { value: "80%", label: "Result" },
          ],
        },
        style: { background: "ivory", textSize: "m" },
      },
      {
        type: "ctaButton",
        params: { label: "Start", url: "https://tryamie.com" },
        style: { buttonVariant: "roseGold", align: "center" },
      },
      {
        type: "footer",
        params: { addressLine: "Server", unsubscribe: "Unsubscribe" },
      },
    ];
    expect(
      valid.every((block) => schemaValidate(block, AmieBlockSpec).isOk()),
    ).toBe(true);
    expect(
      schemaValidate(
        {
          type: "paragraph",
          params: { text: "No" },
          style: { background: "purple" },
        },
        AmieBlockSpec,
      ).isErr(),
    ).toBe(true);
  });

  it("keeps a section background active until the next section break", () => {
    const html = assembleEmail([
      { type: "sectionBreak", params: { background: "blush" } },
      { type: "paragraph", params: { text: "Blush section" } },
      { type: "sectionBreak", params: { background: "sage" } },
      { type: "paragraph", params: { text: "Sage section" } },
    ]);
    expect(html).toContain('data-amie-block="1" bgcolor="#F5E6E0"');
    expect(html).toContain('data-amie-block="3" bgcolor="#9CAF88"');
  });

  it("renders image attributes with email-safe defaults", () => {
    const html = image({
      src: "https://assets.example.com/product.jpg",
      alt: 'Bottle <detail> "view"',
      href: "https://example.com/product",
    });

    expect(html).toContain('src="https://assets.example.com/product.jpg"');
    expect(html).toContain('width="600"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain('alt="Bottle &lt;detail&gt; &quot;view&quot;"');
    expect(html).toContain('href="https://example.com/product"');
  });

  it("renders a full-width hero image and optional headline", () => {
    const html = heroImage({
      src: "https://assets.example.com/hero.webp",
      alt: "Lifestyle",
      headline: "A brighter next chapter",
    });

    expect(html).toContain('src="https://assets.example.com/hero.webp"');
    expect(html).toContain('width="600"');
    expect(html).toContain("A brighter next chapter");
  });

  it("wraps blocks in the Outlook-proofed 600px shell", () => {
    const html = assembleEmail(
      [
        { type: "header", params: {} },
        { type: "paragraph", params: { text: "Hello" } },
      ],
      "A personal preview",
    );

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('width="600"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain("A personal preview");
    expect(html).toContain("Hello");
  });

  describe("footer mailing address enforcement", () => {
    const originalMailingAddress = process.env.AMIE_MAILING_ADDRESS;

    afterEach(() => {
      if (originalMailingAddress === undefined) {
        delete process.env.AMIE_MAILING_ADDRESS;
      } else {
        process.env.AMIE_MAILING_ADDRESS = originalMailingAddress;
      }
    });

    it("replaces a model-supplied address with the default when env is unset", () => {
      delete process.env.AMIE_MAILING_ADDRESS;

      const html = assembleEmail([
        {
          type: "footer",
          params: {
            addressLine: "Invented model address",
            unsubscribe: "Unsubscribe",
          },
        },
      ]);

      expect(html).toContain("Amie Health · 382 NE 191st St, Miami, FL 33179");
      expect(html).not.toContain("Invented model address");
    });

    it("uses the env address for every footer block", () => {
      process.env.AMIE_MAILING_ADDRESS =
        "Amie Health · 100 Configured Ave, Miami, FL 33101";

      const html = assembleEmail([
        {
          type: "footer",
          params: {
            addressLine: "First invented address",
            unsubscribe: "Unsubscribe",
          },
        },
        {
          type: "footer",
          params: {
            addressLine: "Second invented address",
            unsubscribe: "Manage preferences",
          },
        },
      ]);

      const configuredAddress =
        "Amie Health · 100 Configured Ave, Miami, FL 33101";
      expect(html.split(configuredAddress)).toHaveLength(3);
      expect(html).not.toContain("First invented address");
      expect(html).not.toContain("Second invented address");
    });
  });

  it.each([
    { type: "unknown", params: {} },
    { type: "paragraph", params: { text: "Hello", rawHtml: "<b>bad</b>" } },
    {
      type: "ctaButton",
      params: { label: "Click", url: UNSAFE_SCRIPT_URL },
    },
  ])("rejects invalid block schema: %j", (block) => {
    expect(schemaValidate(block, AmieBlockSpec).isErr()).toBe(true);
  });
});
