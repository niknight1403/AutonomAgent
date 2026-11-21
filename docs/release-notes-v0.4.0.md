# AutonomAgent v0.4.0

**Release type:** official source-code release
**Release date:** 2026-11-21
**Base:** current `main`, after `v0.3.0`
**Status:** released after local and remote verification. This is not a production-readiness claim or an APK distribution.

## Highlights

- Replaced the local mobile demo-product dashboard with a connected product-research screen. Mobile clients can show API status, sign in, rotate refresh sessions, and request read-only web-search leads through an authenticated API.
- Added password authentication using Node.js scrypt, short-lived HS256 access tokens, one-time rotating refresh sessions stored by hash, logout/revocation, and database-backed role checks. The mobile app stores the refresh token with Expo SecureStore.
- Added PostgreSQL-backed, atomic authentication rate limiting shared across API instances. No Redis service or Redis credentials are required.
- Added an ADMIN-only security-audit reader, audit events for supported lifecycle/review operations, a controlled one-time ADMIN bootstrap command, and bounded refresh-session cleanup tooling.
- Added a read-only Brave Web Search adapter and protected search route. Results are deduplicated HTTPS source leads only; they are not verified prices, inventory, shipping, fees, or offers.
- Added ADMIN-gated provider discovery and deal-scan/review workflow foundations, including candidate persistence and risk screening. A reviewed candidate is not an order or purchase authorization.
- Improved runtime/build packaging for Node 22 and compiled workspace modules; added Render deployment configuration and secret-hygiene scanning.

## Removed or intentionally unavailable

- Removed the locally bundled sample-product/demo dashboard, sample margins, illustrative reach scenarios, and associated local autopilot fixtures. Search results are not replaced with fake products when no provider is configured.
- Live trading, marketplace purchases/orders, payment/checkout, listing publication, payouts, and HubSpot synchronization are not implemented or enabled.
- No marketplace integration is connected by default. Generic provider contracts and search leads do not imply access to eBay, Amazon, Shopify, or other marketplace account data.
- Worker/outbox primitives exist, but the API does not start an autonomous worker or scheduler. Web-search leads are not persisted.

## Upgrade and deployment notes

1. Install the exact dependency graph with `npm ci` using the updated lockfile.
2. Back up the target PostgreSQL database and review migrations before deployment. Apply the checked-in Prisma migrations with `npx prisma migrate deploy --schema services/api/prisma/schema.prisma`.
3. Configure `DATABASE_URL` and a high-entropy server-only `AUTH_SIGNING_SECRET` (at least 32 random bytes). Configure `BRAVE_SEARCH_API_KEY` only if enabling the optional read-only search route. Never place server credentials in Expo `EXPO_PUBLIC_*` variables.
4. Keep `TRADING_MODE=PAPER`, `LIVE_TRADING_ENABLED=false`, and `EMERGENCY_STOP=true`. Provision the first ADMIN through the documented trusted-shell command; public self-registration is not available.
5. Use `EXPO_PUBLIC_API_URL` for the API endpoint in mobile builds. HTTPS is required for deployed environments. Android `versionCode` is now 4; this source release does not include a signed APK or Play Store artifact.

## Verification and known limitations

Local release checks on this candidate: Prisma schema validation and all **9** checked-in migrations passed; API build and all workspace typechecks passed; API tests passed **106** and Trading Core tests passed **37**; `npm ci` reproduced the lockfile; the high/critical dependency audit gate passed with **0 high** and **0 critical** findings; and the Android JavaScript bundle export passed. The Android export is not a signed APK or device-install test.

The Prisma CLI/config transitive `effect` ReDoS advisory (GHSA-7589-6fvf-x4pw) is mitigated by the tested `effect` 3.22.x resolution. The remaining **11 moderate** findings are primarily in the Expo 54 toolchain (`glob`/`minimatch`); npm reports a breaking Expo 58 upgrade as the broad fix, so Expo SDK 54 remains unchanged for this release. The high/critical audit gate is green. The signed APK and device-install test remain outside this source-code release.

Database-backed integration tests require a working PostgreSQL instance and `DATABASE_URL`; the local release run used PostgreSQL and applied all checked-in migrations. No live deployment secrets, Brave provider credential, marketplace provider, or production deployment is available in this environment, so external-provider and end-to-end production behavior has not been verified.

This release is not production-ready. Before any controlled PAPER deployment, follow [`docs/PRODUCTION_ACCEPTANCE.md`](PRODUCTION_ACCEPTANCE.md) and verify migrations, credentials, a real provider contract, staging behavior, backups/restore, monitoring, and operational controls.
