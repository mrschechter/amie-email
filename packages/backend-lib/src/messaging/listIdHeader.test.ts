import { constructUnsubscribeHeaders } from "./email";

describe("constructUnsubscribeHeaders List-ID", () => {
  const base = {
    to: "patient@example.com",
    userId: "user-1",
    identifierKey: "email",
    subscriptionGroupSecret: "secret",
    subscriptionGroupName: "Amie - Email",
    workspaceId: "ea0a0a53-47d0-4af2-8906-8034e56c8578",
    subscriptionGroupId: "ab55b44a-c7f6-5487-be11-33242f799219",
  };

  it("uses the bare domain when from has a display name", () => {
    const result = constructUnsubscribeHeaders({
      ...base,
      from: "Jodi at Amie <jodi@send.tryamie.com>",
    });
    if (result.isErr()) throw new Error("expected ok");
    expect(result.value["List-ID"]).toBe(
      "Amie - Email <ab55b44a-c7f6-5487-be11-33242f799219.send.tryamie.com>",
    );
  });

  it("still works for a bare from address", () => {
    const result = constructUnsubscribeHeaders({
      ...base,
      from: "jodi@send.tryamie.com",
    });
    if (result.isErr()) throw new Error("expected ok");
    expect(result.value["List-ID"]).toBe(
      "Amie - Email <ab55b44a-c7f6-5487-be11-33242f799219.send.tryamie.com>",
    );
  });

  it("rejects a from address without a domain", () => {
    expect(
      constructUnsubscribeHeaders({ ...base, from: "not-an-address" }).isErr(),
    ).toBe(true);
  });
});
