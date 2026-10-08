// Fixed domains and anchored suffix patterns only; no caller SQL is interpolated.
export const PROVIDER_DOMAINS = {
  Google: ["gmail.com", "googlemail.com"],
  Microsoft: [
    "hotmail.*",
    "outlook.*",
    "live.*",
    "msn.com",
    "windowslive.com",
    "passport.com",
  ],
  Yahoo: ["yahoo.*", "ymail.com", "rocketmail.com"],
  AOL: ["aol.com", "aim.com", "love.com", "verizon.net"],
  Apple: ["icloud.com", "me.com", "mac.com"],
  "AT&T": [
    "att.net",
    "sbcglobal.net",
    "bellsouth.net",
    "pacbell.net",
    "swbell.net",
    "flash.net",
    "prodigy.net",
    "ameritech.net",
    "nvbell.net",
    "wans.net",
    "snet.net",
  ],
  Comcast: ["comcast.net"],
};
export const PROVIDER_NAMES = [...Object.keys(PROVIDER_DOMAINS), "Other"];
export function buildProviderExpression(): string {
  const branches = Object.entries(PROVIDER_DOMAINS).map(
    ([provider, domains]) => {
      const conditions = domains.map((domain) =>
        domain.endsWith(".*")
          ? `match(domain, '^${domain.slice(0, -2)}[.][a-z]+([.][a-z]+)*$')`
          : `domain = '${domain}'`,
      );
      return `(${conditions.join(" OR ")}), '${provider}'`;
    },
  );
  return `multiIf(${branches.join(", ")}, 'Other')`;
}
