# API service boundary

The API is intentionally not wired to live marketplace providers yet.

## Implemented foundation

- Fastify health service with fail-closed configuration.
- Prisma schema for users, wallet accounts, immutable wallet ledger entries, idempotency keys, and outbox events.
- Wallet reservation/release service using a PostgreSQL row lock and Serializable transaction.
- Reservation references are unique; retries with the same reference and matching payload return the current snapshot.
- Vitest checks for integer-cent profit calculations, risk-limit decisions, and bounded worker backoff.
- PostgreSQL outbox worker with `SKIP LOCKED` leasing, expired-lease recovery, retry scheduling, and dead-letter state.
- Agent task lifecycle service with idempotent creation, compare-and-set worker claims, lease-bound checkpoints/completion/failure, and transactional outbox events.
- Bounded agent orchestrator with configurable concurrency, polling, per-claim fencing IDs, periodic lease heartbeats, and graceful AbortSignal shutdown.

## Important boundaries

Wallet functions are internal service primitives, not public routes. They must only be called after authenticated server-side authorization. A release reference must be distinct from its reservation reference. A production execution flow still needs to bind each reservation to an approved trade and enforce per-trade/category/provider limits.

Required before live trading:
- authenticated sessions and server-enforced RBAC;
- server-side secrets vault and provider-specific capability registry;
- complete double-entry accounting for deposits, purchases, fees, sales, payouts, and refunds;
- idempotent execution attempts, durable workers, transactional outbox;
- approval snapshots bound to current price, stock, fees, and expiry;
- server-side emergency stop and reconciliation for unknown order/payment states.

The mobile app must display a disconnected state until authenticated health and operations endpoints are available. Never infer a successful purchase from a request timeout.


## Local product demo boundary

The mobile product-discovery demo uses `packages/trading-core` local fixture data only. Its deterministic demo pipeline assesses illustrative prices, creates unposted listing drafts, and returns channel-fit recommendations with clearly illustrative reach ranges. It has no marketplace or advertising API client, does not persist catalog data, and cannot purchase, publish, approve, or enable live trading. It does not start the separate API outbox worker or agent orchestrator described above; the current API server starts only its health/operations routes. The API configuration hard-rejects `TRADING_MODE=LIVE` and `LIVE_TRADING_ENABLED=true`. Do not treat sample margins or reach spans as current prices, market demand, or measured performance.
