import { Box } from "@mui/material";

import DashboardContent from "../dashboardContent";

export default function TemplatePageContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardContent>
      <Box
        sx={{
          width: "100%",
          height: "100%",
          maxWidth: 1280,
          mx: "auto",
          px: "36px",
          pt: "22px",
          pb: "32px",
        }}
      >
        {children}
      </Box>
    </DashboardContent>
  );
}
