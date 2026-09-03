import formbody from "@fastify/formbody";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { db } from "backend-lib/src/db";
import * as schema from "backend-lib/src/db/schema";
import logger from "backend-lib/src/logger";
import {
  getUserSubscriptions,
  lookupUserForSubscriptions,
  updateUserSubscriptions,
} from "backend-lib/src/subscriptionGroups";
import { generateSubscriptionManagementPage } from "backend-lib/src/subscriptionManagementPage";
import {
  EmptyResponse,
  SubscriptionChange,
  UserSubscriptionsUpdate,
} from "backend-lib/src/types";
import { and, eq } from "drizzle-orm";
import { FastifyInstance } from "fastify";
import {
  ChannelType,
  SubscriptionManagementPageSubmissionRequest,
  SubscriptionParams,
} from "isomorphic-lib/src/types";

const OneClickUnsubscribeRequest = Type.Object(
  {
    "List-Unsubscribe": Type.String({
      pattern: "^\\s*[Oo][Nn][Ee]-[Cc][Ll][Ii][Cc][Kk]\\s*$",
    }),
  },
  { additionalProperties: false, maxProperties: 1 },
);

const SubscriptionManagementPagePostRequest = Type.Union([
  SubscriptionManagementPageSubmissionRequest,
  OneClickUnsubscribeRequest,
]);

function isOneClickUnsubscribeRequest(
  body: unknown,
): body is { "List-Unsubscribe": string } {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "List-Unsubscribe") {
    return false;
  }

  const value: unknown = Object.getOwnPropertyDescriptor(
    body,
    "List-Unsubscribe",
  )?.value;
  return (
    typeof value === "string" && value.trim().toLowerCase() === "one-click"
  );
}

export default async function subscriptionManagementController(
  fastify: FastifyInstance,
) {
  // Register formbody to accept application/x-www-form-urlencoded POST data
  await fastify.register(formbody);

  fastify.withTypeProvider<TypeBoxTypeProvider>().put(
    "/user-subscriptions",
    {
      schema: {
        description: "Allows users to manage their subscriptions.",
        body: UserSubscriptionsUpdate,
        response: {
          204: EmptyResponse,
          401: Type.Object({
            message: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, identifier, identifierKey, hash, changes } =
        request.body;

      const userLookupResult = await lookupUserForSubscriptions({
        workspaceId,
        identifier,
        identifierKey,
        hash,
      });

      if (userLookupResult.isErr()) {
        return reply.status(401).send({
          message: "Invalid user hash.",
        });
      }

      const { userId } = userLookupResult.value;

      await updateUserSubscriptions({
        workspaceId,
        userUpdates: [
          {
            userId,
            changes,
          },
        ],
      });

      return reply.status(204).send();
    },
  );

  // Serve subscription management page as self-contained HTML
  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/page",
    {
      schema: {
        description:
          "Serves a self-contained subscription management page with inlined JavaScript.",
        querystring: SubscriptionParams,
        response: {
          200: Type.String(),
          401: Type.Object({
            message: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const {
        w: workspaceId,
        i: identifier,
        ik: identifierKey,
        h: hash,
        s: subscriptionGroupId,
        sub,
        isPreview: isPreviewParam,
        success: successParam,
        error: errorParam,
        previewSubmitted: previewSubmittedParam,
      } = request.query;

      const isPreview = isPreviewParam === "true";
      const success = successParam === "true";
      const error = errorParam === "true";
      const previewSubmitted = previewSubmittedParam === "true";

      // Look up user and workspace
      const [userLookupResult, workspace] = await Promise.all([
        isPreview
          ? null
          : lookupUserForSubscriptions({
              workspaceId,
              identifier,
              identifierKey,
              hash,
            }),
        db().query.workspace.findFirst({
          where: eq(schema.workspace.id, workspaceId),
        }),
      ]);

      let userId: string | undefined;
      if (userLookupResult) {
        if (userLookupResult.isErr()) {
          logger().info(
            {
              err: userLookupResult.error,
            },
            "Failed user lookup for subscription page",
          );
          return reply.status(401).send({
            message: "Unauthorized",
          });
        }
        userId = userLookupResult.value.userId;
      } else {
        // Preview mode
        userId = "123-preview";
      }

      if (!workspace) {
        logger().error({
          err: new Error("Workspace not found"),
        });
        return reply.status(401).send({
          message: "Unauthorized",
        });
      }

      // Handle subscription change if provided
      let subscriptionChange: "Subscribe" | "Unsubscribe" | undefined;
      let changedSubscriptionChannel: string | undefined;

      if (subscriptionGroupId) {
        const targetSubscriptionGroup =
          await db().query.subscriptionGroup.findFirst({
            where: eq(schema.subscriptionGroup.id, subscriptionGroupId),
          });

        changedSubscriptionChannel = targetSubscriptionGroup?.channel;

        if (sub) {
          // Set subscriptionChange to show the message (works in both preview and real mode)
          subscriptionChange =
            sub === "1"
              ? SubscriptionChange.Subscribe
              : SubscriptionChange.Unsubscribe;

          // Only perform actual subscription update when not in preview mode
          if (!isPreview && targetSubscriptionGroup) {
            if (subscriptionChange === SubscriptionChange.Unsubscribe) {
              // Unsubscribe from all subscription groups in the same channel
              const channelSubscriptionGroups =
                await db().query.subscriptionGroup.findMany({
                  where: and(
                    eq(schema.subscriptionGroup.workspaceId, workspaceId),
                    eq(
                      schema.subscriptionGroup.channel,
                      targetSubscriptionGroup.channel,
                    ),
                  ),
                });

              const channelChanges: Record<string, boolean> = {};
              channelSubscriptionGroups.forEach((sg) => {
                channelChanges[sg.id] = false;
              });

              await updateUserSubscriptions({
                workspaceId,
                userUpdates: [
                  {
                    userId,
                    changes: channelChanges,
                  },
                ],
              });
            } else {
              await updateUserSubscriptions({
                workspaceId,
                userUpdates: [
                  {
                    userId,
                    changes: {
                      [subscriptionGroupId]: true,
                    },
                  },
                ],
              });
            }
          }
        }
      }

      // Get user subscriptions
      const subscriptions = await getUserSubscriptions({
        userId,
        workspaceId,
      });

      // Generate the page HTML
      const html = await generateSubscriptionManagementPage({
        workspaceId,
        workspaceName: workspace.name,
        subscriptions,
        hash,
        identifier,
        identifierKey,
        isPreview,
        subscriptionChange,
        changedSubscriptionId: subscriptionGroupId,
        changedSubscriptionChannel,
        success,
        error,
        previewSubmitted,
      });

      return reply.type("text/html").send(html);
    },
  );

  // Handle form submission for subscription preferences
  fastify.withTypeProvider<TypeBoxTypeProvider>().post(
    "/page",
    {
      schema: {
        description:
          "Handles browser subscription preferences and RFC 8058 one-click unsubscribe requests.",
        querystring: Type.Partial(SubscriptionParams),
        body: SubscriptionManagementPagePostRequest,
        response: {
          200: EmptyResponse,
          302: Type.Null(),
          400: Type.Object({
            message: Type.String(),
          }),
          401: Type.Object({
            message: Type.String(),
          }),
          403: Type.Object({
            message: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      if (isOneClickUnsubscribeRequest(request.body)) {
        const {
          w: workspaceId,
          i: identifier,
          ik: identifierKey,
          h: hash,
          s: subscriptionGroupId,
          isPreview: isPreviewParam,
        } = request.query;
        const logContext = {
          event: "one_click_unsubscribe",
          workspaceId: workspaceId ?? "unknown",
          subscriptionGroupId: subscriptionGroupId ?? "all",
        };

        if (!workspaceId || !identifier || !identifierKey || !hash) {
          logger().info(
            { ...logContext, result: "invalid_request" },
            "Rejected one-click unsubscribe with missing query parameters",
          );
          return reply.status(400).send({ message: "Invalid request" });
        }

        if (isPreviewParam === "true") {
          logger().info(
            { ...logContext, result: "preview_ignored" },
            "Ignored one-click unsubscribe for preview URL",
          );
          return reply.status(200).send();
        }

        const userLookupResult = await lookupUserForSubscriptions({
          workspaceId,
          identifier,
          identifierKey,
          hash,
        });

        if (userLookupResult.isErr()) {
          logger().info(
            { ...logContext, result: "invalid_hash" },
            "Rejected one-click unsubscribe with invalid credentials",
          );
          return reply.status(403).send({ message: "Forbidden" });
        }

        const subscriptionGroups = await db().query.subscriptionGroup.findMany({
          where: subscriptionGroupId
            ? and(
                eq(schema.subscriptionGroup.workspaceId, workspaceId),
                eq(schema.subscriptionGroup.id, subscriptionGroupId),
              )
            : and(
                eq(schema.subscriptionGroup.workspaceId, workspaceId),
                eq(schema.subscriptionGroup.channel, ChannelType.Email),
              ),
        });

        if (subscriptionGroupId && subscriptionGroups.length === 0) {
          logger().info(
            { ...logContext, result: "subscription_group_not_found" },
            "Rejected one-click unsubscribe for unknown subscription group",
          );
          return reply.status(400).send({ message: "Invalid request" });
        }

        const changes: Record<string, boolean> = {};
        subscriptionGroups.forEach((subscriptionGroup) => {
          changes[subscriptionGroup.id] = false;
        });

        try {
          await updateUserSubscriptions({
            workspaceId,
            userUpdates: [
              {
                userId: userLookupResult.value.userId,
                changes,
              },
            ],
          });
        } catch (error) {
          logger().error(
            { ...logContext, result: "error", err: error },
            "Failed one-click unsubscribe",
          );
          throw error;
        }

        logger().info(
          { ...logContext, result: "unsubscribed" },
          "Processed one-click unsubscribe",
        );
        return reply.status(200).send();
      }

      // Type from schema defines w, h, i, ik as required strings
      const typedBody = request.body;
      const {
        w: workspaceId,
        h: hash,
        i: identifier,
        ik: identifierKey,
        isPreview: isPreviewParam,
      } = typedBody;

      const isPreview = isPreviewParam === "true";

      // Build redirect URL with original params
      const redirectParams = new URLSearchParams({
        w: workspaceId,
        h: hash,
        i: identifier,
        ik: identifierKey,
      });
      if (isPreview) {
        redirectParams.set("isPreview", "true");
      }

      // In preview mode, just redirect with preview_submitted flag
      if (isPreview) {
        redirectParams.set("previewSubmitted", "true");
        return reply.redirect(
          302,
          `/api/public/subscription-management/page?${redirectParams.toString()}`,
        );
      }

      // Verify user
      const userLookupResult = await lookupUserForSubscriptions({
        workspaceId,
        identifier,
        identifierKey,
        hash,
      });

      if (userLookupResult.isErr()) {
        logger().info(
          { err: userLookupResult.error },
          "Failed user lookup for subscription form submission",
        );
        return reply.status(401).send({
          message: "Unauthorized",
        });
      }

      const { userId } = userLookupResult.value;

      // Get all subscription groups for this workspace to determine changes
      const subscriptionGroups = await db().query.subscriptionGroup.findMany({
        where: eq(schema.subscriptionGroup.workspaceId, workspaceId),
      });

      // Build changes object from form data
      // Checkboxes that are checked will have value "true"
      // Checkboxes that are unchecked won't be in the form data at all
      const changes: Record<string, boolean> = {};
      for (const sg of subscriptionGroups) {
        const checkboxName = `sub_${sg.id}`;
        const isChecked = typedBody[checkboxName] === "true";
        changes[sg.id] = isChecked;
      }

      try {
        await updateUserSubscriptions({
          workspaceId,
          userUpdates: [
            {
              userId,
              changes,
            },
          ],
        });
        redirectParams.set("success", "true");
      } catch (error) {
        logger().error({ err: error }, "Failed to update subscriptions");
        redirectParams.set("error", "true");
      }

      return reply.redirect(
        302,
        `/api/public/subscription-management/page?${redirectParams.toString()}`,
      );
    },
  );
}
