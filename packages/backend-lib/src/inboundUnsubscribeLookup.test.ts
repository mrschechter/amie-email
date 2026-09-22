import { query } from "./clickhouse";
import { db } from "./db";
import { findUserIdsByUserPropertyValue } from "./userProperties";

jest.mock("./db", () => ({
  db: jest.fn(() => ({
    select: () => ({
      from: () => ({
        where: jest.fn().mockResolvedValue([{ id: "email-property" }]),
      }),
    }),
  })),
}));
jest.mock("./clickhouse", () => ({
  ...jest.requireActual<typeof import("./clickhouse")>("./clickhouse"),
  query: jest.fn().mockResolvedValue({
    json: () => Promise.resolve([{ user_id: "user-1" }]),
  }),
}));
jest.mock("./config", () => ({ assignmentSequentialConsistency: () => "0" }));
jest.mock("./openTelemetry", () => ({}));

it("matches the latest email property case-insensitively with bound query parameters", async () => {
  expect(
    await findUserIdsByUserPropertyValue({
      workspaceId: "workspace",
      userPropertyName: "email",
      value: "MixedCase@Example.com",
      caseInsensitive: true,
    }),
  ).toEqual(["user-1"]);
  expect(db).toHaveBeenCalled();
  const params = jest.mocked(query).mock.calls[0]?.[0];
  expect(params?.query).toMatch(
    /having lowerUTF8\(latest_user_property_value\) = lowerUTF8\(\{[^}]+:String\}\)/,
  );
  expect(params?.query_params).toEqual({
    v0: "workspace",
    v1: "email-property",
    v2: "MixedCase@Example.com",
  });
});

it("preserves case-sensitive matching for existing callers", async () => {
  await findUserIdsByUserPropertyValue({
    workspaceId: "workspace",
    userPropertyName: "email",
    value: "MixedCase@Example.com",
  });
  expect(jest.mocked(query).mock.calls[0]?.[0].query).not.toContain(
    "lowerUTF8",
  );
});
