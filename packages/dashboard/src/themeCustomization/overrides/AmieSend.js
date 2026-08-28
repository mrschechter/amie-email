import tokens from "../tokens";

export default function AmieSend(theme) {
  const disabledButton = {
    "&.Mui-disabled": {
      backgroundColor: theme.palette.grey[200],
    },
  };

  return {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: tokens.radii.control,
          fontSize: "13.5px",
          fontWeight: 500,
          lineHeight: "20px",
          padding: "9px 14px",
          textTransform: "none",
        },
        contained: {
          ...disabledButton,
          padding: "10px 16px",
        },
        containedPrimary: {
          boxShadow: theme.customShadows.button,
          "&:hover": {
            backgroundColor: theme.palette.primary.dark,
            boxShadow: theme.customShadows.button,
          },
        },
        outlined: {
          ...disabledButton,
          borderColor: theme.palette.grey[400],
          "&:hover": {
            backgroundColor: theme.palette.grey[50],
            borderColor: theme.palette.grey[400],
          },
        },
        text: {
          "&:hover": {
            backgroundColor: theme.palette.primary.lighter,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          borderColor: theme.palette.grey.A800,
          borderRadius: tokens.radii.card,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radii.pill,
          fontSize: "11.5px",
          fontWeight: 500,
          "&:active": {
            boxShadow: "none",
          },
        },
        sizeLarge: {
          fontSize: "1rem",
          height: 40,
        },
        light: {
          color: theme.palette.primary.main,
          backgroundColor: theme.palette.primary.lighter,
          borderColor: theme.palette.primary.light,
          "&.MuiChip-lightError": {
            color: theme.palette.error.main,
            backgroundColor: theme.palette.error.lighter,
            borderColor: theme.palette.error.light,
          },
          "&.MuiChip-lightSuccess": {
            color: theme.palette.success.main,
            backgroundColor: theme.palette.success.lighter,
            borderColor: theme.palette.success.light,
          },
          "&.MuiChip-lightWarning": {
            color: theme.palette.warning.main,
            backgroundColor: theme.palette.warning.lighter,
            borderColor: theme.palette.warning.light,
          },
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        ":root": {
          "--amie-surface": tokens.colors.surface,
          "--amie-ivory": tokens.colors.ivory,
          "--amie-heading": tokens.colors.heading,
          "--amie-text": tokens.colors.text,
          "--amie-caption": tokens.colors.caption,
          "--amie-faint": tokens.colors.faint,
          "--amie-hint": tokens.colors.hint,
          "--amie-primary": tokens.colors.deepTeal,
          "--amie-primary-hover": tokens.colors.deepTealHover,
          "--amie-primary-tint": tokens.colors.tealTint,
          "--amie-rose": tokens.colors.roseGold,
          "--amie-rose-hover": tokens.colors.roseGoldHover,
          "--amie-rose-tint": tokens.colors.roseTint,
          "--amie-rose-text": tokens.colors.roseText,
          "--amie-border-strong": tokens.colors.borderStrong,
          "--amie-border-soft": tokens.colors.borderSoft,
          "--amie-row-divider": tokens.colors.rowDivider,
          "--amie-canvas-dot": tokens.colors.canvasDot,
          "--amie-journey-edge": tokens.colors.journeyEdge,
          "--amie-node-border": tokens.colors.journeyNodeBorder,
          "--amie-shadow-medium": tokens.shadows.medium,
        },
        "::placeholder": {
          color: tokens.colors.placeholder,
          opacity: 1,
        },
        "input, select, button, textarea": {
          fontFamily: theme.typography.fontFamily,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radii.control,
        },
        sizeLarge: {
          width: theme.spacing(5.5),
          height: theme.spacing(5.5),
          fontSize: "1.25rem",
        },
        sizeMedium: {
          width: theme.spacing(4.5),
          height: theme.spacing(4.5),
          fontSize: "1rem",
        },
        sizeSmall: {
          width: theme.spacing(3.75),
          height: theme.spacing(3.75),
          fontSize: "0.75rem",
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: theme.palette.text.secondary,
          fontSize: "13.5px",
        },
        outlined: {
          lineHeight: "0.8em",
          "&.MuiInputLabel-root": {
            overflow: "visible",
          },
          "&.MuiInputLabel-sizeSmall": {
            lineHeight: "1em",
          },
          "&.MuiInputLabel-shrink": {
            background: theme.palette.background.paper,
            padding: "0 8px",
            marginLeft: -6,
            lineHeight: "1.4375em",
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        input: {
          padding: "9px 12px",
        },
        root: {
          backgroundColor: theme.palette.background.paper,
          borderRadius: tokens.radii.control,
          fontSize: "13.5px",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.grey[400],
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.grey[500],
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.primary.main,
            borderWidth: 1,
            boxShadow: tokens.shadows.focus,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        rounded: {
          borderRadius: tokens.radii.card,
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          padding: 8,
        },
        switchBase: {
          color: theme.palette.background.paper,
          "&.Mui-checked": {
            color: theme.palette.background.paper,
            "& + .MuiSwitch-track": {
              backgroundColor: theme.palette.primary.main,
              opacity: 1,
            },
          },
        },
        track: {
          backgroundColor: tokens.colors.borderStrong,
          borderRadius: tokens.radii.pill,
          opacity: 1,
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${tokens.colors.borderCard}`,
          borderRadius: tokens.radii.card,
          boxShadow: tokens.shadows.medium,
          overflow: "auto",
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          padding: "9px 32px 9px 12px",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: theme.palette.grey[200],
          fontSize: "13.5px",
          lineHeight: "20px",
          padding: "13px 16px",
        },
        head: {
          color: theme.palette.grey[500],
          fontSize: "10.5px",
          fontWeight: 500,
          letterSpacing: ".12em",
          lineHeight: "16px",
          padding: "11px 16px",
          textTransform: "uppercase",
          backgroundColor: theme.palette.background.paper,
          borderBottomColor: tokens.colors.tableHeadDivider,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&.MuiTableRow-hover:hover": {
            backgroundColor: tokens.colors.warmRowHover,
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderColor: tokens.colors.borderStrong,
          color: tokens.colors.caption,
          fontSize: "12.5px",
          fontWeight: 500,
          textTransform: "none",
          "&.Mui-selected": {
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.primary.main,
            "&:hover": {
              backgroundColor: tokens.colors.warmControlHover,
            },
          },
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          backgroundColor: tokens.colors.neutralTint,
          borderRadius: tokens.radii.node,
          padding: 3,
        },
        grouped: {
          border: "0 !important",
          borderRadius: `${tokens.radii.control - 1}px !important`,
        },
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: tokens.colors.borderStrong,
          "&.Mui-active, &.Mui-completed": {
            color: theme.palette.primary.main,
          },
        },
        text: {
          fill: theme.palette.background.paper,
          fontSize: "11px",
          fontWeight: 600,
        },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          backgroundColor: theme.palette.background.paper,
          borderColor: tokens.colors.borderCard,
          borderRadius: tokens.radii.card,
          boxShadow: tokens.shadows.medium,
          "& .MuiDataGrid-columnHeaders": {
            borderBottomColor: tokens.colors.tableHeadDivider,
            color: tokens.colors.faint,
            fontSize: "10.5px",
            fontWeight: 500,
            letterSpacing: ".12em",
            textTransform: "uppercase",
          },
          "& .MuiDataGrid-cell": {
            borderBottomColor: tokens.colors.rowDivider,
          },
          "& .MuiDataGrid-row:hover": {
            backgroundColor: tokens.colors.warmRowHover,
          },
          "& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within": {
            outline: "none",
          },
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: "52px !important",
        },
      },
    },
  };
}
