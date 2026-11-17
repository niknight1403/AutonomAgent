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

## Provider adapter boundary

The API now has a typed provider contract and an explicit capability registry for product search, price lookup, and stock lookup. Registration rejects duplicate or malformed provider IDs, duplicate capabilities, and capabilities without matching adapter methods. Callers must request an adapter through `getForCapability`; merely registering a provider does not grant additional capabilities.

A reusable circuit breaker protects calls in one API process. It opens after a configurable failure threshold, rejects requests while open, permits one probe after cooldown, and closes again after a successful probe. Its state is in-memory and is not coordinated across replicas; production multi-instance deployments need shared provider-health coordination and bounded request timeouts.

No marketplace adapter is connected by this change. The contract deliberately exposes no purchase, payment, listing-publication, or order-modification method. A provider appearing in the registry must never be presented as a live integration unless its official API, authentication, capability scope, and health are independently verified. Keep PAPER mode as the only supported operating mode.

### Outbound provider HTTP boundary

`ProviderHttpClient` is a JSON-only GET client for future read-only adapters. It requires an HTTPS base URL and an exact hostname allowlist supplied by trusted server configuration, rejects paths outside the configured base path, rejects redirects, applies a bounded timeout and response-size limit, and accepts an optional server-side bearer token. It never accepts credentials from mobile requests. Provider adapters must still validate and normalize the returned JSON against provider-specific schemas before using it.

This is transport hardening, not a marketplace integration. No provider host is configured, no secret is provisioned, and no external marketplace request is made by the application at this stage. The response size limit is enforced while streaming the response body, before the full payload is buffered. A declared content length is also checked early. Keep an independent egress/proxy limit in production as defense in depth.


### Server-side provider configuration

`loadProviderRuntimeConfig(providerId, process.env)` reads only the API process environment. For each configured provider, set:
- `PROVIDER_<ID>_BASE_URL`
- `PROVIDER_<ID>_ALLOWED_HOSTS` (comma-separated exact hostnames; no wildcards)
- optional `PROVIDER_<ID>_API_TOKEN` (opaque server-side token)

The loader rejects partial configuration, non-HTTPS endpoints, host mismatches, wildcard hosts, URL credentials/query/fragment, and malformed provider IDs. When no provider variables exist, the provider is returned as disabled. Never serialize the resulting config object, log it, expose it in API responses, or pass it to the mobile application because it may contain a credential. Supply secrets through the deployment platform's secret manager/environment injection; do not commit real values or place them in `EXPO_PUBLIC_*` variables.

This remains configuration plumbing only: no marketplace provider has been selected or connected, and no network request is made during configuration loading. A real adapter must be implemented against a named provider's official read API, validate provider responses, and declare only capabilities actually supported by that API.


### Generic read-only Catalog REST adapter

A generic contract adapter is now available in `src/providers/catalog-rest-adapter.ts`. It expects:
- `GET /health`
- `GET /products?q=<query>&limit=<1..50>&currency=<ISO-4217>`
- a JSON response shaped as `{ "items": [{ "id", "title", "url", "currency", "priceMinor", "observedAt" }] }`

Product payloads are validated and normalized; product links must use HTTPS. The adapter advertises only `PRODUCT_SEARCH`. It has no purchase, listing, payment, or order mutation methods. `bootstrap.ts` registers it only when the `PROVIDER_CATALOG_DEMO_*` server environment is configured.

This is a generic integration contract and test fixture, not a connection to eBay, Amazon, Shopify, or another real marketplace. No provider endpoint or credentials are supplied by default. The registry is not yet exposed through an HTTP route because authenticated sessions and provider-specific authorization are not implemented. Do not enable this adapter against a real service until its official API contract, terms, credentials, and response schema have been reviewed.


### Deal analysis and risk screening

`@autonomagent/trading-core` exports `analyzeDeals` from `src/deal-scanner.ts`. It accepts normalized provider products plus an explicit cost profile (shipping, marketplace/payment fees, packaging, risk reserve) and a resale-price assumption. It calculates expected net profit and ROI with integer-cent/BigInt arithmetic, then applies the existing risk limits.

The scanner currently accepts EUR only; it rejects other currencies rather than silently converting them. It also rejects duplicate provider identities and invalid minor-unit prices. `approvedByRiskRules` means only that the supplied numeric candidate passed the configured rules; it is not purchase authorization, a guarantee of sale, realized profit, or a signal to execute a trade. The scanner does not reserve funds or create orders.


The same package also exports `scanProviderDeals(provider, request, signal?)`. This composes a provider's declared `PRODUCT_SEARCH` capability with the analysis function: it bounds query/limit, requires EUR until conversion is implemented, propagates abort signals, rejects over-sized provider responses, and analyzes only records actually returned by that provider. An empty provider response stays empty; no sample products are substituted.

This pipeline is currently a reusable core function, not an HTTP endpoint. The API deliberately does not expose it publicly until authenticated sessions, authorization, and persisted audit controls are in place.
