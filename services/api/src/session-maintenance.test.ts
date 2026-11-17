import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { cleanupRefreshSessions } from "./session-maintenance.js";

describe("refresh session cleanup", () => {
  it("deletes only the bounded set of expired or long-revoked sessions", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      refreshSession: { findMany, deleteMany },
    } as unknown as PrismaClient;
    const now = new Date("2026-11-17T12:00:00.000Z");

    await expect(cleanupRefreshSessions(prisma, { now, batchSize: 2 })).resolves.toEqual({ deleted: 2 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { revokedAt: { lte: new Date("2026-10-18T12:00:00.000Z") } },
        ],
      },
    }));
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } } });
  });

  it("does not issue a delete when there are no stale sessions", async () => {
    const deleteMany = vi.fn();
    const prisma = {
      refreshSession: { findMany: vi.fn().mockResolvedValue([]), deleteMany },
    } as unknown as PrismaClient;
    await expect(cleanupRefreshSessions(prisma)).resolves.toEqual({ deleted: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("rejects invalid or unbounded batch sizes", async () => {
    const prisma = {} as PrismaClient;
    await expect(cleanupRefreshSessions(prisma, { batchSize: 501 })).rejects.toThrow("SESSION_CLEANUP_BATCH_SIZE_INVALID");
  });
});
