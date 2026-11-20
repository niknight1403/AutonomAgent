import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { Prisma, type DealCandidate, type PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { authenticateBearerToken, requireAdmin, type AuthenticatedPrincipal } from "./auth-service.js";
import { loginWithPassword, revokeRefreshToken, rotateRefreshToken } from "./auth-session-service.js";
import { listDealCandidates, reviewDealCandidate } from "./deal-candidate-service.js";
import { listAuditEvents, writeAuditEvent } from "./audit-service.js";
import { InMemoryAuthRateLimiter, PostgresAuthRateLimiter } from "./auth-rate-limit.js";
import { runAndPersistDealScan } from "./deal-scan-service.js";
import { createConfiguredProviderRegistry } from "./providers/bootstrap.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { BraveSearchClient, type WebSearchPage } from "./providers/brave-search.js";
import { ProviderHttpError } from "./providers/http-client.js";


export interface ServerDependencies {
  prisma: PrismaClient;
  /** HS256 signing secret for access tokens; unset means the auth routes stay closed. */
  authSigningSecret?: string | undefined;
  now?: () => Date;
  providers?: ProviderRegistry;
  webSearch?: Pick<BraveSearchClient, "search">;
}

type ReviewDecision = "APPROVED" | "REJECTED" | "ARCHIVED";

const REVIEW_DECISIONS: readonly ReviewDecision[] = ["APPROVED", "REJECTED", "ARCHIVED"];
const REVIEW_STATUSES = ["DISCOVERED", "APPROVED", "REJECTED", "ARCHIVED"] as const;
const MAX_DEAL_LIMIT = 100;

const STATUS_BY_ERROR: Readonly<Record<string, number>> = Object.freeze({
  AUTH_SIGNING_SECRET_NOT_CONFIGURED: 503,
  AUTH_RATE_LIMIT_DATABASE_INVALID_RESPONSE: 503,
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
  AUDIT_LIST_LIMIT_INVALID: 400,
  AUDIT_CURSOR_INVALID: 400,
  DEAL_SCAN_INPUT_INVALID: 400,
  DEAL_PROVIDER_UNAVAILABLE: 503,
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
  const providers = dependencies.providers ?? createConfiguredProviderRegistry();
  const webSearch = dependencies.webSearch ?? (process.env.BRAVE_SEARCH_API_KEY?.trim()
    ? new BraveSearchClient(process.env.BRAVE_SEARCH_API_KEY.trim())
    : undefined);
  const now = dependencies.now ?? (() => new Date());
  const startedAtMs = Date.now();
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    requestIdHeader: "x-request-id",
    bodyLimit: 16 * 1024,
    trustProxy: false,
  });
  const rateLimiter = process.env.NODE_ENV === "test"
    ? new InMemoryAuthRateLimiter()
    : new PostgresAuthRateLimiter(prisma);

  async function authRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const key = `${request.ip}:${request.routeOptions.url ?? request.url.split("?")[0]}`;
    try {
      const decision = await rateLimiter.consume(key, now().getTime());
      if (!decision.allowed) {
        reply.header("Retry-After", String(decision.retryAfterSeconds)).code(429).send({ error: "AUTH_RATE_LIMITED" });
        return false;
      }
      return true;
    } catch (error) {
      request.log.error({ err: error }, "authentication rate limiter unavailable");
      reply.code(503).send({ error: "AUTH_RATE_LIMIT_DATABASE_INVALID_RESPONSE" });
      return false;
    }
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

  const healthResponse = () => ({
    status: "ok",
    service: "autonomagent-api",
    tradingMode: config.tradingMode,
    liveTradingEnabled: config.liveTradingEnabled,
    testnetEnabled: config.testnetEnabled,
    emergencyStop: config.emergencyStop,
    tradingReady: false,
    note: "Health only. Trading endpoints are not implemented.",
  });

  // Liveness endpoint: does not require database or provider availability.
  app.get("/health", async () => healthResponse());
  app.get("/api/health", async () => healthResponse());

  app.get("/api/status", async (_request, reply) => {
    const requestStartedAt = Date.now();
    let database: { state: "CONNECTED" | "DISCONNECTED"; latencyMs: number };
    const databaseStartedAt = Date.now();
    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      database = { state: "CONNECTED", latencyMs: Date.now() - databaseStartedAt };
    } catch {
      database = { state: "DISCONNECTED", latencyMs: Date.now() - databaseStartedAt };
    }

    const integrations = {
      braveSearch: Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
      stripe: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      digistore24: Boolean(process.env.DIGISTORE24_API_KEY?.trim()),
      hubspot: Boolean(process.env.HUBSPOT_ACCESS_TOKEN?.trim()),
    };
    const configuredProviders = providers.list().map((provider) => provider.providerId);
    const response = {
      state: database.state === "CONNECTED" ? "HEALTHY" : "DEGRADED",
      service: "autonomagent-api",
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      latencyMs: Date.now() - requestStartedAt,
      database,
      workers: { active: 0, state: "NOT_RUNNING" as const },
      integrations,
      configuredProviders,
      tradingMode: config.tradingMode,
      liveTradingEnabled: config.liveTradingEnabled,
      emergencyStop: config.emergencyStop,
    };
    return reply.code(200).send(response);
  });

  app.post("/v1/admin/web-search", async (request, reply) => {
    try {
      const principal = await principalFrom(request);
      requireAdmin(principal);
      if (!webSearch) return reply.code(503).send({ error: "BRAVE_SEARCH_NOT_CONFIGURED" });
      const body = request.body as Record<string, unknown> | undefined;
      const allowedFields = new Set(["query", "count", "offset"]);
      if (!body || Object.keys(body).some((key) => !allowedFields.has(key))) {
        return reply.code(400).send({ error: "WEB_SEARCH_INPUT_INVALID" });
      }
      if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 600 ||
          (body.count !== undefined && (typeof body.count !== "number" || !Number.isInteger(body.count) || body.count < 1 || body.count > 20)) ||
          (body.offset !== undefined && (typeof body.offset !== "number" || !Number.isInteger(body.offset) || body.offset < 0 || body.offset > 9))) {
        return reply.code(400).send({ error: "WEB_SEARCH_INPUT_INVALID" });
      }
      const result: WebSearchPage = await webSearch.search({
        query: body.query,
        ...(body.count === undefined ? {} : { count: body.count as number }),
        ...(body.offset === undefined ? {} : { offset: body.offset as number }),
      });
      await writeAuditEvent(prisma, {
        actorUserId: principal.userId,
        action: "WEB_SEARCH",
        outcome: "SUCCESS",
        requestId: request.id,
        metadata: { providerId: "brave-search", resultCount: result.results.length },
      });
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        if (error.status === 429) return reply.code(429).send({ error: "WEB_SEARCH_RATE_LIMITED" });
        return reply.code(502).send({ error: "WEB_SEARCH_PROVIDER_UNAVAILABLE" });
      }
      const code = errorCode(error);
      if (code === "WEB_SEARCH_QUERY_INVALID" || code === "WEB_SEARCH_COUNT_INVALID" || code === "WEB_SEARCH_OFFSET_INVALID") {
        return reply.code(400).send({ error: code });
      }
      return fail(reply, error);
    }
  });

  app.post("/v1/auth/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
    if (!(await authRateLimit(request, reply))) return;
    const body = request.body as { email?: unknown; password?: unknown } | undefined;
    if (!body || Object.keys(body).some((key) => key !== "email" && key !== "password") || typeof body.email !== "string" || !body.email.trim() || body.email.length > 254 || typeof body.password !== "string" || Buffer.byteLength(body.password, "utf8") > 128) {
      return reply.code(400).send({ error: "LOGIN_FIELDS_REQUIRED" });
    }
    try {
      const tokens = await loginWithPassword(
        prisma,
        { email: body.email, password: body.password },
        signingSecret(),
        now(),
      );
      try {
        await writeAuditEvent(prisma, {
          action: "AUTH_LOGIN",
          outcome: "SUCCESS",
          requestId: request.id,
          metadata: { emailDomain: body.email.split("@").at(-1)?.toLowerCase() ?? "unknown" },
        });
      } catch (auditError) {
        await revokeRefreshToken(prisma, tokens.refreshToken, now());
        throw auditError;
      }
      return reply.code(200).send(tokens);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
        try {
          await writeAuditEvent(prisma, {
            action: "AUTH_LOGIN",
            outcome: "FAILURE",
            requestId: request.id,
          });
        } catch (auditError) {
          request.log.error({ err: auditError }, "failed to record authentication audit event");
        }
      }
      return fail(reply, error);
    }
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
    if (!(await authRateLimit(request, reply))) return;
    const body = request.body as { refreshToken?: unknown } | undefined;
    if (!body || Object.keys(body).some((key) => key !== "refreshToken") || typeof body.refreshToken !== "string" || !body.refreshToken || body.refreshToken.length > 256) {
      return reply.code(400).send({ error: "REFRESH_TOKEN_REQUIRED" });
    }
    try {
      const tokens = await rotateRefreshToken(prisma, body.refreshToken, signingSecret(), now());
      try {
        await writeAuditEvent(prisma, {
          action: "AUTH_REFRESH",
          outcome: "SUCCESS",
          requestId: request.id,
        });
      } catch (auditError) {
        await revokeRefreshToken(prisma, tokens.refreshToken, now());
        throw auditError;
      }
      return reply.code(200).send(tokens);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
    if (!(await authRateLimit(request, reply))) return;
    const body = request.body as { refreshToken?: unknown } | undefined;
    if (!body || Object.keys(body).some((key) => key !== "refreshToken") || typeof body.refreshToken !== "string" || !body.refreshToken || body.refreshToken.length > 256) {
      return reply.code(400).send({ error: "REFRESH_TOKEN_REQUIRED" });
    }
    try {
      await revokeRefreshToken(prisma, body.refreshToken, now());
      await writeAuditEvent(prisma, {
        action: "AUTH_LOGOUT",
        outcome: "SUCCESS",
        requestId: request.id,
      });
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

  app.get("/v1/admin/providers", async (request, reply) => {
    try {
      const principal = await principalFrom(request);
      requireAdmin(principal);
      return reply.code(200).send({
        providers: providers.list().map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          capabilities: provider.capabilities,
          simulated: provider.simulated,
        })),
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/v1/admin/deals/scan", async (request, reply) => {
    try {
      const principal = await principalFrom(request);
      requireAdmin(principal);
      const body = request.body as Record<string, unknown> | undefined;
      const allowed = new Set([
        "providerId", "query", "limit", "resalePriceCents", "costs",
        "openTrades", "dailyLossCents", "riskLimits",
      ]);
      if (!body || Object.keys(body).some((key) => !allowed.has(key))) {
        return reply.code(400).send({ error: "DEAL_SCAN_INPUT_INVALID" });
      }
      const parseCents = (value: unknown): bigint | null => {
        if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) return null;
        try { return BigInt(value); } catch { return null; }
      };
      const costsInput = body.costs as Record<string, unknown> | undefined;
      const costKeys = [
        "inboundShippingCents", "outboundShippingCents", "marketplaceFeeCents",
        "paymentFeeCents", "packagingCents", "riskReserveCents",
      ] as const;
      if (
        typeof body.providerId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(body.providerId) ||
        typeof body.query !== "string" || !body.query.trim() || body.query.length > 200 ||
        !Number.isInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 50 ||
        typeof body.openTrades !== "number" || !Number.isInteger(body.openTrades) || body.openTrades < 0 ||
        parseCents(body.resalePriceCents) === null || parseCents(body.dailyLossCents) === null ||
        !costsInput || Object.keys(costsInput).length !== costKeys.length ||
        costKeys.some((key) => parseCents(costsInput[key]) === null)
      ) {
        return reply.code(400).send({ error: "DEAL_SCAN_INPUT_INVALID" });
      }
      const risk = body.riskLimits as Record<string, unknown> | undefined;
      const riskKeys = ["maxTradeCents", "maxOpenTrades", "maxDailyLossCents", "minProfitCents", "minRoiBasisPoints"] as const;
      if (!risk || Object.keys(risk).length !== riskKeys.length ||
          riskKeys.some((key) => key.endsWith("Cents") || key === "minRoiBasisPoints" ? parseCents(risk[key]) === null : typeof risk[key] !== "number" || !Number.isInteger(risk[key]) || Number(risk[key]) < 1 || Number(risk[key]) > 1_000)) {
        return reply.code(400).send({ error: "DEAL_SCAN_INPUT_INVALID" });
      }

      const result = await runAndPersistDealScan({ prisma, providers }, {
        providerId: body.providerId as string,
        query: body.query as string,
        limit: Number(body.limit),
        currency: "EUR",
        costs: {
          inboundShippingCents: parseCents(costsInput.inboundShippingCents)!,
          outboundShippingCents: parseCents(costsInput.outboundShippingCents)!,
          marketplaceFeeCents: parseCents(costsInput.marketplaceFeeCents)!,
          paymentFeeCents: parseCents(costsInput.paymentFeeCents)!,
          packagingCents: parseCents(costsInput.packagingCents)!,
          riskReserveCents: parseCents(costsInput.riskReserveCents)!,
        },
        context: {
          resalePriceCents: parseCents(body.resalePriceCents)!,
          openTrades: Number(body.openTrades),
          dailyLossCents: parseCents(body.dailyLossCents)!,
          riskLimits: {
            maxTradeCents: parseCents(risk.maxTradeCents)!,
            maxOpenTrades: Number(risk.maxOpenTrades),
            maxDailyLossCents: parseCents(risk.maxDailyLossCents)!,
            minProfitCents: parseCents(risk.minProfitCents)!,
            minRoiBasisPoints: parseCents(risk.minRoiBasisPoints)!,
          },
        },
      });
      await writeAuditEvent(prisma, {
        actorUserId: principal.userId,
        action: "DEAL_SCAN",
        outcome: "SUCCESS",
        requestId: request.id,
        metadata: {
          providerId: result.providerId,
          providerSimulated: result.providerSimulated,
          scannedCount: result.scannedCount,
          persistedCount: result.persistedCount,
          riskPassedCount: result.riskPassedCount,
          simulatedCount: result.simulatedCount,
        },
      });
      return reply.code(200).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("not registered") || message.includes("does not support")) {
        return reply.code(503).send({ error: "DEAL_PROVIDER_UNAVAILABLE" });
      }
      return fail(reply, error);
    }
  });

  app.get("/v1/admin/audit", async (request, reply) => {
    try {
      const principal = await principalFrom(request);
      requireAdmin(principal);
      const query = request.query as Record<string, unknown>;
      let limit: number | undefined;
      if (query.limit !== undefined) {
        const parsed = Number(query.limit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          return reply.code(400).send({ error: "AUDIT_LIST_LIMIT_INVALID" });
        }
        limit = parsed;
      }
      let before: Date | undefined;
      if (query.before !== undefined) {
        if (typeof query.before !== "string" || !Number.isFinite(Date.parse(query.before))) {
          return reply.code(400).send({ error: "AUDIT_CURSOR_INVALID" });
        }
        before = new Date(query.before);
      }
      const events = await listAuditEvents(prisma, {
        ...(limit === undefined ? {} : { limit }),
        ...(before === undefined ? {} : { before }),
      });
      return reply.code(200).send({
        events: events.map((event) => ({
          id: event.id,
          actorUserId: event.actorUserId,
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          requestId: event.requestId,
          outcome: event.outcome,
          metadata: event.metadata,
          createdAt: event.createdAt.toISOString(),
        })),
      });
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
      if (!body || Object.keys(body).some((key) => key !== "decision") || typeof body.decision !== "string" || !REVIEW_DECISIONS.includes(body.decision as ReviewDecision)) {
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
