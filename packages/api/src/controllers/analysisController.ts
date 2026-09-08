import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  getChartData,
  getJourneyEditorStats,
  getSummarizedData,
} from "backend-lib/src/analysis";
import { AnalyticsView, getAnalytics } from "backend-lib/src/analytics";
import {
  buildRevenueAttributionFile,
  getRevenueBreakdown,
  getRevenueOrders,
  getRevenueSummary,
} from "backend-lib/src/revenueAttribution";
import { FastifyInstance } from "fastify";
import {
  AnalyticsRequest,
  AnalyticsResponse,
  RevenueOrder,
} from "isomorphic-lib/src/analytics";
import {
  DownloadRevenueAttributionRequest,
  GetChartDataRequest,
  GetChartDataResponse,
  GetJourneyEditorStatsRequest,
  GetJourneyEditorStatsResponse,
  GetRevenueBreakdownRequest,
  GetRevenueBreakdownResponse,
  GetRevenueSummaryRequest,
  GetRevenueSummaryResponse,
  GetSummarizedDataRequest,
  GetSummarizedDataResponse,
} from "isomorphic-lib/src/types";

// eslint-disable-next-line @typescript-eslint/require-await
export default async function analysisController(fastify: FastifyInstance) {
  const views: AnalyticsView[] = [
    "overview",
    "flows",
    "broadcasts",
    "emails",
    "deliverability",
    "revenue",
  ];
  views.forEach((view) => {
    fastify.withTypeProvider<TypeBoxTypeProvider>().get(
      view === "revenue" ? "/revenue/report" : `/${view}`,
      {
        schema: {
          tags: ["Analysis"],
          querystring: AnalyticsRequest,
          response: { 200: AnalyticsResponse },
        },
      },
      async (request, reply) =>
        reply.send(await getAnalytics(request.query, view)),
    );
  });
  (["flows", "broadcasts"] as const).forEach((view) => {
    const parameter = view === "flows" ? "journeyId" : "id";
    fastify.withTypeProvider<TypeBoxTypeProvider>().get(
      `/${view}/:${parameter}`,
      {
        schema: {
          tags: ["Analysis"],
          querystring: AnalyticsRequest,
          params: Type.Object({ [parameter]: Type.String({ format: "uuid" }) }),
          response: { 200: AnalyticsResponse },
        },
      },
      async (request, reply) =>
        reply.send(
          await getAnalytics(request.query, view, request.params[parameter]),
        ),
    );
  });
  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/revenue/orders",
    {
      schema: {
        tags: ["Analysis"],
        querystring: Type.Intersect([
          AnalyticsRequest,
          Type.Object({
            offset: Type.Optional(
              Type.Integer({ minimum: 0, maximum: 1000000 }),
            ),
          }),
        ]),
        response: {
          200: Type.Object({
            orders: Type.Array(RevenueOrder),
            hasMore: Type.Boolean(),
          }),
        },
      },
    },
    async (request, reply) => {
      const rows = await getRevenueOrders(
        request.query,
        101,
        request.query.offset ?? 0,
      );
      return reply.send({
        orders: rows.slice(0, 100),
        hasMore: rows.length > 100,
      });
    },
  );
  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/chart-data",
    {
      schema: {
        description: "Get chart data for analysis dashboard.",
        tags: ["Analysis"],
        querystring: GetChartDataRequest,
        response: {
          200: GetChartDataResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await getChartData(request.query);
      return reply.status(200).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/summary",
    {
      schema: {
        description: "Get summarized metrics for analysis dashboard.",
        tags: ["Analysis"],
        querystring: GetSummarizedDataRequest,
        response: {
          200: GetSummarizedDataResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await getSummarizedData(request.query);
      return reply.status(200).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/journey-stats",
    {
      schema: {
        description: "Get journey editor statistics for a specific journey.",
        tags: ["Analysis"],
        querystring: GetJourneyEditorStatsRequest,
        response: {
          200: GetJourneyEditorStatsResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await getJourneyEditorStats(request.query);
      return reply.status(200).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/revenue/summary",
    {
      schema: {
        description:
          "Get last-click attributed and unattributed order revenue for a date range.",
        tags: ["Analysis"],
        querystring: GetRevenueSummaryRequest,
        response: {
          200: GetRevenueSummaryResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await getRevenueSummary(request.query);
      return reply.status(200).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/revenue/breakdown",
    {
      schema: {
        description:
          "Get attributed revenue grouped by broadcast, journey, template, or individual email.",
        tags: ["Analysis"],
        querystring: GetRevenueBreakdownRequest,
        response: {
          200: GetRevenueBreakdownResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await getRevenueBreakdown(request.query);
      return reply.status(200).send(result);
    },
  );

  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    "/revenue/download",
    {
      schema: {
        description: "Download email revenue attribution as CSV.",
        tags: ["Analysis"],
        querystring: DownloadRevenueAttributionRequest,
        response: {
          200: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
    async (request, reply) => {
      const { fileName, fileContent } = await buildRevenueAttributionFile(
        request.query,
      );
      return reply
        .header("Content-Disposition", `attachment; filename=${fileName}`)
        .type("text/csv")
        .send(fileContent);
    },
  );
}
