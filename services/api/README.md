# API service boundary

The API is intentionally not wired to live marketplace providers yet.

Required before implementation can enable trading:
- authenticated sessions and server-enforced RBAC;
- server-side secrets vault and provider-specific capability registry;
- immutable double-entry wallet ledger and atomic reservations;
- idempotent execution attempts, durable workers, transactional outbox;
- approval snapshots bound to current price, stock, fees, and expiry;
- server-side emergency stop and reconciliation for unknown order/payment states.

The mobile app must display a disconnected state until authenticated health and operations endpoints are available. Never infer a successful purchase from a request timeout.
