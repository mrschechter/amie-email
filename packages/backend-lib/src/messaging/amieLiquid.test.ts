import { normalizeLiquid, validateLiquid } from "./amieLiquid";

describe("normalizeLiquid", () => {
  const known = ["firstName", "checkoutUrl", "paymentUpdateUrl"];

  it("repairs entity-escaped quotes inside a default filter", () => {
    expect(
      validateLiquid(
        "Hi {{ user.firstName | default: &#39;Queen&#39; }}",
        known,
      ),
    ).toContain('unexpected character "&#39;Queen&#39;"');
    const result = normalizeLiquid(
      "Hi {{ user.firstName | default: &#39;Queen&#39; }}",
      known,
    );
    expect(result).toBe("Hi {{ user.firstName | default: 'Queen' }}");
    expect(validateLiquid(result, known)).toBeNull();
  });

  it("qualifies known bare properties and adds an empty default", () => {
    expect(validateLiquid("Hi {{ firstName }}", known)).toContain(
      "undefined variable: firstName",
    );
    const result = normalizeLiquid("Hi {{ firstName }}", known);
    expect(result).toBe("Hi {{ user.firstName | default: '' }}");
    expect(validateLiquid(result, known)).toBeNull();
  });

  it("adds defaults to user properties while preserving supplied defaults", () => {
    expect(normalizeLiquid("{{ user.checkoutUrl }}", known)).toBe(
      "{{ user.checkoutUrl | default: '' }}",
    );
    expect(
      normalizeLiquid(
        "{{ user.paymentUpdateUrl | default: &quot;https://tryamie.com&quot; }}",
        known,
      ),
    ).toBe('{{ user.paymentUpdateUrl | default: "https://tryamie.com" }}');
  });

  it("reports unresolved bare variables under strict rendering", () => {
    expect(validateLiquid("{{ notInTheCatalog }}", known)).toContain(
      "undefined variable",
    );
  });
});
