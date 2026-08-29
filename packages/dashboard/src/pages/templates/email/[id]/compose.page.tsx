import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { validate } from "uuid";

import AmieComposer from "../../../../components/messages/amieComposer";
import TemplatePageContent from "../../../../components/messages/templatePageContent";
import { addInitialStateToProps } from "../../../../lib/addInitialStateToProps";
import { requestContext } from "../../../../lib/requestContext";
import { PropsWithInitialState } from "../../../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (ctx, dfContext) => {
    const templateId = ctx.params?.id;
    if (typeof templateId !== "string" || !validate(templateId)) {
      return { notFound: true };
    }
    return {
      props: addInitialStateToProps({
        dfContext,
        props: {},
      }),
    };
  });

export default function ComposeEmailTemplatePage() {
  const router = useRouter();
  const templateId =
    typeof router.query.id === "string" ? router.query.id : null;
  if (!templateId) {
    return null;
  }

  return (
    <TemplatePageContent>
      <AmieComposer
        templateId={templateId}
        templateName={
          typeof router.query.name === "string" ? router.query.name : undefined
        }
        isNew={router.query.new === "true"}
      />
    </TemplatePageContent>
  );
}
