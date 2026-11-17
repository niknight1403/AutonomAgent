import { createHash } from "node:crypto";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AuthRateLimiter {
  consume(key: string, nowMs: number): Promise<RateLimitDecision>;
}

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

/** Atomic fixed-window limiter using the Upstash Redis REST EVAL endpoint. */
export class RedisRestAuthRateLimiter implements AuthRateLimiter {
  private static readonly SCRIPT =
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; local ttl=redis.call('PTTL',KEYS[1]); return {n,ttl}";
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly windowMs = 60_000,
    private readonly maximum = 5,
    private readonly requestTimeoutMs = 2_000,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("AUTH_RATE_LIMIT_REDIS_URL_MUST_USE_HTTPS");
    if (!token.trim()) throw new Error("AUTH_RATE_LIMIT_REDIS_TOKEN_REQUIRED");
  }

  async consume(key: string, _nowMs: number): Promise<RateLimitDecision> {
    const digest = createHash("sha256").update(key).digest("hex");
    const redisKey = `autonomagent:auth-rate:${digest}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(["EVAL", RedisRestAuthRateLimiter.SCRIPT, "1", redisKey, String(this.windowMs)]),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("AUTH_RATE_LIMIT_REDIS_UNAVAILABLE");
      const payload = await response.json() as { result?: unknown; error?: unknown };
      if (payload.error || !Array.isArray(payload.result) || payload.result.length !== 2) {
        throw new Error("AUTH_RATE_LIMIT_REDIS_INVALID_RESPONSE");
      }
      const count = Number(payload.result[0]);
      const ttlMs = Number(payload.result[1]);
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs)) {
        throw new Error("AUTH_RATE_LIMIT_REDIS_INVALID_RESPONSE");
      }
      return {
        allowed: count <= this.maximum,
        retryAfterSeconds: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000)),
      };
    } catch {
      throw new Error("AUTH_RATE_LIMIT_REDIS_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}
