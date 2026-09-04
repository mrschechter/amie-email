import {
  getLinkEditorInputType,
  isValidLinkUrl,
} from "./linkEditorPanel";

const guardedQuiz10Url =
  "{% if user.checkoutUrl %}{{ user.checkoutUrl }}?promo=QUIZ10&utm_source=amie_send{% endif %}";

describe("LinkEditorPanel link validation", () => {
  it("accepts a conditional Liquid checkout URL with query parameters", () => {
    expect(isValidLinkUrl(guardedQuiz10Url)).toBe(true);
  });

  it("uses a text input for Liquid links so browser URL validation cannot block submission", () => {
    expect(getLinkEditorInputType(guardedQuiz10Url)).toBe("text");
  });

  it("keeps native URL input behavior for literal links", () => {
    expect(getLinkEditorInputType("https://checkout.tryamie.com/abc")).toBe(
      "url",
    );
  });
});
