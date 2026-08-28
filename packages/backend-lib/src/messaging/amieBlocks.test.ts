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
      url: "javascript:alert(1)",
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
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

  it.each([
    { type: "unknown", params: {} },
    { type: "paragraph", params: { text: "Hello", rawHtml: "<b>bad</b>" } },
    { type: "ctaButton", params: { label: "Click", url: "javascript:alert(1)" } },
  ])("rejects invalid block schema: %j", (block) => {
    expect(schemaValidate(block, AmieBlockSpec).isErr()).toBe(true);
  });
});
