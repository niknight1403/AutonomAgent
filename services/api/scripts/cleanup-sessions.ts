import { PrismaClient } from "@prisma/client";
import { cleanupRefreshSessions } from "../src/session-maintenance.js";

const prisma = new PrismaClient();

try {
  let totalDeleted = 0;
  while (true) {
    const batch = await cleanupRefreshSessions(prisma, { batchSize: 500 });
    totalDeleted += batch.deleted;
    if (batch.deleted < 500) break;
  }
  process.stdout.write(JSON.stringify({ status: "completed", deleted: totalDeleted }) + "\n");
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : "SESSION_CLEANUP_FAILED") + "\n");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
