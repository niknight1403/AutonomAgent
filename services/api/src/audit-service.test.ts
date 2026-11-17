import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { listAuditEvents, writeAuditEvent } from "./audit-service.js";

describe("security audit service", () => {
  it("writes structured events without accepting credentials as dedicated fields", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { securityAuditEvent: { create } } as unknown as PrismaClient;
    await writeAuditEvent(prisma, {
      actorUserId: "admin-1",
      action: "DEAL_REVIEW",
      targetType: "DealCandidate",
      targetId: "deal-1",
      requestId: "req-1",
      outcome: "SUCCESS",
      metadata: { decision: "APPROVED" },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "admin-1",
        action: "DEAL_REVIEW",
        targetId: "deal-1",
        outcome: "SUCCESS",
        metadata: { decision: "APPROVED" },
      }),
    });
  });

  it("rejects malformed action names", async () => {
    const prisma = { securityAuditEvent: { create: vi.fn() } } as unknown as PrismaClient;
    await expect(writeAuditEvent(prisma, { action: "bad action", outcome: "FAILURE" }))
      .rejects.toThrow("AUDIT_ACTION_INVALID");
  });

  it("bounds and orders audit queries", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { securityAuditEvent: { findMany } } as unknown as PrismaClient;
    const before = new Date("2026-11-17T00:00:00.000Z");
    await expect(listAuditEvents(prisma, { before, limit: 20 })).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: before } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    await expect(listAuditEvents(prisma, { limit: 101 })).rejects.toThrow("AUDIT_LIST_LIMIT_INVALID");
  });
});
