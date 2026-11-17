import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo-only trading configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to PAPER with live trading disabled", async () => {
    vi.stubEnv("TRADING_MODE", "PAPER");
    vi.stubEnv("LIVE_TRADING_ENABLED", "false");
    vi.stubEnv("EMERGENCY_STOP", "true");

    const { config } = await import("./config.js");
    expect(config.tradingMode).toBe("PAPER");
    expect(config.liveTradingEnabled).toBe(false);
  });

  it("rejects LIVE mode even when the old opt-in flags are set", async () => {
    vi.stubEnv("TRADING_MODE", "LIVE");
    vi.stubEnv("LIVE_TRADING_ENABLED", "true");
    vi.stubEnv("EMERGENCY_STOP", "false");

    await expect(import("./config.js")).rejects.toThrow("LIVE trading is disabled");
  });

  it("rejects an attempt to enable LIVE while mode remains PAPER", async () => {
    vi.stubEnv("TRADING_MODE", "PAPER");
    vi.stubEnv("LIVE_TRADING_ENABLED", "true");
    vi.stubEnv("EMERGENCY_STOP", "true");

    await expect(import("./config.js")).rejects.toThrow("LIVE trading is disabled");
  });
});
