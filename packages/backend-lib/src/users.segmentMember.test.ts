import { isSegmentMember } from "./users";

describe("isSegmentMember", () => {
  it("treats ClickHouse boolean/numeric/string true as membership", () => {
    for (const v of [true, "true", 1, "1"])
      expect(isSegmentMember(v)).toBe(true);
  });
  it("treats false rows (as returned for non-matching trait segments) as non-membership", () => {
    for (const v of [false, "false", 0, "0", null, ""])
      expect(isSegmentMember(v)).toBe(false);
  });
});
