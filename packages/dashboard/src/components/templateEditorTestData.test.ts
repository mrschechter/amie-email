import { getTestUserProperties } from "./templateEditorTestData";

describe("getTestUserProperties", () => {
  it("uses the current editor values instead of debounced preview values", () => {
    const current = {
      checkoutUrl: "https://checkout.example.test/current",
      email: "tester@example.test",
    };
    const debounced = {
      checkoutUrl: "https://checkout.example.test/stale",
      email: "tester@example.test",
    };

    expect(getTestUserProperties({ current, preview: debounced })).toEqual(
      current,
    );
  });
});
