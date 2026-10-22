import { SourceType } from "isomorphic-lib/src/constants";
import { err, ok, Result, ResultAsync } from "neverthrow";
import qs from "querystring";
import { omitBy } from "remeda";
import TwilioClient from "twilio";
import RestException from "twilio/lib/base/RestException";
import { v5 as uuidv5 } from "uuid";

import { submitBatch } from "../apps/batch";
import config from "../config";
import logger from "../logger";
import {
  BatchTrackData,
  EventType,
  InternalEventType,
  MessageTags,
  SmsProviderType,
  TwilioInboundSchema,
  TwilioMessageStatus,
  TwilioWebhookRequest,
} from "../types";

export const TwilioRestException = RestException;

export const TWILIO_WEBHOOK_PATH = "/api/public/webhooks/twilio";

const UPSTREAM_HOSTED_HOST = "app.dittofeed.com";

/**
 * Public origin that Twilio status callbacks are sent to, and that the
 * webhook handler reconstructs to validate X-Twilio-Signature. Both sides
 * MUST use this function so the signed URL matches.
 *
 * Prefers the API base (DASHBOARD_API_BASE, which is how Amie Send is
 * configured) over dashboardUrl: when DASHBOARD_URL is unset, dashboardUrl
 * silently defaults to the upstream hosted https://app.dittofeed.com in
 * production. Same precedence as subscription-management links.
 */
export function getTwilioWebhookPublicBaseUrl(): string {
  const { apiBase, dashboardUrl } = config();
  return (apiBase || dashboardUrl).replace(/\/+$/, "");
}

function isUpstreamHostedBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === UPSTREAM_HOSTED_HOST;
  } catch {
    return true;
  }
}

export interface PhoneNumberSender {
  from: string;
}

export interface MessagingServiceSender {
  messagingServiceSid: string;
}

export type Sender = PhoneNumberSender | MessagingServiceSender;

export type TwilioAuth =
  | {
      type: "authToken";
      authToken: string;
    }
  | {
      type: "apiKey";
      apiKeySid: string;
      apiKeySecret: string;
    };

export async function sendSms({
  body,
  to,
  subscriptionGroupId,
  userId,
  workspaceId,
  disableCallback = false,
  tags,
  auth,
  accountSid,
  ...sender
}: {
  body: string;
  to: string;
  subscriptionGroupId: string | undefined;
  userId: string;
  workspaceId: string;
  accountSid: string;
  auth: TwilioAuth;
  disableCallback?: boolean;
  tags?: MessageTags;
} & Sender): Promise<Result<{ sid: string }, RestException | Error>> {
  const client =
    auth.type === "apiKey"
      ? TwilioClient(auth.apiKeySid, auth.apiKeySecret, {
          accountSid,
        })
      : TwilioClient(accountSid, auth.authToken);
  try {
    let statusCallback: string | undefined;
    if (!disableCallback) {
      const publicBaseUrl = getTwilioWebhookPublicBaseUrl();
      if (isUpstreamHostedBaseUrl(publicBaseUrl)) {
        // Never hand Twilio a callback on the upstream hosted Dittofeed
        // domain: it is not ours, rejects the callback (503) and would receive
        // our user/workspace ids. Twilio then falls back to the messaging
        // service's own status callback, if any.
        logger().warn(
          { workspaceId, publicBaseUrl },
          "Skipping Twilio status callback: public API base URL is not configured (set DASHBOARD_API_BASE or DASHBOARD_URL).",
        );
      } else {
        const queryParams = qs.stringify({
          ...omitBy(tags, (_v, key) => key === "channel"),
          subscriptionGroupId,
          userId,
          workspaceId,
        });
        statusCallback = `${publicBaseUrl}${TWILIO_WEBHOOK_PATH}?${queryParams}`;
      }
    }

    const createPayload = {
      ...sender,
      body,
      to,
      statusCallback,
    };
    logger().debug(
      {
        accountSid,
        ...createPayload,
      },
      "Sending SMS",
    );
    const response = await client.messages.create(createPayload);
    logger().debug({ response }, "SMS sent");
    return ok({ sid: response.sid });
  } catch (e) {
    if (e instanceof RestException) {
      return err(e);
    }
    // unknown error
    const error = e as Error;
    return err(error);
  }
}

export async function submitTwilioEvents({
  workspaceId,
  TwilioEvent,
  userId,
  ...tags
}: {
  TwilioEvent: TwilioInboundSchema;
} & TwilioWebhookRequest): Promise<ResultAsync<void, Error>> {
  let eventName: InternalEventType;
  const body = TwilioEvent.Body;

  switch (TwilioEvent.SmsStatus) {
    case TwilioMessageStatus.Failed:
    case TwilioMessageStatus.Undelivered:
      eventName = InternalEventType.SmsFailed;
      break;
    case TwilioMessageStatus.Delivered:
      eventName = InternalEventType.SmsDelivered;
      break;
    case TwilioMessageStatus.Queued:
    case TwilioMessageStatus.Sending:
    case TwilioMessageStatus.Sent:
    case TwilioMessageStatus.Accepted:
    case TwilioMessageStatus.Scheduled:
      // Intermediate states: Twilio calls back again with the final status.
      return ok(undefined);
    default:
      logger().error(
        {
          workspaceId,
          userId,
          smsStatus: TwilioEvent.SmsStatus,
          messageSid: TwilioEvent.MessageSid,
        },
        "Unhandled Twilio event type",
      );
      return err(
        new Error(`Unhandled Twilio event type: ${TwilioEvent.SmsStatus}`),
      );
  }

  if (!userId) {
    return err(new Error("Missing userId."));
  }

  const messageId = uuidv5(
    `${TwilioEvent.SmsStatus}:${TwilioEvent.MessageSid}`,
    workspaceId,
  );

  const item = {
    type: EventType.Track,
    event: eventName,
    userId,
    messageId,
    properties: {
      workspaceId,
      userId,
      body,
      ...tags,
      twilioStatus: TwilioEvent.SmsStatus,
      twilioMessageSid: TwilioEvent.MessageSid,
      ...(TwilioEvent.ErrorCode
        ? { twilioErrorCode: TwilioEvent.ErrorCode }
        : {}),
    },
  } as BatchTrackData;

  return ResultAsync.fromPromise(
    submitBatch({
      workspaceId,
      data: {
        context: {
          source: SourceType.Webhook,
          provider: SmsProviderType.Twilio,
        },
        batch: [item],
      },
    }),
    (e) => (e instanceof Error ? e : Error(e as string)),
  );
}
