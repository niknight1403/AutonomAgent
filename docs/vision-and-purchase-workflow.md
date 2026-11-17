# Vision inspection and controlled purchase workflow

## Vision worker (implemented scaffold)

The isolated Python worker under `services/vision-worker` uses an async OpenAI-compatible client and validates model output with Pydantic. Configure `LLM_API_KEY`, `LLM_BASE_URL`, and `VISION_MODEL` on the worker only. Configure the exact image host allowlist in the worker deployment and pass it as `allowed_hosts`.

The downloader requires HTTPS, an exact allowlisted hostname, public DNS answers, no redirects, a supported image MIME type, matching file signatures, and an 8 MiB maximum. Production deployment must additionally enforce outbound network policy at the container/VPC layer to prevent DNS rebinding and access to metadata/private networks. Do not accept arbitrary user-supplied URLs or treat the model's visual score as an authenticity certificate.

## Purchase workflow (design boundary; not an active integration)

The existing API supports authenticated deal review, not marketplace purchases. Do not add a generic Playwright login-and-send implementation or claim that a purchase succeeded when a background task was merely queued.

A future provider adapter must be explicitly registered with narrow capabilities and must use the provider's supported official API. The execution workflow must:
1. Require a fresh ADMIN authorization and a separate, explicit execution confirmation.
2. Load the persisted candidate; never accept a target URL or price supplied by the mobile client.
3. Re-fetch current listing state and price through the approved provider adapter.
4. Compare the final all-in cost (item, shipping, platform/payment fees, tax, packaging, risk reserve) with the approved maximum in integer minor units.
5. Enforce PAPER mode, server-side kill switch, provider/category/user limits, approval expiry, and idempotency.
6. Persist an immutable execution attempt and audit event before external side effects.
7. Return `accepted` only when a durable job is stored; report `submitted`, `confirmed`, `failed`, or `unknown` only from verified provider outcomes.
8. Require manual confirmation before sending a binding offer or initiating payment unless the administrator has separately enabled a narrowly scoped, capped automation policy.

Unknown provider outcomes must be reconciled; never blindly retry a purchase or message. No live provider, purchase endpoint, payment flow, or automated seller contact is enabled by this document.
