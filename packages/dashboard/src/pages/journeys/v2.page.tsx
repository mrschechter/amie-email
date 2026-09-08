import { Stack } from "@mui/material";
import { db } from "backend-lib/src/db";
import * as schema from "backend-lib/src/db/schema";
import { and, eq } from "drizzle-orm";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { validate } from "uuid";

import analyticsStyles from "../../components/analytics/analytics.module.css";
import PerformancePanel from "../../components/analytics/performancePanel";
import DashboardContent from "../../components/dashboardContent";
import JourneyV2 from "../../components/journeys/v2";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (ctx, dfContext) => {
    const { id } = ctx.query;

    if (typeof id !== "string" || !validate(id)) {
      return {
        notFound: true,
      };
    }

    const journey = await db().query.journey.findFirst({
      columns: {
        id: true,
      },
      where: and(
        eq(schema.journey.id, id),
        eq(schema.journey.workspaceId, dfContext.workspace.id),
      ),
    });

    if (!journey) {
      return {
        notFound: true,
      };
    }

    const props = addInitialStateToProps({
      props: {},
      dfContext,
    });

    return {
      props,
    };
  });

export default function JourneyPageV2() {
  const path = useRouter();
  const id = typeof path.query.id === "string" ? path.query.id : undefined;
  if (!id) {
    return null;
  }

  return (
    <DashboardContent>
      <Stack sx={{ height: "100%", width: "100%" }}>
        <nav
          className={`${analyticsStyles.root} ${analyticsStyles.tabs}`}
          style={{ padding: "10px 24px", margin: 0 }}
          aria-label="Journey tabs"
        >
          <Link
            href={{
              pathname: path.pathname,
              query: { ...path.query, tab: "builder" },
            }}
            aria-current={path.query.tab !== "performance" ? "page" : undefined}
          >
            Builder
          </Link>
          <Link
            href={{
              pathname: path.pathname,
              query: { ...path.query, tab: "performance" },
            }}
            aria-current={path.query.tab === "performance" ? "page" : undefined}
          >
            Performance
          </Link>
        </nav>
        {path.query.tab === "performance" ? (
          <PerformancePanel kind="flows" id={id} />
        ) : (
          <JourneyV2 id={id} />
        )}
      </Stack>
    </DashboardContent>
  );
}
