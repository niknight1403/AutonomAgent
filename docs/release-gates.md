# Production release gates

A release is not production-ready merely because a JavaScript bundle or APK exists.

- [ ] TypeScript strict checks pass.
- [ ] Unit tests cover profit, risk, state transitions, and validation.
- [ ] PostgreSQL integration tests cover ledger invariants and concurrent reservations.
- [ ] Durable worker lease, retry, deduplication, outbox, and recovery tests pass.
- [ ] RBAC and session security tests pass.
- [ ] Marketplace sandbox tests verify each declared capability.
- [ ] Approval expiry and price/stock drift invalidate execution.
- [ ] Unknown purchase/payment states reconcile without blind retries.
- [ ] Android install test passes on a real device.
- [ ] Backend health, migration status, artifact SHA256, and build ID are recorded.
- [ ] Emergency stop is server-side and verified.

Until every relevant gate is evidenced, keep LIVE trading disabled.

## Source-code release CI (not a production approval)

The GitHub Actions workflow at `.github/workflows/ci.yml` checks clean lockfile installation, Prisma client generation/schema validation/migrations against PostgreSQL, API build, workspace typechecks, unit and PostgreSQL integration tests, `npm audit --audit-level=high`, and Android Expo bundling. These checks validate repository changes only; they do not satisfy the production gates above or enable live trading.

Local verification passed after a clean `npm ci`: migrations were current, API build and all workspace checks/tests passed, and the Android bundle exported. GitHub Actions CI Run `43990674018` also passed before publication. The public pre-release `v0.1.0` points to commit `f8176e3603cce88ee40bd20379e249dd69869bca`. The high/critical audit threshold passes; the current dependency tree still reports 11 moderate advisories in the Expo toolchain. Moderate findings are not a formal risk exception and must be triaged again before any production release.
