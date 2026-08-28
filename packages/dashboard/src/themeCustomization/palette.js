// material-ui
import { createTheme } from "@mui/material/styles";

// project import
import tokens from "./tokens";

// ==============================|| DEFAULT THEME - PALETTE  ||============================== //

const Palette = (mode) => {
  const { colors } = tokens;

  return createTheme({
    palette: {
      mode,
      common: {
        black: colors.heading,
        white: colors.surface,
      },
      primary: {
        50: colors.tealTint,
        lighter: colors.tealTint,
        100: colors.tealTint,
        200: colors.tealTint,
        light: colors.tealTint,
        400: colors.deepTeal,
        main: colors.deepTeal,
        dark: colors.deepTealHover,
        700: colors.deepTealHover,
        darker: colors.deepTealHover,
        900: colors.deepTealHover,
        contrastText: colors.surface,
      },
      secondary: {
        lighter: colors.ivory,
        100: colors.surfaceWarm,
        200: colors.rowDivider,
        light: colors.borderSoft,
        400: colors.borderStrong,
        main: colors.caption,
        600: colors.caption,
        dark: colors.text,
        800: colors.heading,
        darker: colors.heading,
        A100: colors.surface,
        A200: colors.blush,
        A300: colors.caption,
        contrastText: colors.surface,
      },
      error: {
        lighter: colors.roseTint,
        light: colors.roseGold,
        main: colors.roseGold,
        dark: colors.roseGoldHover,
        darker: colors.roseText,
        contrastText: colors.surface,
      },
      warning: {
        postIt: colors.blush,
        postItContrastText: colors.heading,
        lighter: colors.blush,
        light: colors.blush,
        main: colors.roseGold,
        dark: colors.roseGoldHover,
        darker: colors.roseText,
        contrastText: colors.surface,
      },
      info: {
        lighter: colors.tealTint,
        light: colors.tealTint,
        main: colors.deepTeal,
        dark: colors.deepTealHover,
        darker: colors.deepTealHover,
        contrastText: colors.surface,
      },
      success: {
        lighter: colors.sageTint,
        light: colors.sageTint,
        main: colors.sage,
        dark: colors.sageText,
        darker: colors.sageText,
        contrastText: colors.surface,
      },
      grey: {
        0: colors.surface,
        50: colors.ivory,
        100: colors.surfaceWarm,
        200: colors.rowDivider,
        300: colors.borderSoft,
        400: colors.borderStrong,
        500: colors.faint,
        600: colors.caption,
        700: colors.text,
        800: colors.heading,
        900: colors.heading,
        A50: colors.ivory,
        A100: colors.surface,
        A200: colors.blush,
        A400: colors.caption,
        A700: colors.text,
        A800: colors.borderCard,
      },
      blue: {
        default: colors.deepTeal,
        100: colors.tealTint,
        200: colors.tealTint,
        300: colors.deepTeal,
      },
      text: {
        primary: colors.text,
        secondary: colors.caption,
        disabled: colors.faint,
      },
      action: {
        active: colors.text,
        hover: colors.warmHover,
        selected: colors.tealTint,
        disabled: colors.faint,
        disabledBackground: colors.borderSoft,
        focus: colors.tealTint,
      },
      divider: colors.borderSoft,
      background: {
        paper: colors.surface,
        default: colors.ivory,
      },
    },
  });
};

export default Palette;
