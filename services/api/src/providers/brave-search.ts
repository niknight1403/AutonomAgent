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

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"] as const;
const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|dclid|msclkid|yclid|twclid|igshid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|si)$/i;

/**
 * Only public DNS names over HTTPS qualify as a source lead. Loopback, private
 * network literals (IPv4 dotted/decimal/hex, IPv6) and single-label hosts are
 * rejected before a result can reach the client.
 */
function isPublicDnsHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host || host.length > 253) return false;
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (host.includes(":") || host.includes("[") || host.includes("]")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  // A numeric final label means a dotted, decimal or hex IP address, not a public name.
  return !/^(?:\d+|0x[0-9a-f]+)$/.test(labels[labels.length - 1] as string);
}

function canonicalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!isPublicDnsHostname(url.hostname)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
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
    const slot = new Promise<void>((resolve) => { release = resolve; });
    // An aborted waiter can release its slot early without overtaking an active request.
    this.queue = previous.then(() => slot);
    try {
      if (signal?.aborted) throw new ProviderHttpError("Provider request was aborted or timed out");
      if (signal) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new ProviderHttpError("Provider request was aborted or timed out"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          void previous.then(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          });
          if (signal.aborted) onAbort();
        });
      } else {
        await previous;
      }
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
