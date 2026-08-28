// ==============================|| DEFAULT THEME - TYPOGRAPHY  ||============================== //

import tokens from "./tokens";

const Typography = () => ({
  htmlFontSize: 16,
  fontFamily: tokens.typography.bodyFontFamily,
  displayFontFamily: tokens.typography.displayFontFamily,
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 600,
  h1: {
    fontFamily: tokens.typography.bodyFontFamily,
    fontWeight: 500,
    fontSize: "1.875rem",
    lineHeight: "36px",
    color: tokens.colors.heading,
  },
  h2: {
    fontFamily: tokens.typography.bodyFontFamily,
    fontWeight: 500,
    fontSize: "1.375rem",
    lineHeight: "28px",
    color: tokens.colors.heading,
  },
  h3: {
    fontFamily: tokens.typography.bodyFontFamily,
    fontWeight: 500,
    fontSize: "1rem",
    lineHeight: "22px",
    color: tokens.colors.heading,
  },
  h4: {
    fontFamily: tokens.typography.displayFontFamily,
    fontWeight: 600,
    fontSize: "30px",
    lineHeight: "36px",
    color: tokens.colors.heading,
  },
  h5: {
    fontFamily: tokens.typography.displayFontFamily,
    fontWeight: 600,
    fontSize: "22px",
    lineHeight: "28px",
    color: tokens.colors.heading,
  },
  h6: {
    fontFamily: tokens.typography.bodyFontFamily,
    fontWeight: 500,
    fontSize: "14.5px",
    lineHeight: "20px",
    color: tokens.colors.heading,
  },
  caption: {
    fontWeight: 400,
    fontSize: "12.5px",
    lineHeight: "17px",
    color: tokens.colors.caption,
  },
  body1: {
    fontSize: "14px",
    lineHeight: "21px",
  },
  body2: {
    fontSize: "13.5px",
    lineHeight: "20px",
  },
  subtitle1: {
    fontSize: "14.5px",
    fontWeight: 500,
    lineHeight: "20px",
    color: tokens.colors.heading,
  },
  subtitle2: {
    fontSize: "12.5px",
    fontWeight: 500,
    lineHeight: "17px",
    color: tokens.colors.caption,
  },
  overline: {
    fontSize: "10.5px",
    fontWeight: 500,
    lineHeight: "16px",
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: tokens.colors.faint,
  },
  button: {
    fontSize: "13.5px",
    fontWeight: 500,
    lineHeight: "20px",
    textTransform: "none",
  },
});

export default Typography;
