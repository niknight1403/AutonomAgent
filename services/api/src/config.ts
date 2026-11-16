const allowedModes = ["PAPER", "LIVE"] as const;
export type TradingMode = (typeof allowedModes)[number];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Expected boolean environment value");
}

const mode = process.env.TRADING_MODE ?? "PAPER";
if (!allowedModes.includes(mode as TradingMode)) throw new Error("Invalid TRADING_MODE");

export const config = Object.freeze({
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8080),
  tradingMode: mode as TradingMode,
  liveTradingEnabled: parseBoolean(process.env.LIVE_TRADING_ENABLED, false),
  emergencyStop: parseBoolean(process.env.EMERGENCY_STOP, true),
});

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}
if (config.tradingMode === "LIVE" && (!config.liveTradingEnabled || config.emergencyStop)) {
  throw new Error("Live mode cannot start unless explicitly enabled and emergency stop is released");
}
