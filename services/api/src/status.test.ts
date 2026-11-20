import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildServer } from "./app.js";
import { ProviderRegistry } from "./providers/registry.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health and status endpoints", () => {
  it("reports liveness separately from connected database and configured integrations", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-brave-key");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) } as unknown as PrismaClient;
    const app = await buildServer({ prisma, providers: new ProviderRegistry() });

    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: "ok", liveTradingEnabled: false });

      const status = await app.inject({ method: "GET", url: "/api/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        state: "HEALTHY",
        database: { state: "CONNECTED" },
        workers: { active: 0, state: "NOT_RUNNING" },
        integrations: { braveSearch: true, stripe: false },
        liveTradingEnabled: false,
      });
      expect(JSON.stringify(status.json())).not.toContain("test-brave-key");
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("reports degraded state without exposing database error details", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error("private connection string")),
    } as unknown as PrismaClient;
    const app = await buildServer({ prisma, providers: new ProviderRegistry() });

    try {
      const status = await app.inject({ method: "GET", url: "/api/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        state: "DEGRADED",
        database: { state: "DISCONNECTED" },
      });
      expect(JSON.stringify(status.json())).not.toContain("private connection string");
    } finally {
      await app.close();
    }
  });

  it("does not allow anonymous callers to consume the web-search integration", async () => {
    const prisma = { $queryRaw: vi.fn() } as unknown as PrismaClient;
    const webSearch = { search: vi.fn() };
    const app = await buildServer({
      prisma,
      authSigningSecret: "test-signing-secret-with-at-least-32-characters",
      providers: new ProviderRegistry(),
      webSearch,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/web-search",
        payload: { query: "usb ladegerät" },
      });
      expect(response.statusCode).toBe(401);
      expect(webSearch.search).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
