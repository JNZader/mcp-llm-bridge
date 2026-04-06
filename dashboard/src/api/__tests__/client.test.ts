import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient } from "../client.ts";

// In jsdom, window.location.origin is "http://localhost"
const ORIGIN = "http://localhost";
const TOKEN = "test-admin-token";

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({}),
    ...response,
  });
}

describe("ApiClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("Authorization header", () => {
    it("adds Bearer token to every request", async () => {
      const fetchSpy = mockFetch({
        json: () => Promise.resolve({ status: "ok" }),
      });
      globalThis.fetch = fetchSpy;

      const client = new ApiClient(TOKEN);
      await client.getHealth();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)["Authorization"]).toBe(
        `Bearer ${TOKEN}`,
      );
    });

    it("constructs correct URL for endpoints", async () => {
      const fetchSpy = mockFetch({
        json: () => Promise.resolve({ providers: [] }),
      });
      globalThis.fetch = fetchSpy;

      const client = new ApiClient(TOKEN);
      await client.getProviders();

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe(`${ORIGIN}/v1/admin/providers`);
    });
  });

  describe("401 handling", () => {
    it("calls onUnauthorized callback on 401 response", async () => {
      globalThis.fetch = mockFetch({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const onUnauthorized = vi.fn();
      const client = new ApiClient(TOKEN, onUnauthorized);

      await expect(client.getHealth()).rejects.toThrow("Unauthorized");
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });

    it("calls onUnauthorized callback on 403 response", async () => {
      globalThis.fetch = mockFetch({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const onUnauthorized = vi.fn();
      const client = new ApiClient(TOKEN, onUnauthorized);

      await expect(client.getHealth()).rejects.toThrow("Unauthorized");
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
  });

  describe("Network error handling", () => {
    it("throws descriptive error on network failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      const client = new ApiClient(TOKEN);

      await expect(client.getHealth()).rejects.toThrow(
        `Network error: could not reach ${ORIGIN}`,
      );
    });
  });

  describe("HTTP error handling", () => {
    it("extracts error message from JSON response body", async () => {
      globalThis.fetch = mockFetch({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({ error: "Database connection failed" }),
      });

      const client = new ApiClient(TOKEN);

      await expect(client.getOverview()).rejects.toThrow("Database connection failed");
    });

    it("falls back to status text when body has no error field", async () => {
      globalThis.fetch = mockFetch({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.resolve({}),
      });

      const client = new ApiClient(TOKEN);

      await expect(client.getOverview()).rejects.toThrow("HTTP 502: Bad Gateway");
    });
  });

  describe("getOverview", () => {
    it("returns parsed overview response", async () => {
      const data = {
        providers: [{ id: "openai", name: "OpenAI", type: "api", available: true }],
        groups: [],
        circuitBreakers: { total: 1, open: 0, closed: 1, halfOpen: 0 },
        usage: { totalRequests: 100, totalCost: 5.5, totalTokens: 50000 },
        system: { uptime: 3600, version: "1.0.0", mode: "production" },
      };
      globalThis.fetch = mockFetch({ json: () => Promise.resolve(data) });

      const client = new ApiClient(TOKEN);
      const result = await client.getOverview();

      expect(result).toEqual(data);
    });
  });

  describe("getProviders", () => {
    it("returns parsed providers response", async () => {
      const data = {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            type: "api",
            available: true,
            models: [{ id: "gpt-4", name: "GPT-4", maxTokens: 8192 }],
            circuitBreaker: { state: "CLOSED", failures: 0, consecutiveFailures: 0 },
          },
        ],
      };
      globalThis.fetch = mockFetch({ json: () => Promise.resolve(data) });

      const client = new ApiClient(TOKEN);
      const result = await client.getProviders();

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]!.id).toBe("openai");
    });
  });

  describe("getHealth", () => {
    it("returns parsed health response", async () => {
      const data = {
        status: "ok",
        uptime: 7200,
        version: "1.0.0",
        database: { connected: true },
        providers: { available: 3, total: 4 },
        memory: { rss: 100, heapTotal: 80, heapUsed: 60, external: 10 },
      };
      globalThis.fetch = mockFetch({ json: () => Promise.resolve(data) });

      const client = new ApiClient(TOKEN);
      const result = await client.getHealth();

      expect(result.status).toBe("ok");
      expect(result.providers.available).toBe(3);
    });
  });

  describe("Usage query params", () => {
    it("builds query string for getUsageSummary", async () => {
      const fetchSpy = mockFetch({
        json: () =>
          Promise.resolve({
            totalRequests: 0,
            totalTokensIn: 0,
            totalTokensOut: 0,
            totalCostUsd: 0,
            avgLatencyMs: 0,
            breakdown: [],
          }),
      });
      globalThis.fetch = fetchSpy;

      const client = new ApiClient(TOKEN);
      await client.getUsageSummary({
        provider: "openai",
        from: "2026-01-01",
        to: "2026-01-31",
      });

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toContain("provider=openai");
      expect(url).toContain("from=2026-01-01");
      expect(url).toContain("to=2026-01-31");
    });
  });
});
