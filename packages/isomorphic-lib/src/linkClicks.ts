import { Static, Type } from "@sinclair/typebox";

export const LinkKind = Type.Union([
  Type.Literal("unsubscribe"),
  Type.Literal("preferences"),
  Type.Literal("view_in_browser"),
  Type.Literal("content"),
]);
export type LinkKind = Static<typeof LinkKind>;

/** Classify only explicit URL routes/actions; never follow a tracking redirect. */
export function classifyLink(link: string): LinkKind {
  try {
    const url = new URL(link);
    const path = url.pathname.toLowerCase();
    const action = url.searchParams.get("action")?.toLowerCase();
    if (
      /(^|\/)(unsubscribe|unsub)([/._-]|$)/.test(path) ||
      action === "unsubscribe" ||
      (path === "/api/public/subscription-management/page" &&
        url.searchParams.get("sub") === "0")
    )
      return "unsubscribe";
    if (
      /(^|\/)(subscription-management|manage-subscriptions|preferences|email-preferences)(\/|$)/.test(
        path,
      )
    )
      return "preferences";
    if (
      /(^|\/)(view-in-browser|view_in_browser|viewinbrowser|web-version)([/.]|$)/.test(
        path,
      )
    )
      return "view_in_browser";
  } catch {
    // Preserve opaque or malformed provider values without guessing a target.
  }
  return "content";
}

export function clickLinkProperties(link: string | null | undefined) {
  return typeof link === "string" ? { link, linkKind: classifyLink(link) } : {};
}

/** Display only. The original provider value remains the aggregation key. */
export function displayLink(link: string): string {
  try {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) {
      if (key !== "utm_campaign" && key !== "utm_content") {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return link.split("?")[0] ?? link;
  }
}

export const LinkClickRow = Type.Object({
  link: Type.String(),
  linkKind: LinkKind,
  uniqueClickers: Type.Number(),
  totalClicks: Type.Number(),
  clickerRate: Type.Number(),
});
export type LinkClickRow = Static<typeof LinkClickRow>;
export const LinkClickGroup = Type.Object({
  broadcastId: Type.String(),
  journeyId: Type.String(),
  templateId: Type.String(),
  name: Type.String(),
  uniqueClickers: Type.Number(),
  clicksWithoutLink: Type.Number(),
  incomplete: Type.Boolean(),
  rows: Type.Array(LinkClickRow),
});
export type LinkClickGroup = Static<typeof LinkClickGroup>;
