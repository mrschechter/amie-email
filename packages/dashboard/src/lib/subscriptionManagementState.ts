import { UserSubscriptionResource } from "isomorphic-lib/src/types";

// Segment assignments behind getUserSubscriptions are computed asynchronously,
// so right after the page applies an unsubscribe/subscribe link the lookup can
// still report the old state. Overlay the change we just wrote so the page
// renders what the user asked for.
export function applySubscriptionChanges(
  subscriptions: UserSubscriptionResource[],
  changes: Record<string, boolean> | undefined,
): UserSubscriptionResource[] {
  if (!changes) {
    return subscriptions;
  }
  return subscriptions.map((subscription) => {
    const change = changes[subscription.id];
    return change === undefined
      ? subscription
      : { ...subscription, isSubscribed: change };
  });
}

// Only submit groups the user actually toggled, so saving the form never
// re-asserts untouched groups.
export function changedSubscriptions(
  initial: Record<string, boolean>,
  current: Record<string, boolean>,
): Record<string, boolean> {
  const changes: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(current)) {
    if (initial[id] !== value) {
      changes[id] = value;
    }
  }
  return changes;
}
