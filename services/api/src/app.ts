import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import type { DealCandidate, PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { authenticateBearerToken, requireAdmin, type AuthenticatedPrincipal } from "./auth-service.js";
import { loginWithPassword, revokeRefreshToken, rotateRefreshToken } from "./auth-session-service.js";
import { listDealCandidates, reviewDealCandidate } from "./deal-candidate-service.js";

const AUTH_RATE_WINDOW_MS = 60_000;
const AUTH_RATE_MAX = 5;
const AUTH_RATE_BUCKET_LIMIT = 10_000;

export interface ServerDependencies {
  prisma: PrismaClient;
  /** HS256 signing secret for access tokens; unset means the auth routes stay closed. */
  authSigningSecret?: string | undefined;
  now?: () => Date;
}

type ReviewDecision = "APPROVED" | "REJECTED" | "ARCHIVED";

const REVIEW_DECISIONS: readonly ReviewDecision[] = ["APPROVED", "REJECTED", "ARCHIVED"];
const REVIEW_STATUSES = ["DISCOVERED", "APPROVED", "REJECTED", "ARCHIVED"] as const;
const MAX_DEAL_LIMIT = 100;

const STATUS_BY_ERROR: Readonly<Record<string, number>> = Object.freeze({
  AUTH_SIGNING_SECRET_NOT_CONFIGURED: 503,
  AUTHENTICATION_REQUIRED: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_TOKEN_EXPIRED_OR_NOT_ACTIVE: 401,
  AUTHENTICATED_USER_UNAVAILABLE: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_REFRESH_TOKEN: 401,
  REFRESH_TOKEN_REUSE_OR_RACE: 401,
  ADMIN_ROLE_REQUIRED: 403,
  PASSWORD_POLICY_VIOLATION: 400,
  DEAL_CANDIDATE_NOT_FOUND: 404,
  DEAL_REVIEW_CONFLICT: 409,
  DEAL_NOT_ELIGIBLE_FOR_REVIEW_APPROVAL: 422,
  DEAL_REVIEW_FIELDS_REQUIRED: 400,
  DEAL_LIST_LIMIT_INVALID: 400,
});

/** BigInt cents and Date values are normalised so the payload stays JSON-safe. */
function serializeDeal(deal: DealCandidate) {
  return {
    id: deal.id,
    providerId: deal.providerId,
    externalId: deal.externalId,
    title: deal.title,
    productUrl: deal.productUrl,
    currency: deal.currency,
    purchasePriceMinor: deal.purchasePriceMinor.toString(),
    totalCostCents: deal.totalCostCents.toString(),
    expectedProfitCents: deal.expectedProfitCents.toString(),
    roiBasisPoints: deal.roiBasisPoints === null ? null : deal.roiBasisPoints.toString(),
    observedAt: deal.observedAt.toISOString(),
    simulated: deal.simulated,
    riskPassed: deal.riskPassed,
    riskReasons: deal.riskReasons,
    reviewStatus: deal.reviewStatus,
    reviewedBy: deal.reviewedBy,
    reviewedAt: deal.reviewedAt?.toISOString() ?? null,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "INTERNAL_ERROR";
}

export async function buildServer(dependencies: ServerDependencies): Promise<FastifyInstance> {
  const { prisma } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    requestIdHeader: "x-request-id",
    bodyLimit: 16 * 1024,
    trustProxy: false,
  });
  const authRateBuckets = new Map<string, { windowStartedAt: number; count: number }>();

  function authRateLimit(request: FastifyRequest, reply: FastifyReply): boolean {
    const timestamp = now().getTime();
    const key = `${request.ip}:${request.routeOptions.url ?? request.url.split("?")[0]}`;
    let bucket = authRateBuckets.get(key);
    if (!bucket || timestamp - bucket.windowStartedAt >= AUTH_RATE_WINDOW_MS) {
      if (authRateBuckets.size >= AUTH_RATE_BUCKET_LIMIT) {
        for (const [candidate, value] of authRateBuckets) {
          if (timestamp - value.windowStartedAt >= AUTH_RATE_WINDOW_MS) authRateBuckets.delete(candidate);
        }
      }
      if (authRateBuckets.size >= AUTH_RATE_BUCKET_LIMIT) {
        reply.header("Retry-After", "60").code(429).send({ error: "AUTH_RATE_LIMITED" });
        return false;
      }
      bucket = { windowStartedAt: timestamp, count: 0 };
      authRateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > AUTH_RATE_MAX) {
      const retrySeconds = Math.max(1, Math.ceil((AUTH_RATE_WINDOW_MS - (timestamp - bucket.windowStartedAt)) / 1000));
      reply.header("Retry-After", String(retrySeconds)).code(429).send({ error: "AUTH_RATE_LIMITED" });
      return false;
    }
    return true;
  }

  await app.register(helmet);
  await app.register(cors, { origin: false });

  function signingSecret(): string {
    if (!dependencies.authSigningSecret) throw new Error("AUTH_SIGNING_SECRET_NOT_CONFIGURED");
    return dependencies.authSigningSecret;
  }

  function fail(reply: FastifyReply, error: unknown) {
    const code = errorCode(error);
    const status = STATUS_BY_ERROR[code];
    if (status === undefined) {
      reply.log.error({ err: error }, "unhandled route error");
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
    return reply.code(status).send({ error: code });
  }

  async function principalFrom(request: FastifyRequest): Promise<AuthenticatedPrincipal> {
    return await authenticateBearerToken(
      prisma,
      request.headers.authorization,
      dependencies.authSigningSecret,
      Math.floor(now().getTime() / 1000),
    );
  }

  app.get("/health", async () => ({
    status: "ok",
    service: "autonomagent-api",
    tradingMode: config.tradingMode,
    liveTradingEnabled: config.liveTradingEnabled,
    testnetEnabled: config.testnetEnabled,
    emergencyStop: config.emergencyStop,
    tradingReady: false,
    note: "Health only. Trading endpoints are not implemented.",
  }));

  app.post("/v1/auth/login", async (request, reply) => {
    if (!authRateLimit(request, reply)) return;
    const body = request.body as { email?: unknown; password?: unknown } | undefined;
    if (typeof body?.email !== "string" || !body.email.trim() || body.email.length > 254 || typeof body.password !== "string" || Buffer.byteLength(body.password, "utf8") > 128) {
      return reply.code(400).send({ error: "LOGIN_FIELDS_REQUIRED" });
    }
    try {
      const tokens = await loginWithPassword(
        prisma,
        { email: body.email, password: body.password },
        signingSecret(),
        now(),
      );
      return reply.code(200).send(tokens);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    if (!authRateLimit(request, reply)) return;
    const body = request.body as { refreshToken?: unknown } | undefined;
    if (typeof body?.refreshToken !== "string" || !body.refreshToken || body.refreshToken.length > 256) {
      return reply.code(400).send({ error: "REFRESH_TOKEN_REQUIRED" });
    }
    try {
      const tokens = await rotateRefreshToken(prisma, body.refreshToken, signingSecret(), now());
      return reply.code(200).send(tokens);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    if (!authRateLimit(request, reply)) return;
    const body = request.body as { refreshToken?: unknown } | undefined;
    if (typeof body?.refreshToken !== "string" || !body.refreshToken || body.refreshToken.length > 256) {
      return reply.code(400).send({ error: "REFRESH_TOKEN_REQUIRED" });
    }
    try {
      await revokeRefreshToken(prisma, body.refreshToken, now());
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/v1/deals", async (request, reply) => {
    try {
      await principalFrom(request);
      const query = request.query as Record<string, unknown>;
      const reviewStatus = query.reviewStatus;
      if (reviewStatus !== undefined && !REVIEW_STATUSES.includes(reviewStatus as never)) {
        return reply.code(400).send({ error: "DEAL_REVIEW_STATUS_INVALID" });
      }
      let riskPassed: boolean | undefined;
      if (query.riskPassed !== undefined) {
        if (query.riskPassed !== "true" && query.riskPassed !== "false") {
          return reply.code(400).send({ error: "DEAL_RISK_FILTER_INVALID" });
        }
        riskPassed = query.riskPassed === "true";
      }
      let limit: number | undefined;
      if (query.limit !== undefined) {
        const parsed = Number(query.limit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DEAL_LIMIT) {
          return reply.code(400).send({ error: "DEAL_LIST_LIMIT_INVALID" });
        }
        limit = parsed;
      }
      const deals = await listDealCandidates(prisma, {
        ...(reviewStatus === undefined ? {} : { reviewStatus: reviewStatus as (typeof REVIEW_STATUSES)[number] }),
        ...(riskPassed === undefined ? {} : { riskPassed }),
        ...(limit === undefined ? {} : { limit }),
      });
      return reply.code(200).send({ deals: deals.map(serializeDeal) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/v1/deals/:dealId/review", async (request, reply) => {
    try {
      const principal = await principalFrom(request);
      requireAdmin(principal);
      const { dealId } = request.params as { dealId: string };
      const body = request.body as { decision?: unknown } | undefined;
      if (typeof body?.decision !== "string" || !REVIEW_DECISIONS.includes(body.decision as ReviewDecision)) {
        return reply.code(400).send({ error: "DEAL_REVIEW_DECISION_INVALID" });
      }
      const reviewed = await reviewDealCandidate(prisma, {
        dealId,
        reviewerId: principal.userId,
        decision: body.decision as ReviewDecision,
      });
      return reply.code(200).send({ deal: serializeDeal(reviewed) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/v1/operations/overview", async (_request, reply) => {
    return reply.code(503).send({
      error: "BACKEND_NOT_READY",
      message: "Operations data is unavailable until authenticated sessions are configured.",
    });
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: "NOT_FOUND" });
  });

  return app;
}
