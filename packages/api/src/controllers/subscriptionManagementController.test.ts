import { db } from "backend-lib/src/db";
import logger from "backend-lib/src/logger";
import {
  lookupUserForSubscriptions,
  updateUserSubscriptions,
} from "backend-lib/src/subscriptionGroups";
import fastify from "fastify";
import { err, ok } from "neverthrow";

import subscriptionManagementController from "./subscriptionManagementController";

jest.mock("backend-lib/src/db");
jest.mock("backend-lib/src/logger");
jest.mock("backend-lib/src/subscriptionGroups");

const mockedDb = jest.mocked(db);
const mockedLogger = jest.mocked(logger);
const mockedLookupUserForSubscriptions = jest.mocked(
  lookupUserForSubscriptions,
);
const mockedUpdateUserSubscriptions = jest.mocked(updateUserSubscriptions);

const subscriptionGroupFindMany = jest.fn();
const loggerInfo = jest.fn();
const loggerError = jest.fn();

const baseQuery = {
  w: "workspace-1",
  i: "person@example.com",
  ik: "email",
  h: "valid-hash",
};

function pageUrl(query: Record<string, string>): string {
  return `/page?${new URLSearchParams(query).toString()}`;
}

describe("subscriptionManagementController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The controller test only exercises POST routes and all DB calls are
    // represented by the mocked query below.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockedDb.mockReturnValue({
      query: {
        subscriptionGroup: {
          findMany: subscriptionGroupFindMany,
        },
      },
    } as unknown as ReturnType<typeof db>);
    // Only the methods exercised by this controller are needed here.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockedLogger.mockReturnValue({
      info: loggerInfo,
      error: loggerError,
    } as unknown as ReturnType<typeof logger>);
    mockedLookupUserForSubscriptions.mockResolvedValue(
      ok({ userId: "user-1" }),
    );
    mockedUpdateUserSubscriptions.mockResolvedValue(undefined);
    subscriptionGroupFindMany.mockResolvedValue([]);
  });

  it("unsubscribes the requested group and returns an empty 200 response", async () => {
    subscriptionGroupFindMany.mockResolvedValue([{ id: "group-1" }]);
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: pageUrl({ ...baseQuery, s: "group-1", sub: "0" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    expect(mockedLookupUserForSubscriptions).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      identifier: "person@example.com",
      identifierKey: "email",
      hash: "valid-hash",
    });
    expect(mockedUpdateUserSubscriptions).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userUpdates: [
        {
          userId: "user-1",
          changes: { "group-1": false },
        },
      ],
    });
    expect(loggerInfo).toHaveBeenCalledWith(
      {
        event: "one_click_unsubscribe",
        workspaceId: "workspace-1",
        subscriptionGroupId: "group-1",
        result: "unsubscribed",
      },
      "Processed one-click unsubscribe",
    );
  });

  it("unsubscribes from every email group when no group is specified", async () => {
    subscriptionGroupFindMany.mockResolvedValue([
      { id: "email-group-1" },
      { id: "email-group-2" },
    ]);
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: pageUrl(baseQuery),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });

    expect(response.statusCode).toBe(200);
    expect(mockedUpdateUserSubscriptions).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userUpdates: [
        {
          userId: "user-1",
          changes: {
            "email-group-1": false,
            "email-group-2": false,
          },
        },
      ],
    });
  });

  it("rejects an invalid hash without reading or changing subscriptions", async () => {
    mockedLookupUserForSubscriptions.mockResolvedValue(
      err(new Error("Invalid hash")),
    );
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: pageUrl({ ...baseQuery, h: "bad-hash", s: "group-1", sub: "0" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ message: "Forbidden" });
    expect(subscriptionGroupFindMany).not.toHaveBeenCalled();
    expect(mockedUpdateUserSubscriptions).not.toHaveBeenCalled();
  });

  it("keeps browser preference-form submissions on the existing redirect path", async () => {
    subscriptionGroupFindMany.mockResolvedValue([
      { id: "group-1" },
      { id: "group-2" },
    ]);
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: "/page",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        ...baseQuery,
        sub_group: "ignored",
        "sub_group-1": "true",
      }).toString(),
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "/api/public/subscription-management/page?w=workspace-1&h=valid-hash&i=person%40example.com&ik=email&success=true",
    );
    expect(mockedUpdateUserSubscriptions).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userUpdates: [
        {
          userId: "user-1",
          changes: { "group-1": true, "group-2": false },
        },
      ],
    });
  });

  it("accepts a charset content type and case-insensitive value with whitespace", async () => {
    subscriptionGroupFindMany.mockResolvedValue([{ id: "group-1" }]);
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: pageUrl({ ...baseQuery, s: "group-1", sub: "0" }),
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      payload: `List-Unsubscribe=${encodeURIComponent("  oNe-ClIcK  ")}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    expect(mockedUpdateUserSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("does not treat a body with extra fields as a one-click request", async () => {
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: pageUrl({ ...baseQuery, s: "group-1", sub: "0" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click&extra=value",
    });

    expect(response.statusCode).toBe(400);
    expect(mockedLookupUserForSubscriptions).not.toHaveBeenCalled();
    expect(mockedUpdateUserSubscriptions).not.toHaveBeenCalled();
  });

  it("acknowledges preview URLs without looking up or changing a user", async () => {
    const app = fastify();
    await app.register(subscriptionManagementController);

    const response = await app.inject({
      method: "POST",
      url: pageUrl({
        ...baseQuery,
        s: "group-1",
        sub: "0",
        isPreview: "true",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    expect(mockedLookupUserForSubscriptions).not.toHaveBeenCalled();
    expect(subscriptionGroupFindMany).not.toHaveBeenCalled();
    expect(mockedUpdateUserSubscriptions).not.toHaveBeenCalled();
    expect(loggerInfo).toHaveBeenCalledWith(
      {
        event: "one_click_unsubscribe",
        workspaceId: "workspace-1",
        subscriptionGroupId: "group-1",
        result: "preview_ignored",
      },
      "Ignored one-click unsubscribe for preview URL",
    );
  });

  it("rejects a missing hash without looking up or changing a user", async () => {
    const app = fastify();
    await app.register(subscriptionManagementController);
    const { h: _hash, ...queryWithoutHash } = baseQuery;

    const response = await app.inject({
      method: "POST",
      url: pageUrl(queryWithoutHash),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: "Invalid request" });
    expect(mockedLookupUserForSubscriptions).not.toHaveBeenCalled();
    expect(mockedUpdateUserSubscriptions).not.toHaveBeenCalled();
  });
});
