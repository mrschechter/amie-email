import { db } from "backend-lib/src/db";
import { getRequestContext } from "backend-lib/src/requestContext";
import { verifyTemplatePreviewToken } from "backend-lib/src/templatePreviewToken";
import { RequestContextErrorType } from "backend-lib/src/types";
import Fastify from "fastify";
import { TYPE_REFS } from "isomorphic-lib/src/typeRefs";
import { ChannelType } from "isomorphic-lib/src/types";
import { err, ok } from "neverthrow";

import requestContext from "../buildApp/requestContext";
import contentController from "./contentController";

jest.mock("backend-lib/src/db", () => ({ db: jest.fn() }));
jest.mock("backend-lib/src/requestContext", () => ({
  getRequestContext: jest.fn(),
}));
jest.mock("backend-lib/src/config", () => ({
  __esModule: true,
  default: () => ({ authMode: "multi-tenant" }),
}));
jest.mock("backend-lib/src/logger", () => ({
  __esModule: true,
  default: () => ({ error: jest.fn(), debug: jest.fn() }),
}));
jest.mock("backend-lib/src/journeys", () => ({
  deleteMessageTemplate: jest.fn(),
}));
jest.mock("backend-lib/src/liquid", () => ({ renderLiquid: jest.fn() }));
jest.mock("backend-lib/src/messaging", () => ({}));

const ids = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  templateId: "22222222-2222-4222-8222-222222222222",
};
const secret = "test-only-subscription-secret";
const findTemplate = jest.fn();
const findSecret = jest.fn();
const definition = {
  type: ChannelType.Email,
  from: "Preview",
  subject: "Subject",
  body: "Body",
};

beforeEach(() => {
  findSecret.mockResolvedValue({ value: secret });
  findTemplate.mockResolvedValue({ definition });
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  jest.mocked(db).mockReturnValue({
    query: {
      secret: { findFirst: findSecret },
      messageTemplate: { findFirst: findTemplate },
    },
  } as unknown as ReturnType<typeof db>);
});

async function getLink(withAuth = false) {
  const app = Fastify();
  for (const schema of TYPE_REFS) app.addSchema(schema);
  if (withAuth) await app.register(requestContext);
  await app.register(contentController);
  try {
    return await app.inject({
      method: "GET",
      url: `/templates/preview-link?${new URLSearchParams(ids).toString()}`,
    });
  } finally {
    await app.close();
  }
}

it("issues a scoped signed path using the existing subscription key", async () => {
  const response = await getLink();
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  const { path } = response.json<{ path: string }>();
  expect(path).toMatch(/^\/public\/template-preview\//);
  expect(
    verifyTemplatePreviewToken(
      path.slice("/public/template-preview/".length),
      secret,
    ),
  ).toEqual({ ...ids, v: 1 });
});

it.each([undefined, { definition: { type: ChannelType.Sms, body: "SMS" } }])(
  "rejects deleted and non-email templates",
  async (template) => {
    findTemplate.mockResolvedValue(template);
    expect((await getLink()).statusCode).toBe(404);
    expect(findSecret).not.toHaveBeenCalled();
  },
);

it("does not create a new signing key when one is missing", async () => {
  findSecret.mockResolvedValue(undefined);
  expect((await getLink()).statusCode).toBe(503);
});

it("supports a saved draft before the first publication", async () => {
  findTemplate.mockResolvedValue({ definition: null, draft: definition });
  expect((await getLink()).statusCode).toBe(200);
});

it("requires authentication before issuing links", async () => {
  jest
    .mocked(getRequestContext)
    .mockResolvedValue(err({ type: RequestContextErrorType.NotAuthenticated }));
  expect((await getLink(true)).statusCode).toBe(401);
  expect(db).not.toHaveBeenCalled();
});

it("rejects a different authenticated workspace before issuing links", async () => {
  jest.mocked(getRequestContext).mockResolvedValue(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    ok({ workspace: { id: ids.templateId } }) as Awaited<
      ReturnType<typeof getRequestContext>
    >,
  );
  expect((await getLink(true)).statusCode).toBe(403);
  expect(db).not.toHaveBeenCalled();
});
