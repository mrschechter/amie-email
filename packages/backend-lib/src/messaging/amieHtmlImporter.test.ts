import { assembleEmail } from "./amieBlocks";
import { importAmieHtml } from "./amieHtmlImporter";

describe("structured HTML importer", () => {
  it("imports a Mautic-style export into native blocks and sanitized custom HTML", () => {
    const result = importAmieHtml(`<!doctype html><html><body>
      <table role="presentation"><tbody>
        <tr><td><h1>Welcome back</h1></td></tr>
        <tr><td><p>Your routine is ready when you are.</p></td></tr>
        <tr><td bgcolor="#2D7A7A" style="padding:12px"><a href="https://example.com" class="mautic-button">Return to Amie</a></td></tr>
        <tr><td><video poster="x">Unsupported video</video></td></tr>
      </tbody></table><script>alert(1)</script>
    </body></html>`);

    expect(result.blocks.map((block) => block.type)).toEqual([
      "heroHeading",
      "paragraph",
      "ctaButton",
      "customHtml",
    ]);
    expect(result.unmapped).toBe(1);
    expect(JSON.stringify(result.blocks)).not.toContain("<script");
  });

  it("imports a Klaviyo-style table with image/copy rows and footer content", () => {
    const result = importAmieHtml(`<html><body><table><tbody>
      <tr><td width="40%"><img width="240" src="https://cdn.example.com/product.jpg" alt="Product"></td><td width="60%"><h2>A daily ritual</h2><p>Simple support for every day.</p></td></tr>
      <tr><td colspan="2"><ul><li>Easy to use</li><li>Made with care</li></ul></td></tr>
      <tr><td colspan="2"><p>123 Main Street</p><a href="https://example.com/unsubscribe">Unsubscribe</a></td></tr>
    </tbody></table></body></html>`);

    expect(result.blocks[0]).toMatchObject({
      type: "twoColumn",
      params: { imageSide: "left", ratio: "40/60", heading: "A daily ritual" },
    });
    expect(result.blocks.some((block) => block.type === "bulletList")).toBe(
      true,
    );
    expect(result.blocks.at(-1)?.type).toBe("footer");
  });

  it("imports plain marketing HTML and round-trips custom HTML through assembly", () => {
    const result =
      importAmieHtml(`<html><head><link rel="stylesheet" href="https://example.com/email.css"></head><body>
      <img width="600" src="https://cdn.example.com/hero.jpg" alt="Morning light" onload="bad()">
      <h1>A brighter morning</h1>
      <p>Hello <strong>there</strong>. <a href="https://example.com/story">Read the story</a>.</p>
      <blockquote>Small changes can feel meaningful.</blockquote>
      <custom-widget data-kind="offer"><table><tr><td>Keep this exact section</td></tr></table></custom-widget>
      <hr>
    </body></html>`);
    const html = assembleEmail(result.blocks);

    expect(result.blocks.map((block) => block.type)).toEqual([
      "heroImage",
      "heroHeading",
      "paragraph",
      "quoteCallout",
      "customHtml",
      "divider",
    ]);
    expect(html).toContain("Keep this exact section");
    expect(html).toContain("<custom-widget");
    expect(html).not.toContain("onload=");
    expect(html).not.toContain("email.css");
  });
});
