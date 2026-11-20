# Production acceptance runbook

This runbook is the gate between a successful repository build and an actual production launch.

## Required infrastructure

- PostgreSQL 16+ with automated backups and a tested restore procedure.
- PostgreSQL database for application data and shared authentication rate limits.
- Secret manager entries for `DATABASE_URL` and `AUTH_SIGNING_SECRET`; configure `BRAVE_SEARCH_API_KEY` only if the read-only Brave search route is enabled.
- A server-side catalog provider implementing the documented read-only contract. No provider credentials belong in the Android app.
- A trusted operator shell for one-time ADMIN bootstrap and a scheduler for refresh-session cleanup.

## Release sequence

1. Review the GitHub Actions CI run. Require Prisma validation/migrations, API build, workspace typecheck, tests, dependency audit, and Android Expo export to pass.
2. Provision PostgreSQL; restrict network access and database privileges.
3. Deploy the API with `TRADING_MODE=PAPER`, `LIVE_TRADING_ENABLED=false`, and `EMERGENCY_STOP=true`.
4. Apply migrations with `npx prisma migrate deploy --schema services/api/prisma/schema.prisma`.
5. Generate a high-entropy signing secret (at least 32 random bytes) and configure all required secrets only in the deployment secret manager.
6. Run the one-time ADMIN bootstrap command from a trusted shell.
7. Run the session cleanup command from a daily scheduler and alert on non-zero exit status.
8. Verify in staging: login, refresh-token reuse rejection, logout, viewer/ADMIN authorization, audit trail, shared PostgreSQL rate limits, provider discovery, empty-provider scan failure, and successful scan against a real provider contract.
9. Verify backups and restore, TLS, log redaction, monitoring, alerting, and rollback.
10. Only then consider the application ready for controlled PAPER operation.

## Not production-ready until

- A real provider is configured and contract-tested; the generic catalog adapter is not a marketplace integration.
- Resale prices, fee assumptions, inventory and account state are sourced and validated rather than entered as unverified assumptions.
- CI is green and migrations have been applied to staging.
- A production deployment and smoke tests are confirmed.
- Immutable external audit export and database UPDATE/DELETE restrictions are configured.

Deal review approval is not purchase authorization. The repository intentionally contains no live purchase/order execution. Do not enable live trading as part of this release.


### Current shared authentication throttling

Authentication endpoints use `AuthRateLimitBucket` in PostgreSQL. A single `INSERT ... ON CONFLICT DO UPDATE` operation atomically increments each hashed client/route bucket, so multiple API instances share the same fixed-window limit. The raw IP/route key is not persisted. The migration is `20261117030000_auth_rate_limit_buckets`. No external Redis service or Redis REST secrets are required. Keep this database reachable; auth routes fail closed if the database-backed limiter cannot run.
