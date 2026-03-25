import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkLog, type NetworkLog } from "./network-log.js";

function mockFetchOk(status = 200) {
  return vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: "OK",
    } as Response);
}

function mockFetchFail(status = 500) {
  return vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue({
      ok: false,
      status,
      statusText: "Internal Server Error",
    } as Response);
}

function mockFetchThrow(message = "Network error") {
  return vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockRejectedValue(new Error(message));
}

let log: NetworkLog;

beforeEach(() => {
  vi.restoreAllMocks();
  log = createNetworkLog();
});

describe("createNetworkLog", () => {
  it("logs a successful fetch with correct fields", async () => {
    const raw = mockFetchOk();
    const wrapped = log.wrapFetch(raw);

    await wrapped("https://api.example.com/data", { method: "POST" });

    const entries = log.getEntries();
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.url).toBe("https://api.example.com/data");
    expect(entry.method).toBe("POST");
    expect(entry.status).toBe(200);
    expect(entry.ok).toBe(true);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("defaults method to GET", async () => {
    const raw = mockFetchOk();
    const wrapped = log.wrapFetch(raw);

    await wrapped("https://api.example.com/data");

    expect(log.getEntries()[0]!.method).toBe("GET");
  });

  it("logs a failed fetch (non-2xx) with ok=false", async () => {
    const raw = mockFetchFail(404);
    const wrapped = log.wrapFetch(raw);

    await wrapped("https://api.example.com/missing");

    const entry = log.getEntries()[0]!;
    expect(entry.ok).toBe(false);
    expect(entry.status).toBe(404);
  });

  it("logs a network error with status=null and ok=false", async () => {
    const raw = mockFetchThrow("connection refused");
    const wrapped = log.wrapFetch(raw);

    await expect(wrapped("https://api.example.com/down")).rejects.toThrow(
      "connection refused",
    );

    const entry = log.getEntries()[0]!;
    expect(entry.status).toBeNull();
    expect(entry.ok).toBe(false);
    expect(entry.url).toBe("https://api.example.com/down");
  });

  it("passes through the original response unchanged", async () => {
    const response = { ok: true, status: 200, statusText: "OK" } as Response;
    const raw = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(response);
    const wrapped = log.wrapFetch(raw);

    const result = await wrapped("https://api.example.com");

    expect(result).toBe(response);
  });

  it("re-throws the original error unchanged", async () => {
    const error = new Error("boom");
    const raw = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(error);
    const wrapped = log.wrapFetch(raw);

    await expect(wrapped("https://api.example.com")).rejects.toBe(error);
  });

  it("respects maxSize — oldest entries are dropped", async () => {
    const small = createNetworkLog({ maxSize: 30 });
    const raw = mockFetchOk();
    const wrapped = small.wrapFetch(raw);

    for (let i = 0; i < 35; i++) {
      await wrapped(`https://api.example.com/${i}`);
    }

    const entries = small.getEntries();
    expect(entries).toHaveLength(30);
    // oldest 5 (0-4) should be dropped; first entry should be /5
    expect(entries[0]!.url).toBe("https://api.example.com/5");
    expect(entries[29]!.url).toBe("https://api.example.com/34");
  });

  it("excludes URLs matching excludePatterns", async () => {
    const filtered = createNetworkLog({
      excludePatterns: ["/telemetry", "/health"],
    });
    const raw = mockFetchOk();
    const wrapped = filtered.wrapFetch(raw);

    await wrapped("https://api.example.com/telemetry");
    await wrapped("https://api.example.com/health");
    await wrapped("https://api.example.com/users");

    const entries = filtered.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.url).toBe("https://api.example.com/users");
  });

  it("still calls original fetch for excluded URLs", async () => {
    const filtered = createNetworkLog({ excludePatterns: ["/telemetry"] });
    const raw = mockFetchOk();
    const wrapped = filtered.wrapFetch(raw);

    await wrapped("https://api.example.com/telemetry");

    expect(raw).toHaveBeenCalledOnce();
  });

  it("getEntries() returns a copy — mutations do not affect buffer", async () => {
    const raw = mockFetchOk();
    const wrapped = log.wrapFetch(raw);

    await wrapped("https://api.example.com/a");

    const copy = log.getEntries();
    copy.length = 0;

    expect(log.getEntries()).toHaveLength(1);
  });

  it("clear() empties the buffer", async () => {
    const raw = mockFetchOk();
    const wrapped = log.wrapFetch(raw);

    await wrapped("https://api.example.com/a");
    await wrapped("https://api.example.com/b");
    expect(log.getEntries()).toHaveLength(2);

    log.clear();
    expect(log.getEntries()).toHaveLength(0);
  });

  it("truncates URLs longer than 200 characters", async () => {
    const raw = mockFetchOk();
    const wrapped = log.wrapFetch(raw);

    const longUrl = `https://api.example.com/${"x".repeat(300)}`;
    await wrapped(longUrl);

    const entry = log.getEntries()[0]!;
    expect(entry.url).toHaveLength(200);
    expect(entry.url).toBe(longUrl.slice(0, 200));
  });

  it("destroy() clears the buffer", async () => {
    const raw = mockFetchOk();
    const wrapped = log.wrapFetch(raw);

    await wrapped("https://api.example.com/a");
    expect(log.getEntries()).toHaveLength(1);

    log.destroy();
    expect(log.getEntries()).toHaveLength(0);
  });
});
