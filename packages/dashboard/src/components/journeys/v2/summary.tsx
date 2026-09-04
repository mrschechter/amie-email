import { Stack } from "@mui/material";

import { useJourneyQuery } from "../../../lib/useJourneyQuery";
import {
  DEFAULT_DELIVERIES_TABLE_V2_PROPS,
  DeliveriesTableV2,
} from "../../deliveriesTableV2";
import { DEFAULT_ALLOWED_COLUMNS } from "../../deliveriesTableV2/constants";
import { SubtleHeader } from "../../headers";
import { RevenueItemSummary } from "../../revenueItemSummary";
import { useJourneyV2Context } from "./shared";

export default function JourneyV2Summary() {
  const { state } = useJourneyV2Context();
  const { data: journey } = useJourneyQuery(state.id);
  if (!journey) {
    return null;
  }
  return (
    <Stack spacing={2} sx={{ padding: 2 }}>
      <RevenueItemSummary filters={{ journeyIds: [state.id] }} />
      <SubtleHeader>Deliveries</SubtleHeader>
      <DeliveriesTableV2
        {...DEFAULT_DELIVERIES_TABLE_V2_PROPS}
        columnAllowList={DEFAULT_ALLOWED_COLUMNS.filter((c) => c !== "origin")}
        journeyId={state.id}
        autoReloadByDefault
        reloadPeriodMs={10000}
      />
    </Stack>
  );
}
