import type { Prisma, PrismaClient } from "@prisma/client";

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  outcome: "SUCCESS" | "FAILURE";
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes structured audit metadata. Callers must never pass passwords, bearer
 * tokens, refresh tokens, API keys, or other credentials in metadata.
 * Database permissions should deny UPDATE/DELETE on SecurityAuditEvent.
 */
export async function writeAuditEvent(
  prisma: PrismaClient,
  input: AuditEventInput,
): Promise<void> {
  if (!/^[A-Z][A-Z0-9_.-]{1,95}$/.test(input.action)) {
    throw new Error("AUDIT_ACTION_INVALID");
  }
  if (!input.outcome) throw new Error("AUDIT_OUTCOME_REQUIRED");
  await prisma.securityAuditEvent.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      requestId: input.requestId ?? null,
      outcome: input.outcome,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}

export interface AuditListOptions {
  before?: Date;
  limit?: number;
}

export async function listAuditEvents(
  prisma: PrismaClient,
  options: AuditListOptions = {},
) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("AUDIT_LIST_LIMIT_INVALID");
  }
  return prisma.securityAuditEvent.findMany({
    ...(options.before ? { where: { createdAt: { lt: options.before } } } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}
