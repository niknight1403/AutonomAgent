import type { PrismaClient } from "@prisma/client";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes only expired sessions or revoked sessions older than the retention
 * window. The bounded ID selection avoids an unbounded delete on busy tables.
 * Schedule this from a trusted maintenance worker; it is not an HTTP route.
 */
export async function cleanupRefreshSessions(
  prisma: PrismaClient,
  options: { now?: Date; batchSize?: number } = {},
): Promise<{ deleted: number }> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("SESSION_CLEANUP_BATCH_SIZE_INVALID");
  }
  const revokedBefore = new Date(now.getTime() - REVOKED_RETENTION_MS);
  const stale = await prisma.refreshSession.findMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { revokedAt: { lte: revokedBefore } },
      ],
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: batchSize,
  });
  if (stale.length === 0) return { deleted: 0 };
  const result = await prisma.refreshSession.deleteMany({
    where: { id: { in: stale.map((session) => session.id) } },
  });
  return { deleted: result.count };
}
