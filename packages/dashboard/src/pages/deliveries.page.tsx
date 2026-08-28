import { Box } from "@mui/material";
import { GetServerSideProps } from "next";

import DashboardContent from "../components/dashboardContent";
import {
  DEFAULT_DELIVERIES_TABLE_V2_PROPS,
  DeliveriesTableV2,
} from "../components/deliveriesTableV2";
import { addInitialStateToProps } from "../lib/addInitialStateToProps";
import { requestContext } from "../lib/requestContext";
import { PropsWithInitialState } from "../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (_ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        props: {},
        dfContext,
      }),
    };
  });

export default function DeliveriesPage() {
  return (
    <DashboardContent>
      <Box
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
        <DeliveriesTableV2 {...DEFAULT_DELIVERIES_TABLE_V2_PROPS} />
      </Box>
    </DashboardContent>
  );
}
