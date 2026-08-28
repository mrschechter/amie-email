import { Box, Stack, Typography } from "@mui/material";
import { schemaValidateWithErr } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { WhiteLabelFeatureConfig } from "isomorphic-lib/src/types";
import { useMemo } from "react";

import { useAppStorePick } from "../../../../lib/appStore";
// ==============================|| DRAWER CONTENT - NAVIGATION CARD ||============================== //

function NavCard() {
  const { features } = useAppStorePick(["features"]);
  const whiteLabelConfig = useMemo(() => {
    if (!features.WhiteLabel) {
      return null;
    }
    const result = schemaValidateWithErr(
      features.WhiteLabel,
      WhiteLabelFeatureConfig,
    );
    if (result.isErr()) {
      return null;
    }
    return result.value;
  }, [features.WhiteLabel]);

  if (whiteLabelConfig && !whiteLabelConfig.navCardTitle) {
    return null;
  }
  const title = whiteLabelConfig?.navCardTitle || "Amie Send";
  const description = whiteLabelConfig
    ? whiteLabelConfig.navCardDescription ?? null
    : "Email platform";

  const icon = whiteLabelConfig?.navCardIcon ? (
    <img
      style={{
        height: 34,
        maxWidth: 34,
      }}
      src={whiteLabelConfig.navCardIcon}
      alt="Nav Card Icon"
    />
  ) : (
    <Box
      aria-hidden="true"
      sx={{
        alignItems: "center",
        bgcolor: "secondary.A200",
        borderRadius: "9px",
        color: "primary.main",
        display: "flex",
        flex: "0 0 34px",
        fontFamily: (theme) => theme.typography.displayFontFamily,
        fontSize: 19,
        fontWeight: 600,
        height: 34,
        justifyContent: "center",
        width: 34,
      }}
    >
      A
    </Box>
  );

  return (
    <Stack
      alignItems="center"
      direction="row"
      spacing="11px"
      sx={{ px: 2.5, pb: 1.5, pt: 2.25 }}
    >
      {icon}
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            color: "primary.main",
            fontFamily: (theme) => theme.typography.displayFontFamily,
            fontSize: 19,
            fontWeight: 600,
            lineHeight: 1.1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </Typography>
        {description ? (
          <Typography
            component="div"
            variant="overline"
            sx={{
              display: "block",
              fontSize: "9.5px",
              letterSpacing: ".14em",
              lineHeight: 1,
              mt: "3px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {description}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

export default NavCard;
