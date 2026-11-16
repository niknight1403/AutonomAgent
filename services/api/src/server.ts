import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { config } from "./config.js";

const app = Fastify({ logger: true, requestIdHeader: "x-request-id" });

await app.register(helmet);
await app.register(cors, { origin: false });

app.get("/health", async () => ({
  status: "ok",
  service: "autonomagent-api",
  tradingMode: config.tradingMode,
  liveTradingEnabled: config.liveTradingEnabled,
  emergencyStop: config.emergencyStop,
  tradingReady: false,
  note: "Health only. Trading endpoints are not implemented.",
}));

app.get("/v1/operations/overview", async (_request, reply) => {
  return reply.code(503).send({
    error: "BACKEND_NOT_READY",
    message: "Operations data is unavailable until persistence and authenticated sessions are configured.",
  });
});

app.setNotFoundHandler(async (_request, reply) => {
  return reply.code(404).send({ error: "NOT_FOUND" });
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
