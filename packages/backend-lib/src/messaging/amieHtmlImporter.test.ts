import { assembleEmail } from "./amieBlocks";
import { importAmieHtml } from "./amieHtmlImporter";

function visibleTextFragments(html: string): string[] {
  return (
    html
      .replace(/<head\b[\s\S]*?<\/head>/gi, "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .match(/>([^<]+)(?=<)/g)
      ?.map((value) =>
        value
          .slice(1)
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#(?:39|x27);|&apos;/gi, "'")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((value) => value && /[A-Za-z0-9]/.test(value)) ?? []
  );
}

function expectAllSourceTextMapped(
  html: string,
  blocks: ReturnType<typeof importAmieHtml>["blocks"],
) {
  const serializedBlocks = JSON.stringify(blocks);
  visibleTextFragments(html).forEach((fragment) =>
    expect(serializedBlocks).toContain(fragment),
  );
}

function expectUnmappedToCountCustomHtml(
  result: ReturnType<typeof importAmieHtml>,
) {
  expect(result.unmapped).toBe(
    result.blocks.filter((block) => block.type === "customHtml").length,
  );
}

describe("structured HTML importer", () => {
  it("walks a single-cell email at its innermost content container", () => {
    const html = `<table width=600><tr><td><h1>Your plan is waiting</h1><p>You already did the hard part.</p><ul><li>Fast shipping</li><li>Free support</li></ul><a href="https://www.tryamie.com/complete-order" style="background:#B76E79;padding:12px 24px;color:#fff">Complete my order</a><hr><div class="weird"><marquee>legacy</marquee></div><p style="font-size:11px">Amie LLC · <a href="{{unsubscribe}}">Unsubscribe</a></p></td></tr></table>`;
    const result = importAmieHtml(html);

    expect(result.blocks.map((block) => block.type)).toEqual([
      "heroHeading",
      "paragraph",
      "bulletList",
      "ctaButton",
      "divider",
      "customHtml",
      "footer",
    ]);
    expectUnmappedToCountCustomHtml(result);
    expect(result.unmapped).toBe(1);
    expectAllSourceTextMapped(html, result.blocks);
  });

  it("imports each cell segment from a three-row table in order", () => {
    const html = `<table role="presentation">
      <tr><td><h2>Three simple steps</h2></td></tr>
      <tr><td><p>Choose the plan that fits your routine.</p></td></tr>
      <tr><td><a role="button" href="{{ checkout_url }}">Build my plan</a></td></tr>
    </table>`;
    const result = importAmieHtml(html);

    expect(result.blocks.map((block) => block.type)).toEqual([
      "heroHeading",
      "paragraph",
      "ctaButton",
    ]);
    expect(result.blocks[2]).toMatchObject({
      params: { label: "Build my plan", url: "{{ checkout_url }}" },
    });
    expectUnmappedToCountCustomHtml(result);
    expectAllSourceTextMapped(html, result.blocks);
  });

  it("imports a realistic nested Mautic export without dropping content", () => {
    const html = `<!doctype html>
<html>
  <head>
    <title>September ritual</title>
    <style>.mobile-hide { display: block; }</style>
  </head>
  <body style="margin:0">
    <center>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tbody>
          <tr>
            <td align="center">
              <table role="presentation" width="600">
                <tbody>
                  <tr>
                    <td>
                      <a href="https://www.tryamie.com"><img width="600" src="https://cdn.example.com/hero.jpg" alt="Amie daily plan"></a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <div class="mautic-editable">
                        <h1>Your next chapter starts here</h1>
                        <p>Steady support, made for real life.</p>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table role="presentation">
                        <tbody>
                          <tr>
                            <td bgcolor="#B76E79" style="padding: 14px 26px">
                              <a class="mautic-button" href="{{ checkout_url }}">Continue my routine</a>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td width="40%"><img width="220" src="https://cdn.example.com/bottle.jpg" alt="Daily capsules"></td>
                    <td width="60%"><h2>Built around you</h2><p>Simple guidance and thoughtful care.</p></td>
                  </tr>
                  <tr>
                    <td>
                      <custom-widget data-offer="legacy" onclick="track()">
                        <table role="presentation"><tr><td>Legacy offer details</td></tr></table>
                      </custom-widget>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <p style="font-size:12px">Amie LLC · 123 Main Street</p>
                      <a href="{{ unsubscribe }}">Unsubscribe</a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </center>
    <script>alert('not imported')</script>
  </body>
</html>`;
    const result = importAmieHtml(html);

    expect(result.blocks.map((block) => block.type)).toEqual([
      "heroImage",
      "heroHeading",
      "paragraph",
      "ctaButton",
      "twoColumn",
      "customHtml",
      "footer",
    ]);
    expect(result.blocks[3]).toMatchObject({
      params: { url: "{{ checkout_url }}" },
    });
    expectUnmappedToCountCustomHtml(result);
    expect(result.unmapped).toBe(1);
    expect(JSON.stringify(result.blocks)).not.toContain("onclick=");
    expect(JSON.stringify(result.blocks)).not.toContain("<script");
    expectAllSourceTextMapped(html, result.blocks);
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
    expectUnmappedToCountCustomHtml(result);
    expectAllSourceTextMapped(
      `<html><body><table><tbody>
      <tr><td width="40%"><img width="240" src="https://cdn.example.com/product.jpg" alt="Product"></td><td width="60%"><h2>A daily ritual</h2><p>Simple support for every day.</p></td></tr>
      <tr><td colspan="2"><ul><li>Easy to use</li><li>Made with care</li></ul></td></tr>
      <tr><td colspan="2"><p>123 Main Street</p><a href="https://example.com/unsubscribe">Unsubscribe</a></td></tr>
    </tbody></table></body></html>`,
      result.blocks,
    );
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
