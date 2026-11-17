import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/auth-session-service.js";

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_ADMIN_BOOTSTRAP !== "YES") {
    throw new Error("Set CONFIRM_ADMIN_BOOTSTRAP=YES to explicitly confirm ADMIN creation");
  }
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_BOOTSTRAP_EMAIL_INVALID");
  }
  if (!password) throw new Error("ADMIN_BOOTSTRAP_PASSWORD_REQUIRED");

  const passwordHash = await hashPassword(password);
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error("ADMIN_ACCOUNT_ALREADY_EXISTS");
    return tx.user.create({
      data: { email, passwordHash, role: UserRole.ADMIN },
      select: { id: true, email: true, role: true, createdAt: true },
    });
  }, { isolationLevel: "Serializable" });

  process.stdout.write(JSON.stringify({
    status: "created",
    userId: created.id,
    email: created.email,
    role: created.role,
    createdAt: created.createdAt.toISOString(),
  }) + "\n");
}

try {
  await main();
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : "ADMIN_BOOTSTRAP_FAILED") + "\n");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
