CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "requestId" TEXT,
    "outcome" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityAuditEvent_createdAt_idx" ON "SecurityAuditEvent"("createdAt");
CREATE INDEX "SecurityAuditEvent_actorUserId_createdAt_idx" ON "SecurityAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "SecurityAuditEvent_action_createdAt_idx" ON "SecurityAuditEvent"("action", "createdAt");
CREATE INDEX "SecurityAuditEvent_targetType_targetId_createdAt_idx" ON "SecurityAuditEvent"("targetType", "targetId", "createdAt");
