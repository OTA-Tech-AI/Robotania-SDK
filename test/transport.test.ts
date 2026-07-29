import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReadWithRetry } from "../src/transport.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchReadWithRetry", () => {
  it("retries transient responses but returns a non-retryable response immediately", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchReadWithRetry("https://example.test/read", {}, {
      maxAttempts: 3,
      initialDelayMs: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an explicitly aborted request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("operator cancelled"));
    const fetchMock = vi.fn().mockRejectedValue(controller.signal.reason);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchReadWithRetry("https://example.test/read", { signal: controller.signal }),
    ).rejects.toThrow("operator cancelled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
