import LoadingButton from "@mui/lab/LoadingButton";
import {
  Alert,
  Box,
  FormControlLabel,
  FormGroup,
  Link,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { SubscriptionChange } from "backend-lib/src/types";
import { UserSubscriptionResource } from "isomorphic-lib/src/types";
import { enqueueSnackbar } from "notistack";
import React, { useMemo } from "react";
import { useImmer } from "use-immer";

import { noticeAnchorOrigin } from "../lib/notices";
import { useUpdateSubscriptionsMutation } from "../lib/useUpdateSubscriptionsMutation";

export type SubscriptionState = Record<string, boolean>;
export type ChannelState = Record<string, boolean>;
export interface SubscriptionManagementProps {
  subscriptions: UserSubscriptionResource[];
  changedSubscription?: string;
  subscriptionChange?: SubscriptionChange;
  changedSubscriptionChannel?: string;
  hash: string;
  identifier: string;
  identifierKey: string;
  workspaceId: string;
  workspaceName: string;
  apiBase: string;
  isPreview?: boolean;
  showAllChannels?: boolean;
}

export function SubscriptionManagement({
  subscriptions,
  changedSubscription,
  subscriptionChange,
  changedSubscriptionChannel,
  workspaceId,
  hash,
  identifier,
  identifierKey,
  workspaceName,
  apiBase,
  isPreview = false,
  showAllChannels = false,
}: SubscriptionManagementProps) {
  const initialSubscriptionManagementState = React.useMemo(
    () =>
      subscriptions.reduce<SubscriptionState>((acc, subscription) => {
        acc[subscription.id] = subscription.isSubscribed;
        return acc;
      }, {}),
    [subscriptions],
  );

  // Group subscriptions by channel
  const subscriptionsByChannel = React.useMemo(() => {
    const grouped = subscriptions.reduce<
      Record<string, UserSubscriptionResource[]>
    >((acc, subscription) => {
      const existingChannelSubs = acc[subscription.channel];
      if (existingChannelSubs) {
        existingChannelSubs.push(subscription);
      } else {
        acc[subscription.channel] = [subscription];
      }
      return acc;
    }, {});

    // Filter channels based on showAllChannels prop
    if (!showAllChannels && changedSubscriptionChannel) {
      const filteredGrouped: Record<string, UserSubscriptionResource[]> = {};
      const channelSubscriptions = grouped[changedSubscriptionChannel];
      if (channelSubscriptions) {
        filteredGrouped[changedSubscriptionChannel] = channelSubscriptions;
      }
      return filteredGrouped;
    }

    return grouped;
  }, [subscriptions, showAllChannels, changedSubscriptionChannel]);

  // Calculate initial channel state based on subscription states
  const initialChannelState = React.useMemo(() => {
    const channelState: ChannelState = {};
    Object.entries(subscriptionsByChannel).forEach(
      ([channel, channelSubscriptions]) => {
        if (channelSubscriptions.length > 0) {
          // Channel is checked if ANY subscription in that channel is checked
          const anySubscribed = channelSubscriptions.some(
            (sub) => initialSubscriptionManagementState[sub.id],
          );
          channelState[channel] = anySubscribed;
        }
      },
    );
    return channelState;
  }, [subscriptionsByChannel, initialSubscriptionManagementState]);

  const [state, updateState] = useImmer<SubscriptionState>(
    initialSubscriptionManagementState,
  );
  const [channelState, updateChannelState] =
    useImmer<ChannelState>(initialChannelState);

  const updateSubscriptionsMutation = useUpdateSubscriptionsMutation(apiBase, {
    onSuccess: () => {
      const message = isPreview
        ? "Preview: Subscription preferences would be updated."
        : "Updated subscription preferences.";
      enqueueSnackbar(message, {
        variant: "success",
        autoHideDuration: 3000,
        anchorOrigin: noticeAnchorOrigin,
      });
    },
    onError: () => {
      enqueueSnackbar("API Error: failed to update subscription preferences.", {
        variant: "error",
        autoHideDuration: 3000,
        anchorOrigin: noticeAnchorOrigin,
      });
    },
  });

  const handleSubscriptionChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const subscriptionId = event.target.name;
    const isChecked = event.target.checked;

    updateState((draft) => {
      draft[subscriptionId] = isChecked;
    });

    // Update channel state based on subscription changes
    const subscription = subscriptions.find((sub) => sub.id === subscriptionId);
    if (subscription) {
      const channelSubscriptions = subscriptionsByChannel[subscription.channel];
      if (channelSubscriptions) {
        // Check if ANY subscription in the channel will be checked after this change
        const anyChannelSubscriptionChecked = channelSubscriptions.some(
          (sub) => (sub.id === subscriptionId ? isChecked : state[sub.id]),
        );

        updateChannelState((draft) => {
          draft[subscription.channel] = anyChannelSubscriptionChecked;
        });
      }
    }
  };

  const handleChannelChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const channel = event.target.name;
    const isChecked = event.target.checked;

    updateChannelState((draft) => {
      draft[channel] = isChecked;
    });

    // Update all subscription states for this channel
    const channelSubscriptions = subscriptionsByChannel[channel] || [];
    updateState((draft) => {
      channelSubscriptions.forEach((subscription) => {
        draft[subscription.id] = isChecked;
      });
    });
  };
  const changedSubscriptionName = useMemo(
    () =>
      changedSubscription &&
      subscriptions.find((s) => s.id === changedSubscription)?.name,
    [subscriptions, changedSubscription],
  );

  let subscriptionChangeSection = null;
  if (
    subscriptionChange &&
    (changedSubscription || changedSubscriptionChannel)
  ) {
    let message: string;

    if (subscriptionChange === SubscriptionChange.Subscribe) {
      message = `You have subscribed to ${changedSubscriptionName}`;
    } else if (changedSubscriptionChannel) {
      message = `You have unsubscribed from all ${changedSubscriptionChannel} messages`;
    } else {
      message = `You have unsubscribed from ${changedSubscriptionName}`;
    }

    subscriptionChangeSection = (
      <Alert
        severity="success"
        sx={{
          backgroundColor: "success.lighter",
          color: "success.dark",
          borderRadius: 1,
          py: 0.25,
        }}
      >
        {message}
      </Alert>
    );
  }

  const handleUpdate = () => {
    if (isPreview) {
      // In preview mode, just show the success message without making an API call
      enqueueSnackbar("Preview: Subscription preferences would be updated.", {
        variant: "success",
        autoHideDuration: 3000,
        anchorOrigin: noticeAnchorOrigin,
      });
    } else {
      updateSubscriptionsMutation.mutate({
        workspaceId,
        hash,
        identifier,
        identifierKey,
        changes: state,
      });
    }
  };
  const isUnsubscribed = subscriptionChange === SubscriptionChange.Unsubscribe;

  return (
    <Box
      component="main"
      sx={{
        width: "100%",
        minHeight: "100vh",
        backgroundColor: "background.default",
        px: 3,
        py: 7,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 560, mx: "auto" }}>
        <Typography
          component="div"
          sx={{
            color: "secondary.800",
            fontFamily: (theme) => theme.typography.displayFontFamily,
            fontSize: "26px",
            fontWeight: 600,
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          Amie<Box component="span" sx={{ color: "error.main" }}>.</Box>
        </Typography>

        <Box
          aria-hidden="true"
          sx={{
            alignItems: "center",
            backgroundColor: isUnsubscribed
              ? "success.lighter"
              : "primary.lighter",
            borderRadius: 999,
            color: isUnsubscribed ? "success.dark" : "primary.main",
            display: "flex",
            fontSize: "20px",
            height: 46,
            justifyContent: "center",
            mt: 4.25,
            mx: "auto",
            width: 46,
          }}
        >
          {isUnsubscribed ? "✓" : "A"}
        </Box>

        <Typography variant="h4" sx={{ mt: 2, textAlign: "center" }}>
          {isUnsubscribed ? "You're unsubscribed." : "Choose what you receive."}
        </Typography>
        <Typography
          sx={{
            color: "secondary.main",
            fontSize: "15px",
            lineHeight: 1.6,
            maxWidth: 480,
            mt: 1.5,
            mx: "auto",
            textAlign: "center",
          }}
        >
          {isUnsubscribed
            ? `${identifier} will no longer receive the messages you opted out of from ${workspaceName}. Essential account and service messages are not affected.`
            : `Update the messages ${identifier} receives from ${workspaceName}. Your changes take effect immediately.`}
        </Typography>

        <Stack
          spacing={0}
          sx={{
            backgroundColor: "background.paper",
            border: "1px solid",
            borderColor: "grey.A800",
            borderRadius: "14px",
            boxShadow: 2,
            mt: 4,
            overflow: "hidden",
            px: 2.75,
            pb: 2.25,
          }}
        >
          <Typography variant="subtitle1" sx={{ py: 2 }}>
            Prefer to choose what you receive?
          </Typography>
          {subscriptionChangeSection && (
            <Box sx={{ pb: 1.5 }}>{subscriptionChangeSection}</Box>
          )}
          <FormGroup>
            {Object.entries(subscriptionsByChannel).map(
              ([channel, channelSubscriptions]) => (
                <Box
                  key={channel}
                  sx={{ borderTop: "1px solid", borderColor: "grey.200" }}
                >
                  <FormControlLabel
                    labelPlacement="start"
                    control={
                      <Switch
                        checked={channelState[channel] === true}
                        onChange={handleChannelChange}
                        name={channel}
                        size="small"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="subtitle1">
                          {channel} messages
                        </Typography>
                        <Typography variant="caption">
                          Turn every {channel.toLowerCase()} preference on or off
                        </Typography>
                      </Box>
                    }
                    sx={{
                      justifyContent: "space-between",
                      m: 0,
                      py: 1.25,
                      width: "100%",
                    }}
                  />
                  <Stack
                    sx={{ borderTop: "1px solid", borderColor: "grey.200" }}
                  >
                    {channelSubscriptions.map((subscription) => (
                      <FormControlLabel
                        key={subscription.id}
                        labelPlacement="start"
                        control={
                          <Switch
                            checked={state[subscription.id] === true}
                            onChange={handleSubscriptionChange}
                            name={subscription.id}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2" color="secondary.800">
                            {subscription.name}
                          </Typography>
                        }
                        sx={{
                          justifyContent: "space-between",
                          m: 0,
                          py: 1,
                          pl: 1.5,
                          width: "100%",
                          "& + &": {
                            borderTop: "1px solid",
                            borderColor: "grey.200",
                          },
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
              ),
            )}
          </FormGroup>
          <Box sx={{ borderTop: "1px solid", borderColor: "grey.200", pt: 2 }}>
            <LoadingButton
              loading={!isPreview && updateSubscriptionsMutation.isPending}
              variant="contained"
              onClick={handleUpdate}
            >
              Save preferences
            </LoadingButton>
          </Box>
        </Stack>

        <Box
          sx={{
            borderTop: "1px solid",
            borderColor: "divider",
            mt: 4.5,
            pt: 2.25,
          }}
        >
          <Typography
            variant="caption"
            component="div"
            sx={{ color: "grey.500", lineHeight: 1.7, textAlign: "center" }}
          >
            Amie Health · 2261 Market St #4010 · San Francisco, CA 94114
            <br />
            Questions?{" "}
            <Link href="mailto:support@tryamie.com">support@tryamie.com</Link>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
