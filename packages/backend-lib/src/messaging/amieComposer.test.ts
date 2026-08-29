import { extractFirstJsonObject } from "./amieComposer";

describe("extractFirstJsonObject", () => {
  it("strips JSON code fences and extracts the first balanced object", () => {
    const modelText = [
      "Here is the email:",
      "```json",
      '{"subject":"Hello","metadata":{"note":"keep {braces} and \\"quotes\\""}}',
      "```",
      "This prose should be ignored.",
    ].join("\n");

    expect(extractFirstJsonObject(modelText)).toBe(
      '{"subject":"Hello","metadata":{"note":"keep {braces} and \\"quotes\\""}}',
    );
  });

  it("skips an unbalanced opening brace before a balanced object", () => {
    expect(
      extractFirstJsonObject('Broken { prose then {"subject":"Hello"}'),
    ).toBe('{"subject":"Hello"}');
  });

  it("returns only the first balanced top-level object", () => {
    expect(extractFirstJsonObject('prefix {"one":1} suffix {"two":2}')).toBe(
      '{"one":1}',
    );
  });

  it("returns null when no balanced object exists", () => {
    expect(
      extractFirstJsonObject('```json\n{"subject":"Hello"\n```'),
    ).toBeNull();
  });
});
