import { AmieBlockSpec } from "isomorphic-lib/src/amieComposer";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";

import {
  assembleEmail,
  ctaButton,
  divider,
  footer,
  header,
  heroHeading,
  paragraph,
  productCard,
  testimonial,
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
