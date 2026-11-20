# AutonomAgent

AutonomAgent is an Android-first Expo/React Native application and TypeScript API for controlled product research and resale-workflow foundations.

## Current release posture

- **Operating mode:** PAPER; live trading is disabled and rejected by API configuration.
- **Mobile:** status dashboard, password login, rotating sessions, and ADMIN-gated read-only web research.
- **Search:** Brave Web Search returns source leads. Search snippets are not verified product prices, inventory, shipping costs, fees, or offers.
- **Persistence:** PostgreSQL/Prisma stores users, reviewable deal candidates, sessions, and audit records. Web-search leads are not persisted.
- **Payments and commerce:** Stripe/Digistore24 checkout, procurement, marketplace purchases, listing publication, and payouts are not implemented or enabled. HubSpot synchronization is not implemented.
- **Operations:** worker/outbox primitives exist, but the API reports its worker as not running; no autonomous scheduler is active.
- **Production readiness:** this is a source-code release, not a production approval or APK/device-install release. Real provider, database, migration, deployment, and credential verification remain prerequisites.

## Workspace

- `apps/mobile` — Expo Android client
- `services/api` — Fastify API, authentication/RBAC, Prisma persistence, health/status, deal-review and read-only search routes
- `packages/trading-core` — profit/risk calculations and research/backtest primitives
- `docs` — architecture, integration boundaries, security, and release gates

## Getting started

Requirements: Node.js 22 (see `.node-version`) and npm.

```bash
npm ci
cp apps/mobile/.env.example apps/mobile/.env
npm run mobile
```

For a deployed API, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to its HTTPS base URL. The Android-emulator HTTP address in the example is for trusted local development only. Never put server secrets in `EXPO_PUBLIC_*` variables. The API must be configured and running for login and search to work. Public self-registration is not provided; an administrator must be provisioned out of band after database setup and migrations.

## Important API settings

- `DATABASE_URL` — PostgreSQL connection for auth, review data, audit, and worker primitives.
- `AUTH_SIGNING_SECRET` — server-only high-entropy signing secret (at least 32 bytes).
- `BRAVE_SEARCH_API_KEY` — optional server-only Brave key for the ADMIN-gated read-only search route.
- `TRADING_MODE=PAPER`, `LIVE_TRADING_ENABLED=false`, `EMERGENCY_STOP=true` — required safe operating posture.

See [API configuration and routes](services/api/README.md), [runtime secret guidance](docs/SECRETS.md), and [production acceptance gates](docs/PRODUCTION_ACCEPTANCE.md).

## Safety boundaries

There are no live purchase/order, payment, listing-publication, or payout routes. An approved deal-review status is not purchase authorization. Search results do not prove current prices or stock, and no performance metric is represented as realized revenue. Keep live trading disabled; do not treat a passing source build as production readiness.

## License

No license has been granted yet. All rights reserved unless a separate license is added.
