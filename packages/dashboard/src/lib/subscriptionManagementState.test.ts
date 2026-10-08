import { UserSubscriptionResource } from "isomorphic-lib/src/types";

import {
  applySubscriptionChanges,
  changedSubscriptions,
} from "./subscriptionManagementState";

const subscriptions: UserSubscriptionResource[] = [
  { id: "email", name: "Email", channel: "Email", isSubscribed: true },
  { id: "sms", name: "SMS", channel: "Sms", isSubscribed: true },
];

describe("applySubscriptionChanges", () => {
  it("overlays a just-applied unsubscribe onto stale lookup state", () => {
    expect(applySubscriptionChanges(subscriptions, { email: false })).toEqual([
      { id: "email", name: "Email", channel: "Email", isSubscribed: false },
      { id: "sms", name: "SMS", channel: "Sms", isSubscribed: true },
    ]);
  });

  it("returns lookup state unchanged when nothing was applied", () => {
    expect(applySubscriptionChanges(subscriptions, undefined)).toBe(
      subscriptions,
    );
  });
});

describe("changedSubscriptions", () => {
  it("returns only toggled groups", () => {
    expect(
      changedSubscriptions(
        { email: false, sms: true, push: true },
        { email: false, sms: false, push: true },
      ),
    ).toEqual({ sms: false });
  });

  it("returns nothing when the form is saved untouched", () => {
    expect(
      changedSubscriptions(
        { email: false, sms: true },
        { email: false, sms: true },
      ),
    ).toEqual({});
  });
});
