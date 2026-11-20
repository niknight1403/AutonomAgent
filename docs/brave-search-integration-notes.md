# Brave Search API integration notes

This file records the official contract used for the read-only Brave Web Search adapter. A Brave result is a **search lead**, not a verified product listing: the API provides a ranked title, URL, and snippet, but the application must not infer a purchase price, stock quantity, fees, or checkout capability from those fields.

## Verified API contract

- Request: `GET https://api.search.brave.com/res/v1/web/search`
- Authentication: `X-Subscription-Token: <server-side key>`; the key must never be sent to the mobile app.
- Required query: `q` (non-empty; API maximum 600 characters / 75 words).
- Search result page size: `count` from 1 to 20; `offset` from 0 to 9. Results may overlap across pages.
- For German-oriented searches, use `country=DE` and `search_lang=de`.
- Web results are returned in `web.results`; each useful item includes `title`, `url`, and `description`. These are not evidence of live price or stock.
- Rate limiting uses a sliding one-second window. HTTP 429 and `X-RateLimit-*` response headers are documented; callers should back off rather than retry immediately.

## Primary references

- [Brave Web Search service documentation](https://api-dashboard.search.brave.com/documentation/services/web-search)
- [Brave Web Search API reference](https://api-dashboard.search.brave.com/api-reference/web/search/get)
- [Brave rate-limiting guide](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting)
