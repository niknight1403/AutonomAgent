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
