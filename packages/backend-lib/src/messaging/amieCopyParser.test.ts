import { copyFidelity, parseSourceCopy } from "./amieCopyParser";

describe("finished-copy parser", () => {
  it("deterministically maps headings, paragraphs, bullets, CTAs, images, dividers, and quotes", () => {
    const blocks = parseSourceCopy(
      `# A calmer next step

This sentence stays exactly as written.

- First benefit
• Second benefit

[Button: Complete my order](https://example.com/checkout)
[Image: evening routine]
![Product bottles](https://assets.example.com/products.jpg)
---
> I finally feel like myself again.`,
      [
        {
          url: "https://assets.example.com/evening.jpg",
          name: "Evening routine",
          alt: "Woman enjoying her evening routine",
        },
      ],
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heroHeading",
      "paragraph",
      "bulletList",
      "ctaButton",
      "heroImage",
      "bigImage",
      "divider",
      "quoteCallout",
    ]);
    expect(blocks[2]).toMatchObject({
      params: { items: ["First benefit", "Second benefit"] },
    });
    expect(blocks[3]).toMatchObject({
      params: {
        label: "Complete my order",
        url: "https://example.com/checkout",
      },
    });
    expect(blocks[4]).toMatchObject({
      params: {
        src: "https://assets.example.com/evening.jpg",
        alt: "Woman enjoying her evening routine",
      },
    });
    expect(
      copyFidelity(
        "# A calmer next step\n\nThis sentence stays exactly as written.",
        blocks,
      ),
    ).toEqual({
      coverage: 1,
      missing: [],
    });
  });

  it("flags unresolved image markers without treating marker text as body copy", () => {
    const blocks = parseSourceCopy("[Image: bedside product shot]");
    expect(blocks).toEqual([
      {
        type: "heroImage",
        params: {
          src: "https://tryamie.com/placeholder.png",
          alt: "bedside product shot",
          placeholder: true,
          sourceDescription: "bedside product shot",
        },
        style: { width: "full", padding: "none" },
      },
    ]);
    expect(copyFidelity("[Image: bedside product shot]", blocks)).toEqual({
      coverage: 1,
      missing: [],
    });
  });
});
