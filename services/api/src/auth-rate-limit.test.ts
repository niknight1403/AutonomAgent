import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { InMemoryAuthRateLimiter, PostgresAuthRateLimiter } from "./auth-rate-limit.js";

describe("authentication rate limiter", () => {
  it("enforces a fixed window and resets after expiry in memory", async () => {
    const limiter = new InMemoryAuthRateLimiter(60_000, 2);
    await expect(limiter.consume("client", 1_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("client", 2_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("client", 3_000)).resolves.toMatchObject({ allowed: false });
    await expect(limiter.consume("client", 61_001)).resolves.toMatchObject({ allowed: true });
  });

  it("uses one atomic SQL upsert and persists only a hash of the client key", async () => {
    const query = vi.fn().mockResolvedValue([{ count: 6, windowStartedAt: new Date(10_000) }]);
    const prisma = { $queryRaw: query } as unknown as PrismaClient;
    const limiter = new PostgresAuthRateLimiter(prisma, 60_000, 5);
    await expect(limiter.consume("192.0.2.1:/v1/auth/login", 20_000))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 50 });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0]?.[0] as { sql?: string; values?: unknown[] };
    expect(sql.sql?.join(" ")).toContain("ON CONFLICT");
    expect(sql.sql?.join(" ")).toContain("RETURNING");
    expect(JSON.stringify(sql.values)).not.toContain("192.0.2.1");
  });

  it("fails closed when the database query fails", async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error("offline")) } as unknown as PrismaClient;
    const limiter = new PostgresAuthRateLimiter(prisma);
    await expect(limiter.consume("client", 0)).rejects.toThrow("offline");
  });
});
