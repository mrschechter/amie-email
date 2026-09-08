import { GetServerSideProps } from "next";

import AnalyticsPage from "../../components/analytics/analyticsPage";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        serverInitialState: {},
        props: {},
        dfContext,
      }),
    };
  });

export default function Page() {
  return <AnalyticsPage tab="revenue" />;
}
