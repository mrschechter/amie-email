import { isValidLinkUrl } from "./linkEditorPanel";

describe("isValidLinkUrl", () => {
  it("accepts a conditional Liquid checkout URL with query parameters", () => {
    expect(
      isValidLinkUrl(
        "{% if user.checkoutUrl %}{{ user.checkoutUrl }}?promo=QUIZ10&utm_source=amie_send{% endif %}",
      ),
    ).toBe(true);
  });
});
