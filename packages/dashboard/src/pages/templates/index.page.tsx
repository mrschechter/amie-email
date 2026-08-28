import { Box } from "@mui/material";
import { GetServerSideProps } from "next";

import DashboardContent from "../../components/dashboardContent";
import TemplatesTable from "../../components/messages/templatesTable";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (_ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        dfContext,
        props: {},
      }),
    };
  });

export default function TemplateList() {
  return (
    <DashboardContent>
      <Box
        sx={{
          height: "100%",
          width: "100%",
          maxWidth: 1200,
          mx: "auto",
          px: "36px",
          pt: "26px",
          pb: "64px",
        }}
      >
        <TemplatesTable />
      </Box>
    </DashboardContent>
  );
}
