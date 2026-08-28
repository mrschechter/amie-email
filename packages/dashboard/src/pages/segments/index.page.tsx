import { GetServerSideProps } from "next";
import React from "react";

import DashboardContent from "../../components/dashboardContent";
import { SegmentsTable } from "../../components/segments/segmentsTable";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

type SegmentsProps = PropsWithInitialState;

export const getServerSideProps: GetServerSideProps<SegmentsProps> =
  requestContext(async (_ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        props: {},
        dfContext,
      }),
    };
  });

export default function SegmentList() {
  return (
    <DashboardContent>
      <SegmentsTable
        sx={{
          maxWidth: 1200,
          mx: "auto",
          px: "36px",
          pt: "26px",
          pb: "64px",
        }}
      />
    </DashboardContent>
  );
}
