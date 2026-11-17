# Runtime secrets and configuration

This repository intentionally keeps credential values out of source control. Configure values in the deployment platform's encrypted environment-variable store, not in this file or in GitHub Actions logs.

## API runtime

| Name | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma | Yes for deployed API |
| `AUTH_SIGNING_SECRET` | Signs/verifies API authentication tokens | Yes for deployed API |

## Vision worker runtime

| Name | Purpose | Required |
|---|---|---|
| `LLM_API_KEY` | Credential for the configured OpenAI-compatible vision provider | Yes for hosted provider; omit only for a deliberately configured local unauthenticated endpoint |
| `LLM_BASE_URL` | OpenAI-compatible provider base URL | Yes for non-default provider; otherwise use the worker's documented default |
| `VISION_MODEL` | Vision-capable model identifier | Yes for provider deployments |

## CI

The standard CI workflow uses an ephemeral PostgreSQL service with disposable test credentials. It does not require production secrets and must never receive production database credentials.

The `Secret hygiene` workflow scans tracked application source for high-confidence credential formats. Synthetic test fixtures and documentation are excluded to avoid treating intentionally fake test values as live credentials. This scan does not enumerate GitHub's encrypted secret store and cannot prove that a deployment secret is configured.

## Provisioning checklist

- Add the API variables to the API service's secret environment.
- Add the vision-provider variables to the worker service's secret environment.
- Keep API and worker credentials scoped separately where the provider supports it.
- Rotate any credential that was ever committed in plaintext.
- Never paste secret values into issues, pull requests, chat, build logs, or this repository.
