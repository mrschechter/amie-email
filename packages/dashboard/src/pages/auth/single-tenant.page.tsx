import { LoadingButton } from "@mui/lab";
import { Box, Stack, TextField, Typography } from "@mui/material";
import { AxiosError } from "axios";
import backendConfig, { DEFAULT_BACKEND_CONFIG } from "backend-lib/src/config";
import { SESSION_KEY } from "backend-lib/src/requestContext";
import { UNAUTHORIZED_PAGE } from "isomorphic-lib/src/constants";
import { GetServerSideProps, NextPage } from "next";
import { useRouter } from "next/router";
import React from "react";

import { useSingleTenantLoginMutation } from "../../lib/useSingleTenantLoginMutation";
import tokens from "../../themeCustomization/tokens";

interface SingleTenantAuthProps {
  warnings: string[];
  apiBaseUrl: string;
}

export const getServerSideProps: GetServerSideProps<
  SingleTenantAuthProps
> = async (ctx) => {
  if (backendConfig().authMode !== "single-tenant") {
    return {
      redirect: {
        permanent: false,
        destination: UNAUTHORIZED_PAGE,
      },
    };
  }
  if (ctx.req.headers[SESSION_KEY] === "true") {
    return {
      redirect: {
        permanent: false,
        destination: "/",
      },
    };
  }
  const warnings: string[] = [];

  const {
    password,
    databasePassword,
    clickhousePassword,
    secretKey,
    sessionCookieSecure,
    bootstrap,
  } = backendConfig();

  if (password === DEFAULT_BACKEND_CONFIG.password) {
    warnings.push(
      "Default password is being used. Please configure the PASSWORD environment variable.",
    );
  }

  if (bootstrap) {
    warnings.push(
      "Bootstrap is enabled. Please set BOOTSTRAP to 'false' after initial setup.",
    );
  }

  if (databasePassword === DEFAULT_BACKEND_CONFIG.databasePassword) {
    warnings.push(
      "Default database password is being used. Please configure the DATABASE_PASSWORD environment variable.",
    );
  }

  if (clickhousePassword === DEFAULT_BACKEND_CONFIG.clickhousePassword) {
    warnings.push(
      "Default clickhouse password is being used. Please configure the CLICKHOUSE_PASSWORD environment variable.",
    );
  }

  if (secretKey === DEFAULT_BACKEND_CONFIG.secretKey) {
    warnings.push(
      "Default secret key is being used. Please configure the SECRET_KEY environment variable.",
    );
  }

  if (!sessionCookieSecure) {
    warnings.push(
      "Single tenant cookie is not secure. Please use tls and set SESSION_COOKIE_SECURE='true'.",
    );
  }

  return {
    props: {
      warnings,
      apiBaseUrl: backendConfig().apiBase,
    },
  };
};

const APPLICATION_ERROR = "API Error: something wen't wrong.";

const SingleTenantAuth: NextPage<SingleTenantAuthProps> =
  function SingleTenantAuth({ warnings, apiBaseUrl }) {
    const path = useRouter();
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");

    const loginMutation = useSingleTenantLoginMutation(apiBaseUrl, {
      onSuccess: () => {
        path.push("/");
      },
      onError: (e) => {
        if (!(e instanceof AxiosError) || e.response?.status !== 401) {
          setError(APPLICATION_ERROR);
          return;
        }
        setError("Invalid password");
      },
    });

    const submit = async () => {
      if (loginMutation.isPending) {
        return;
      }
      setError("");
      loginMutation.mutate({ password });
    };

    return (
      <Box
        sx={{
          alignItems: "center",
          background:
            `radial-gradient(640px 420px at 50% 28%, ${tokens.colors.blush} 0%, rgba(245,230,224,0) 70%), ${tokens.colors.ivory}`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minHeight: "100vh",
          p: 3,
          width: "100%",
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            alignItems: "center",
            bgcolor: "secondary.A200",
            borderRadius: "12px",
            boxShadow: tokens.shadows.small,
            color: "primary.main",
            display: "flex",
            fontFamily: (theme) => theme.typography.displayFontFamily,
            fontSize: 25,
            fontWeight: 600,
            height: 46,
            justifyContent: "center",
            width: 46,
          }}
        >
          A
        </Box>
        <Typography
          sx={{
            color: "grey.800",
            fontFamily: (theme) => theme.typography.displayFontFamily,
            fontSize: 34,
            fontWeight: 600,
            lineHeight: 1.2,
            mt: 1.75,
          }}
        >
          Amie Send
        </Typography>
        <Typography
          sx={{ color: "text.secondary", fontSize: "13.5px", mt: 0.5 }}
        >
          Internal email platform
        </Typography>
        <Box
          sx={{
            bgcolor: "background.paper",
            border: `1px solid ${tokens.colors.borderLogin}`,
            borderRadius: "14px",
            boxShadow: tokens.shadows.login,
            maxWidth: "100%",
            mt: 3.5,
            p: "26px 26px 24px",
            width: 380,
          }}
        >
          <Typography
            component="label"
            htmlFor="workspace-password"
            sx={{
              color: tokens.colors.secondaryText,
              display: "block",
              fontSize: "12.5px",
              fontWeight: 500,
              mb: 1,
            }}
          >
            Workspace password
          </Typography>
          <TextField
            error={!!error}
            sx={{
              width: "100%",
              "& .MuiOutlinedInput-input": {
                fontSize: 14,
                p: "11px 13px",
              },
            }}
            id="workspace-password"
            placeholder="••••••••••"
            type="password"
            value={password}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submit();
              }
            }}
            helperText={error}
            onChange={(e) => {
              setError("");
              setPassword(e.target.value);
            }}
          />
          <LoadingButton
            fullWidth
            disabled={loginMutation.isPending}
            loading={loginMutation.isPending}
            onClick={submit}
            sx={{ mt: 1.75, py: "11px" }}
            variant="contained"
          >
            Sign in
          </LoadingButton>
          <Typography
            sx={{
              color: tokens.colors.hint,
              fontSize: "11.5px",
              mt: 1.75,
              textAlign: "center",
            }}
          >
            Shared with the marketing and CX team only.
          </Typography>
        </Box>
        {Boolean(warnings.length) && (
          <Stack
            direction="column"
            spacing={1}
            sx={{
              maxWidth: 380,
              mt: 2,
              p: 2,
              fontWeight: 600,
              bgcolor: "error.lighter",
              border: "1px solid",
              borderColor: "error.main",
              borderRadius: 1,
              color: "error.darker",
            }}
          >
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </Stack>
        )}
        <Typography sx={{ color: "grey.500", fontSize: "11.5px", mt: 4.5 }}>
          email.tryamie.com · an internal tool by Amie
        </Typography>
      </Box>
    );
  };

export default SingleTenantAuth;
