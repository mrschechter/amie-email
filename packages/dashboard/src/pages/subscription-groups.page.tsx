import { GetServerSideProps } from "next";
import React from "react";

import DashboardContent from "../components/dashboardContent";
import { SubscriptionGroupsTable } from "../components/subscriptionGroups/subscriptionGroupsTable";
import { addInitialStateToProps } from "../lib/addInitialStateToProps";
import { requestContext } from "../lib/requestContext";
import { PropsWithInitialState } from "../lib/types";

type SubscriptionGroupsProps = PropsWithInitialState;

export const getServerSideProps: GetServerSideProps<SubscriptionGroupsProps> =
  requestContext(async (_ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        props: {},
        dfContext,
      }),
    };
  });

export default function SubscriptionGroups() {
  return (
    <DashboardContent>
      <SubscriptionGroupsTable
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
