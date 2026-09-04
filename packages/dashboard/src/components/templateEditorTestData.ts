import { UserPropertyAssignments } from "isomorphic-lib/src/types";

export function getTestUserProperties({
  current,
  preview: _preview,
}: {
  current: UserPropertyAssignments;
  preview: UserPropertyAssignments;
}): UserPropertyAssignments {
  return current;
}
