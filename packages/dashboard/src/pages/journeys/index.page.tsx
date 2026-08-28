import { Stack } from "@mui/material";
import { GetServerSideProps } from "next";

import DashboardContent from "../../components/dashboardContent";
import JourneysTableV2 from "../../components/journeys/v2/journeysTable";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (_ctx, dfContext) => {
    const props = addInitialStateToProps({
      dfContext,
      props: {},
    });
    return {
      props,
    };
  });

function Journeys() {
  return (
    <DashboardContent>
      <Stack
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
        <JourneysTableV2 />
      </Stack>
    </DashboardContent>
  );
}
export default Journeys;
