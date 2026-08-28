import { Typography } from "@mui/material";
import Stack from "@mui/material/Stack";
import { Type } from "@sinclair/typebox";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { GetUsersRequest } from "isomorphic-lib/src/types";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import React, { useMemo } from "react";

import DashboardContent from "../components/dashboardContent";
import UsersTableV2, {
  usersTablePaginationHandler,
} from "../components/usersTableV2";
import { addInitialStateToProps } from "../lib/addInitialStateToProps";
import { requestContext } from "../lib/requestContext";
import { PropsWithInitialState } from "../lib/types";

const QueryParams = Type.Pick(GetUsersRequest, ["cursor", "direction"]);

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (_ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        dfContext,
        props: {},
      }),
    };
  });

export default function SegmentUsers() {
  const router = useRouter();
  const queryParams = useMemo(
    () => schemaValidate(router.query, QueryParams).unwrapOr({}),
    [router.query],
  );

  const onUsersTablePaginate = usersTablePaginationHandler(router);

  return (
    <DashboardContent>
      <Stack
        spacing={1}
        sx={{
          width: "100%",
          height: "100%",
          maxWidth: 1200,
          mx: "auto",
          px: "36px",
          pt: "26px",
          pb: "64px",
        }}
      >
        <Stack direction="row">
          <Typography variant="h4">Users</Typography>
        </Stack>
        <UsersTableV2
          {...queryParams}
          onPaginationChange={onUsersTablePaginate}
        />
      </Stack>
    </DashboardContent>
  );
}
