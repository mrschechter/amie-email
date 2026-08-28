import { TextField, TextFieldProps } from "@mui/material";

export const TEXT_FIELD_HEIGHT = 0.8;

export default function SimpleTextField(props: TextFieldProps) {
  const { sx } = props;
  return (
    <TextField
      {...props}
      InputLabelProps={{ shrink: true }}
      sx={{
        ...sx,
        fieldset: {
          display: "none",
        },
        input: {
          height: `${TEXT_FIELD_HEIGHT}rem`,
        },

        label: {
          transform: "translate(0px, -24px) !important",
          color: "inherit",
        },
        "& .MuiOutlinedInput-root": {
          border: "1px solid",
          borderColor: "grey.400",
          borderRadius: 1,
        },
        "& .MuiFormHelperText-root": {
          marginLeft: 0,
        },
      }}
    />
  );
}
