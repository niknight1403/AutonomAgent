import { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
type JsonObject = Prisma.InputJsonObject;

export type CreateTaskInput = {
  ownerId: string;
  taskType: string;
  input: JsonObject;
  idempotencyKey: string;
  correlationId?: string;
  maxAttempts?: number;
};

async function emit(db: Db, eventType: string, taskId: string, correlationId: string | undefined, payload: JsonObject) {
  await db.outboxEvent.create({
    data: { eventType, aggregateId: taskId, correlationId, payload, schemaVersion: 1 },
  });
}

export async function createAgentTask(prisma: PrismaClient, input: CreateTaskInput) {
  if (!input.ownerId.trim() || !input.taskType.trim() || !input.idempotencyKey.trim()) {
    throw new Error("TASK_REQUIRED_FIELDS_MISSING");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("INVALID_MAX_ATTEMPTS");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.agentTask.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.ownerId !== input.ownerId || existing.taskType !== input.taskType ||
          JSON.stringify(existing.input) !== JSON.stringify(input.input)) {
        throw new Error("TASK_IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }
    const task = await tx.agentTask.create({
      data: {
        ownerId: input.ownerId, taskType: input.taskType, input: input.input,
        idempotencyKey: input.idempotencyKey, correlationId: input.correlationId,
        maxAttempts,
      },
    });
    await emit(tx, "agent.task.created", task.id, input.correlationId, {
      taskId: task.id, taskType: task.taskType, ownerId: task.ownerId,
    });
    return task;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Compare-and-set claim. A crashed worker's expired lease can be reclaimed. */
export async function claimAgentTask(prisma: PrismaClient, taskId: string, workerId: string, leaseSeconds = 90) {
  if (!workerId.trim()) throw new Error("WORKER_ID_REQUIRED");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 3600) {
    throw new Error("INVALID_LEASE_SECONDS");
  }
  return prisma.$transaction(async (tx) => {
    const task = await tx.agentTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (task.attempt >= task.maxAttempts) throw new Error("TASK_ATTEMPTS_EXHAUSTED");
    const eligible = task.status === "QUEUED" || task.status === "CHECKPOINTED" ||
      (task.status === "RUNNING" && task.leaseUntil !== null && task.leaseUntil < new Date());
    if (!eligible) throw new Error("TASK_NOT_CLAIMABLE");
    const claimed = await tx.agentTask.updateMany({
      where: { id: taskId, status: task.status, attempt: task.attempt },
      data: {
        status: "RUNNING", attempt: { increment: 1 }, lockedBy: workerId,
        leaseUntil: new Date(Date.now() + leaseSeconds * 1000),
        startedAt: task.startedAt ?? new Date(), lastError: null,
      },
    });
    if (claimed.count !== 1) throw new Error("TASK_CLAIM_CONFLICT");
    const updated = await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    await emit(tx, "agent.task.started", taskId, task.correlationId ?? undefined, {
      taskId, workerId, attempt: updated.attempt,
    });
    return updated;
  });
}

export async function saveTaskCheckpoint(
  prisma: PrismaClient, taskId: string, workerId: string, checkpoint: JsonObject,
) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.agentTask.updateMany({
      where: { id: taskId, status: "RUNNING", lockedBy: workerId, leaseUntil: { gt: new Date() } },
      data: { status: "CHECKPOINTED", checkpoint, lockedBy: null, leaseUntil: null },
    });
    if (changed.count !== 1) throw new Error("TASK_LEASE_LOST");
    const task = await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    await emit(tx, "agent.task.checkpointed", taskId, task.correlationId ?? undefined, { taskId });
    return task;
  });
}

export async function completeAgentTask(
  prisma: PrismaClient, taskId: string, workerId: string, result: JsonObject,
) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.agentTask.updateMany({
      where: { id: taskId, status: "RUNNING", lockedBy: workerId, leaseUntil: { gt: new Date() } },
      data: { status: "SUCCEEDED", result, lockedBy: null, leaseUntil: null, finishedAt: new Date() },
    });
    if (changed.count !== 1) throw new Error("TASK_LEASE_LOST");
    const task = await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    await emit(tx, "agent.task.succeeded", taskId, task.correlationId ?? undefined, { taskId });
    return task;
  });
}

export async function failAgentTask(prisma: PrismaClient, taskId: string, workerId: string, error: unknown) {
  return prisma.$transaction(async (tx) => {
    const detail = (error instanceof Error ? error.message : "Unknown task error").slice(0, 2000);
    const changed = await tx.agentTask.updateMany({
      where: { id: taskId, status: "RUNNING", lockedBy: workerId },
      data: { status: "FAILED", lastError: detail, lockedBy: null, leaseUntil: null, finishedAt: new Date() },
    });
    if (changed.count !== 1) throw new Error("TASK_LEASE_LOST");
    const task = await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    await emit(tx, "agent.task.failed", taskId, task.correlationId ?? undefined, { taskId, error: detail });
    return task;
  });
}

/** Cancellation is an internal privileged operation; expose it only behind server-side RBAC. */
export async function cancelAgentTask(prisma: PrismaClient, taskId: string, ownerId: string) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.agentTask.updateMany({
      where: { id: taskId, ownerId, status: { in: ["QUEUED", "CHECKPOINTED"] } },
      data: { status: "CANCELLED", finishedAt: new Date(), lockedBy: null, leaseUntil: null },
    });
    if (changed.count !== 1) throw new Error("TASK_NOT_CANCELLABLE");
    const task = await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } });
    await emit(tx, "agent.task.cancelled", taskId, task.correlationId ?? undefined, { taskId });
    return task;
  });
}
