import { afterEach, describe, expect, it, vi } from "vitest";
import { BraveSearchClient } from "./brave-search.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function braveResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("BraveSearchClient", () => {
  it("uses the documented server-side key header and returns only source leads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(braveResponse({
      query: { more_results_available: true },
      web: { results: [
        {
          title: "Example product page",
          url: "https://shop.example/item?utm_source=brave&id=42#details",
          description: "Search snippet, not verified price or inventory.",
        },
        {
          title: "Duplicate canonical URL",
          url: "https://shop.example/item?id=42",
          description: "Duplicate result.",
        },
        { title: "Insecure result", url: "http://unsafe.example/item" },
        { title: "Missing URL" },
      ] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new BraveSearchClient("server-only-test-key", 0);
    const page = await client.search({ query: "usb c ladegerät", count: 5, offset: 0 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(url.origin).toBe("https://api.search.brave.com");
    expect(url.pathname).toBe("/res/v1/web/search");
    expect(url.searchParams.get("country")).toBe("DE");
    expect(url.searchParams.get("search_lang")).toBe("de");
    expect((requestInit.headers as Record<string, string>)["x-subscription-token"]).toBe("server-only-test-key");
    expect(page).toMatchObject({ query: "usb c ladegerät", moreResultsAvailable: true });
    expect(page.results).toHaveLength(1);
    expect(page.results[0]).toMatchObject({
      title: "Example product page",
      url: "https://shop.example/item?id=42",
      snippet: "Search snippet, not verified price or inventory.",
      providerId: "brave-search",
    });
    expect(page.results[0]).not.toHaveProperty("price");
    expect(page.results[0]).not.toHaveProperty("stock");
  });

  it("rejects invalid query and pagination values before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new BraveSearchClient("server-only-test-key", 0);

    await expect(client.search({ query: "  " })).rejects.toThrow("WEB_SEARCH_QUERY_INVALID");
    await expect(client.search({ query: "camera", count: 21 })).rejects.toThrow("WEB_SEARCH_COUNT_INVALID");
    await expect(client.search({ query: "camera", offset: 10 })).rejects.toThrow("WEB_SEARCH_OFFSET_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops pagination at the last supported provider offset", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(braveResponse({
      query: { more_results_available: true },
      web: { results: [{ title: "Last page", url: "https://example.com/last" }] },
    })));
    const client = new BraveSearchClient("server-only-test-key", 0);

    await expect(client.search({ query: "camera", offset: 9 })).resolves.toMatchObject({
      moreResultsAvailable: false,
      results: [{ title: "Last page" }],
    });
  });

  it("backs off once on HTTP 429 using the provider reset header", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(braveResponse({}, 429, { "x-ratelimit-reset": "0, 1800" }))
      .mockResolvedValueOnce(braveResponse({ web: { results: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new BraveSearchClient("server-only-test-key", 0);
    await expect(client.search({ query: "headphones" })).resolves.toMatchObject({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes search terms and excludes local, custom-port and tracked links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(braveResponse({ web: { results: [
      { title: "Local", url: "https://localhost/item" },
      { title: "Address", url: "https://192.168.0.1/item" },
      { title: "Custom port", url: "https://shop.example:8443/item" },
      { title: "Tracked", url: "https://shop.example/item?msclkid=secret&sku=1" },
    ] } }));
    vi.stubGlobal("fetch", fetchMock);
    const page = await new BraveSearchClient("server-only-test-key", 0).search({ query: "  usb   kamera  " });
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("q")).toBe("usb kamera");
    expect(page.results.map((result) => result.url)).toEqual(["https://shop.example/item?sku=1"]);
  });

  it("rejects malformed provider payloads rather than showing empty results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(braveResponse({ web: {} })));
    await expect(new BraveSearchClient("server-only-test-key", 0).search({ query: "camera" }))
      .rejects.toThrow(/invalid search results/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(braveResponse({ query: {} })));
    await expect(new BraveSearchClient("server-only-test-key", 0).search({ query: "rare item" }))
      .resolves.toMatchObject({ results: [] });
  });

  it("aborts a rate-limit backoff without making another provider request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(braveResponse({}, 429, { "retry-after": "30" }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const pending = new BraveSearchClient("server-only-test-key", 0).search({ query: "camera" }, abort.signal);
    const rejection = expect(pending).rejects.toThrow(/aborted/);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    abort.abort();
    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
