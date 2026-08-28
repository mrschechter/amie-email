import { Stack } from "@mui/material";
import { useRouter } from "next/router";

import DashboardContent from "../../components/dashboardContent";
import { SegmentEditorV2 } from "../../components/segments/editorV2";
import getSegmentServerSideProps from "./[id]/getSegmentServerSideProps";

export const getServerSideProps = getSegmentServerSideProps;

export default function NewSegment() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;
  if (!id) {
    return null;
  }
  return (
    <DashboardContent>
      <Stack
        sx={{
          width: "100%",
          maxWidth: 1200,
          mx: "auto",
          px: "36px",
          pt: "22px",
          pb: "64px",
        }}
      >
        <SegmentEditorV2 id={id} />
      </Stack>
    </DashboardContent>
  );
}
