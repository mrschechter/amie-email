import { db } from "backend-lib/src/db";
import * as schema from "backend-lib/src/db/schema";
import { and, eq } from "drizzle-orm";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { validate as validateUuid } from "uuid";

import analyticsStyles from "../../components/analytics/analytics.module.css";
import PerformancePanel from "../../components/analytics/performancePanel";
import Broadcast from "../../components/broadcast";
import DashboardContent from "../../components/dashboardContent";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (ctx, dfContext) => {
    const broadcastId = ctx.query.id;
    if (typeof broadcastId !== "string") {
      return {
        notFound: true,
      };
    }
    if (!validateUuid(broadcastId)) {
      return {
        notFound: true,
      };
    }
    const broadcast = await db().query.broadcast.findFirst({
      where: and(
        eq(schema.broadcast.id, broadcastId),
        eq(schema.broadcast.workspaceId, dfContext.workspace.id),
      ),
    });
    if (!broadcast) {
      return {
        notFound: true,
      };
    }

    return {
      props: addInitialStateToProps({
        dfContext,
        props: {},
      }),
    };
  });

function BroadcastPageContent() {
  const router = useRouter();
  const queryParams = router.query;
  return (
    <Broadcast
      queryParams={queryParams}
      sx={{
        pt: 2,
        px: 1,
        pb: 1,
        width: "100%",
        height: "100%",
      }}
    />
  );
}

export default function BroadcastPage() {
  const router = useRouter();
  return (
    <DashboardContent>
      <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
        <nav
          className={`${analyticsStyles.root} ${analyticsStyles.tabs}`}
          style={{ padding: "10px 24px", margin: 0 }}
          aria-label="Broadcast tabs"
        >
          <Link
            href={{
              pathname: router.pathname,
              query: { ...router.query, tab: "content" },
            }}
            aria-current={
              router.query.tab !== "performance" ? "page" : undefined
            }
          >
            Broadcast
          </Link>
          <Link
            href={{
              pathname: router.pathname,
              query: { ...router.query, tab: "performance" },
            }}
            aria-current={
              router.query.tab === "performance" ? "page" : undefined
            }
          >
            Performance
          </Link>
        </nav>
        {router.isReady &&
          (router.query.tab === "performance" &&
          typeof router.query.id === "string" ? (
            <PerformancePanel kind="broadcasts" id={router.query.id} />
          ) : (
            <BroadcastPageContent />
          ))}
      </div>
    </DashboardContent>
  );
}
