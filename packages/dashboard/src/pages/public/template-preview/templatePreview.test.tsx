import { db } from "backend-lib/src/db";
import { renderLiquid } from "backend-lib/src/liquid";
import { signTemplatePreviewToken } from "backend-lib/src/templatePreviewToken";
import { ChannelType, EmailContentsType } from "isomorphic-lib/src/types";
import { GetServerSidePropsContext } from "next";
import { renderToStaticMarkup } from "react-dom/server";

import TemplatePreviewPage, { getServerSideProps } from "./[token].page";

jest.mock("next/head", () => ({ __esModule: true, default: "head" }));

jest.mock("backend-lib/src/db", () => ({ db: jest.fn() }));
jest.mock("backend-lib/src/config", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("backend-lib/src/logger", () => ({
  __esModule: true,
  default: () => ({ error: jest.fn(), debug: jest.fn() }),
}));
jest.mock("backend-lib/src/subscriptionGroups", () => ({
  generateSubscriptionChangeUrl: jest.fn(() => {
    throw new Error("Must not generate recipient links");
  }),
}));
jest.mock("backend-lib/src/userProperties", () => ({
  assignmentAsString: jest.fn(() => {
    throw new Error("Must not inspect recipients");
  }),
}));
jest.mock("backend-lib/src/viewInBrowser", () => ({
  generateViewInBrowserHash: jest.fn(() => {
    throw new Error("Must not generate message links");
  }),
}));

const ids = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  templateId: "22222222-2222-4222-8222-222222222222",
};
const secret = "test-only-subscription-secret";
const findTemplate = jest.fn();
const findSecret = jest.fn();
const definition = {
  type: ChannelType.Email,
  subject: "Hello {{ user.first_name | default: 'reviewer' }}",
  from: "Amie <preview@example.com>",
  body: '<p>Hello {{ user.first_name | default: "reviewer" }}</p><a href="https://example.com">Read</a>{% unsubscribe_link Unsubscribe %}{% subscription_management_link Preferences %}<a href="{% unsubscribe_url %}">Unsubscribe URL</a><a href="{% subscription_management_url %}">Preferences URL</a><a href="{% view_in_browser_url %}">Browser</a>',
};

beforeEach(() => {
  findSecret.mockResolvedValue({ value: secret });
  findTemplate.mockResolvedValue({
    definition,
    draft: { ...definition, subject: "Draft" },
  });
  // A recipient lookup or any other query fails: these are the only allowed reads.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  jest.mocked(db).mockReturnValue({
    query: {
      secret: { findFirst: findSecret },
      messageTemplate: { findFirst: findTemplate },
    },
  } as unknown as ReturnType<typeof db>);
});

function request(token: unknown = signTemplatePreviewToken(ids, secret)) {
  const setHeader = jest.fn();
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const context = {
    params: { token },
    res: { setHeader },
  } as unknown as GetServerSidePropsContext;
  return { context, setHeader };
}

it.each(["bad", ["bad"], undefined])(
  "returns a public 404 for a malformed token",
  async (token) => {
    const { context } = request(null);
    context.params = token === undefined ? {} : { token };
    expect(await getServerSideProps(context)).toEqual({ notFound: true });
    expect(db).not.toHaveBeenCalled();
  },
);

it("rejects tampering before reading the template", async () => {
  const { context } = request(
    signTemplatePreviewToken(
      { ...ids, templateId: ids.workspaceId },
      "wrong-key",
    ),
  );
  expect(await getServerSideProps(context)).toEqual({ notFound: true });
  expect(findTemplate).not.toHaveBeenCalled();
});

it.each([
  undefined,
  { definition: { type: ChannelType.Sms, body: "SMS" } },
  { definition: null, draft: null },
])("returns 404 for missing or non-email templates", async (template) => {
  findTemplate.mockResolvedValue(template);
  expect(await getServerSideProps(request().context)).toEqual({
    notFound: true,
  });
});

it("fails closed when the workspace signing key is unavailable", async () => {
  findSecret.mockResolvedValue(undefined);
  expect(await getServerSideProps(request().context)).toEqual({
    notFound: true,
  });
  expect(findTemplate).not.toHaveBeenCalled();
});

it("renders published content live with empty defaults, inert links and no tracking", async () => {
  const { context, setHeader } = request();
  const result = await getServerSideProps(context);
  if (!("props" in result)) throw new Error("Expected preview props");
  const props = await result.props;
  expect(props.subject).toBe("Hello reviewer");
  expect(props.from).toBe(definition.from);
  expect(props.body).toContain("Hello reviewer");
  expect(props.body.match(/href="#"/g)).toHaveLength(5);
  expect(props.body).toContain('href="https://example.com"');
  expect(props.body).not.toMatch(/<img|\/api\/public|messageId|tracking_pixel/);
  expect(setHeader).toHaveBeenCalledWith("X-Robots-Tag", "noindex");
  expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  const page = renderToStaticMarkup(<TemplatePreviewPage {...props} />);
  expect(page).toContain('sandbox=""');
  expect(page).toContain('<meta name="robots" content="noindex,nofollow"');
  expect(page).toContain("srcDoc=");
  expect(page).toContain("Hello reviewer");
  findTemplate.mockResolvedValue({
    definition: { ...definition, subject: "Updated published" },
  });
  expect(await getServerSideProps(context)).toMatchObject({
    props: { subject: "Updated published" },
  });
});

it("uses the saved draft only when no published definition exists", async () => {
  findTemplate.mockResolvedValue({ definition: null, draft: definition });
  expect(await getServerSideProps(request().context)).toMatchObject({
    props: { subject: "Hello reviewer" },
  });
});

it("uses the editor's MJML renderer", async () => {
  findTemplate.mockResolvedValue({
    definition: {
      ...definition,
      body: "<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{ user.name | default: 'sample' }}</mj-text></mj-column></mj-section></mj-body></mjml>",
    },
  });
  const result = await getServerSideProps(request().context);
  if (!("props" in result)) throw new Error("Expected preview props");
  expect((await result.props).body).toContain("Hello sample");
  expect((await result.props).body).toContain("<!doctype html>");
});

it("uses the editor's Emailo conversion", async () => {
  findTemplate.mockResolvedValue({
    definition: {
      ...definition,
      emailContentsType: EmailContentsType.LowCode,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Low-code sample" }],
          },
        ],
      },
    },
  });
  const result = await getServerSideProps(request().context);
  if (!("props" in result)) throw new Error("Expected preview props");
  expect((await result.props).body).toContain("Low-code sample");
});

it("keeps normal rendering strict while public previews use empty defaults", () => {
  const options = {
    workspaceId: ids.workspaceId,
    userProperties: {},
    template: "Hello {{ user.missing }}",
  };
  expect(renderLiquid({ ...options, isPublicPreview: true })).toBe("Hello ");
  expect(() => renderLiquid(options)).toThrow();
});
