import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuthRateLimiter, RedisRestAuthRateLimiter } from "./auth-rate-limit.js";

afterEach(() => vi.unstubAllGlobals());

describe("authentication rate limiter", () => {
  it("enforces a fixed window and resets after expiry in memory", async () => {
    const limiter = new InMemoryAuthRateLimiter(60_000, 2);
    await expect(limiter.consume("client", 1_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("client", 2_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("client", 3_000)).resolves.toMatchObject({ allowed: false });
    await expect(limiter.consume("client", 61_001)).resolves.toMatchObject({ allowed: true });
  });

  it("uses a Redis atomic script and hashes the client key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [6, 42_000] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const limiter = new RedisRestAuthRateLimiter("https://redis.example.test", "secret");
    await expect(limiter.consume("192.0.2.1:/v1/auth/login", 123))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 42 });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.example.test");
    expect(String(options.body)).toContain("EVAL");
    expect(String(options.body)).not.toContain("192.0.2.1");
    expect(options.headers).toMatchObject({ authorization: "Bearer secret" });
  });

  it("fails closed when Redis is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const limiter = new RedisRestAuthRateLimiter("https://redis.example.test", "secret");
    await expect(limiter.consume("client", 0)).rejects.toThrow("AUTH_RATE_LIMIT_REDIS_UNAVAILABLE");
  });

  it("rejects insecure Redis REST endpoints", () => {
    expect(() => new RedisRestAuthRateLimiter("http://redis.example.test", "secret"))
      .toThrow("AUTH_RATE_LIMIT_REDIS_URL_MUST_USE_HTTPS");
  });
});
