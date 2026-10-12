import { Stack } from "@mui/material";
import { useRouter } from "next/router";

import DashboardContent from "../../components/dashboardContent";
import { SegmentEditorV2 } from "../../components/segments/editorV2";
import getSegmentServerSideProps from "./[id]/getSegmentServerSideProps";

export const getServerSideProps = getSegmentServerSideProps;

// Long condition lists scroll in their own pane with an always-visible
// scrollbar (same treatment as the template code editor in #33); the users
// drawer stays pinned to the bottom of the page.
const SCROLL_PANE_SX = {
  height: "100%",
  overflowY: "auto",
  pr: 1,
  pb: "72px",
  scrollbarGutter: "stable",
  "@supports not selector(::-webkit-scrollbar)": {
    scrollbarWidth: "auto",
    scrollbarColor: "#8A8178 #F1EBE3",
  },
  "&::-webkit-scrollbar": { width: "10px" },
  "&::-webkit-scrollbar-track": { background: "#F1EBE3" },
  "&::-webkit-scrollbar-thumb": {
    background: "#8A8178",
    borderRadius: "8px",
    border: "2px solid #F1EBE3",
  },
  "&::-webkit-scrollbar-thumb:hover": { background: "#2D7A7A" },
} as const;

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
          pb: "16px",
          // Fill the layout so the builder scrolls inside it (Nicholate 2026-10-12).
          height: "100%",
          minHeight: 0,
        }}
      >
        <SegmentEditorV2 id={id} sx={SCROLL_PANE_SX} />
      </Stack>
    </DashboardContent>
  );
}
