import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AuthRateLimiter {
  consume(key: string, nowMs: number): Promise<RateLimitDecision>;
}

/** Local-only limiter for unit tests and development. */
export class InMemoryAuthRateLimiter implements AuthRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();
  constructor(
    private readonly windowMs = 60_000,
    private readonly maximum = 5,
    private readonly maximumBuckets = 10_000,
  ) {}

  async consume(key: string, nowMs: number): Promise<RateLimitDecision> {
    let bucket = this.buckets.get(key);
    if (!bucket || nowMs - bucket.startedAt >= this.windowMs) {
      if (this.buckets.size >= this.maximumBuckets) {
        for (const [candidate, value] of this.buckets) {
          if (nowMs - value.startedAt >= this.windowMs) this.buckets.delete(candidate);
        }
      }
      if (this.buckets.size >= this.maximumBuckets) return { allowed: false, retryAfterSeconds: 60 };
      bucket = { startedAt: nowMs, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(1, Math.ceil((this.windowMs - (nowMs - bucket.startedAt)) / 1000));
    return { allowed: bucket.count <= this.maximum, retryAfterSeconds: remaining };
  }
}

/**
 * Shared fixed-window rate limiter. PostgreSQL's ON CONFLICT update serializes
 * increments for each hashed key, so concurrent API instances cannot bypass
 * the per-client limit. Raw client identifiers are never persisted.
 */
export class PostgresAuthRateLimiter implements AuthRateLimiter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly windowMs = 60_000,
    private readonly maximum = 5,
  ) {}

  async consume(key: string, nowMs: number): Promise<RateLimitDecision> {
    const digest = createHash("sha256").update(key).digest("hex");
    const now = new Date(nowMs);
    const windowStartCutoff = new Date(nowMs - this.windowMs);
    const rows = await this.prisma.$queryRaw<Array<{ count: number; windowStartedAt: Date }>>(Prisma.sql`
      INSERT INTO "AuthRateLimitBucket" ("key", "windowStartedAt", "count", "updatedAt")
      VALUES (${digest}, ${now}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "AuthRateLimitBucket"."windowStartedAt" <= ${windowStartCutoff} THEN 1
          ELSE "AuthRateLimitBucket"."count" + 1
        END,
        "windowStartedAt" = CASE
          WHEN "AuthRateLimitBucket"."windowStartedAt" <= ${windowStartCutoff} THEN EXCLUDED."windowStartedAt"
          ELSE "AuthRateLimitBucket"."windowStartedAt"
        END,
        "updatedAt" = NOW()
      RETURNING "count", "windowStartedAt"
    `);
    const row = rows[0];
    if (!row || !Number.isSafeInteger(row.count)) throw new Error("AUTH_RATE_LIMIT_DATABASE_INVALID_RESPONSE");
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((row.windowStartedAt.getTime() + this.windowMs - nowMs) / 1000),
    );
    return { allowed: row.count <= this.maximum, retryAfterSeconds };
  }
}
