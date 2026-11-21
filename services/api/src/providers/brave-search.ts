import { createHash } from "node:crypto";
import { ProviderHttpClient, ProviderHttpError } from "./http-client.js";

export interface WebSearchRequest {
  query: string;
  count?: number;
  offset?: number;
}

export interface WebSearchLead {
  id: string;
  providerId: "brave-search";
  title: string;
  url: string;
  snippet?: string;
  retrievedAt: string;
}

export interface WebSearchPage {
  query: string;
  results: WebSearchLead[];
  moreResultsAvailable: boolean;
}

interface BraveWebResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
}

interface BraveSearchResponse {
  web?: { results?: unknown };
  query?: { more_results_available?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
        url.hostname.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
        url.hostname.includes(":")) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|msclkid|igshid|mc_cid|mc_eid|ref)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Read-only search leads from Brave. Search results are not verified listings:
 * this adapter intentionally produces no price, stock, fee, or purchase fields.
 */
export class BraveSearchClient {
  private readonly client: ProviderHttpClient;
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(
    subscriptionToken: string,
    private readonly minimumIntervalMs = 1_100,
  ) {
    if (!subscriptionToken.trim() || /[\r\n]/.test(subscriptionToken)) {
      throw new Error("BRAVE_SEARCH_API_KEY is missing or invalid");
    }
    if (!Number.isInteger(minimumIntervalMs) || minimumIntervalMs < 0 || minimumIntervalMs > 60_000) {
      throw new Error("minimumIntervalMs must be between 0 and 60000");
    }
    this.client = new ProviderHttpClient({
      baseUrl: "https://api.search.brave.com/res/",
      allowedHosts: ["api.search.brave.com"],
      subscriptionToken,
      timeoutMs: 8_000,
      maxResponseBytes: 1_000_000,
    });
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchPage> {
    const query = request.query.trim().replace(/\s+/g, " ");
    const count = request.count ?? 10;
    const offset = request.offset ?? 0;
    if (!query || query.length > 600 || query.split(" ").length > 75) {
      throw new Error("WEB_SEARCH_QUERY_INVALID");
    }
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new Error("WEB_SEARCH_COUNT_INVALID");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 9) {
      throw new Error("WEB_SEARCH_OFFSET_INVALID");
    }

    const response = await this.withRateLimit(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.client.getJson<BraveSearchResponse>("v1/web/search", {
            q: query,
            count: String(count),
            offset: String(offset),
            country: "DE",
            search_lang: "de",
            safesearch: "moderate",
            text_decorations: "false",
          }, signal);
        } catch (error) {
          if (!(error instanceof ProviderHttpError) || error.status !== 429 || attempt >= 2) throw error;
          const delayMs = error.retryAfterMs ?? (1_000 * (attempt + 1));
          await this.wait(delayMs, signal);
        }
      }
    }, signal);

    if (!isRecord(response) || (response.web !== undefined &&
        (!isRecord(response.web) || !Array.isArray(response.web.results)))) {
      throw new ProviderHttpError("Provider returned invalid search results");
    }
    const rawResults = isRecord(response.web) ? response.web.results as unknown[] : [];
    const seen = new Set<string>();
    const results: WebSearchLead[] = [];
    const retrievedAt = new Date().toISOString();
    for (const raw of rawResults) {
      if (!isRecord(raw)) continue;
      const item = raw as BraveWebResult;
      if (typeof item.title !== "string" || !item.title.trim()) continue;
      const url = canonicalHttpsUrl(item.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const snippet = typeof item.description === "string" && item.description.trim()
        ? item.description.trim().slice(0, 2_000)
        : undefined;
      results.push({
        id: createHash("sha256").update(url).digest("hex"),
        providerId: "brave-search",
        title: item.title.trim().slice(0, 500),
        url,
        ...(snippet ? { snippet } : {}),
        retrievedAt,
      });
    }

    return {
      query,
      results,
      moreResultsAvailable: offset < 9 && isRecord(response.query) && response.query.more_results_available === true,
    };
  }

  private async wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new ProviderHttpError("Provider request was aborted or timed out");
    if (delayMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new ProviderHttpError("Provider request was aborted or timed out"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async withRateLimit<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      await this.wait(waitMs, signal);
      if (signal?.aborted) throw new ProviderHttpError("Provider request was aborted or timed out");
      this.nextRequestAt = Date.now() + this.minimumIntervalMs;
      return await operation();
    } finally {
      release();
    }
  }
}
