import { db } from "backend-lib/src/db";
import * as schema from "backend-lib/src/db/schema";
import { renderLiquid } from "backend-lib/src/liquid";
import {
  readTemplatePreviewToken,
  verifyTemplatePreviewToken,
} from "backend-lib/src/templatePreviewToken";
import { and, eq } from "drizzle-orm";
import { toMjml } from "emailo/src/toMjml";
import { SecretNames } from "isomorphic-lib/src/constants";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import {
  EmailContentsType,
  EmailTemplateResource,
} from "isomorphic-lib/src/types";
import { GetServerSideProps } from "next";
import Head from "next/head";

interface Props {
  subject: string;
  from: string;
  body: string;
}

// Intentionally public: the signed token is the only access credential.
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  ctx.res.setHeader("X-Robots-Tag", "noindex");
  ctx.res.setHeader("Cache-Control", "no-store");
  ctx.res.setHeader("Referrer-Policy", "no-referrer");
  const token = ctx.params?.token;
  if (typeof token !== "string") return { notFound: true };
  const ids = readTemplatePreviewToken(token);
  if (!ids) return { notFound: true };
  // The unverified workspace ID is used only to locate the existing signing key.
  const secret = await db().query.secret.findFirst({
    where: and(
      eq(schema.secret.workspaceId, ids.workspaceId),
      eq(schema.secret.name, SecretNames.Subscription),
    ),
  });
  if (!secret?.value || !verifyTemplatePreviewToken(token, secret.value)) {
    return { notFound: true };
  }
  const template = await db().query.messageTemplate.findFirst({
    where: and(
      eq(schema.messageTemplate.workspaceId, ids.workspaceId),
      eq(schema.messageTemplate.id, ids.templateId),
    ),
  });
  if (!template) return { notFound: true };
  // Published wins; saved draft is used only for a never-published template.
  const result = schemaValidate(
    template.definition ?? template.draft,
    EmailTemplateResource,
  );
  if (result.isErr()) return { notFound: true };
  const definition = result.value;
  const render = (value: string, mjml = false) =>
    renderLiquid({
      workspaceId: ids.workspaceId,
      template: value,
      mjml,
      userProperties: {},
      isPublicPreview: true,
    });
  const body =
    definition.emailContentsType === EmailContentsType.LowCode
      ? toMjml({ content: definition.body, mode: "render" })
      : definition.body;
  return {
    props: {
      subject: render(definition.subject),
      from: render(definition.from),
      body: render(body, true),
    },
  };
};

export default function TemplatePreviewPage({ subject, from, body }: Props) {
  return (
    <>
      <Head>
        <title>{subject || "Email preview"}</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <main style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
        <h1>{subject}</h1>
        {from && <p>From: {from}</p>}
        <iframe
          title="Email web preview"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={body}
          style={{
            width: "100%",
            height: "80vh",
            border: 0,
            background: "white",
          }}
        />
      </main>
    </>
  );
}
