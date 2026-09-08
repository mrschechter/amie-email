import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { validate } from "uuid";

import PerformancePanel from "../../components/analytics/performancePanel";
import DashboardContent from "../../components/dashboardContent";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (context, dfContext) => {
    const id = context.params?.id;
    if (typeof id !== "string" || !validate(id)) return { notFound: true };
    if (context.query.tab === "performance")
      return { props: addInitialStateToProps({ props: {}, dfContext }) };
    return {
      redirect: { destination: `/broadcasts/segment/${id}`, permanent: false },
    };
  });
export default function BroadcastPage() {
  const router = useRouter();
  return (
    <DashboardContent>
      {typeof router.query.id === "string" && (
        <PerformancePanel kind="broadcasts" id={router.query.id} />
      )}
    </DashboardContent>
  );
}
