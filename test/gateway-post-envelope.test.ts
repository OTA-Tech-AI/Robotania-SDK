import { describe, it, expect, vi, afterEach } from "vitest";
import { GatewayActionFailedError, GatewayActionPendingError, GatewayClient } from "../src/gateway.js";
import { createRandom } from "../src/wallet.js";

describe("GatewayClient POST envelope", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a finalized outcome from a write", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            request_id: "req-1",
            action: "citizens/register",
            status: "FINALIZED",
            terminal: true,
            phase: "FINALIZED",
            tx_hash: "0x1",
            result: {},
            next_action: "NONE",
          },
        }),
      })) as unknown as typeof fetch,
    );

    const out = await client.registerCitizen({});
    expect(out).toMatchObject({ request_id: "req-1", status: "FINALIZED", terminal: true });
  });

  it("returns pending only when async mode is requested", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({
      baseUrl: "http://localhost:9",
      wallet,
      writeOptions: { mode: "async" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({
        ok: true,
        data: {
          request_id: "req-2",
          action: "citizens/register",
          status: "PENDING",
          terminal: false,
          phase: "RECEIVED",
          tx_hash: null,
          next_action: "POLL_REQUEST",
        },
      }),
    })) as unknown as typeof fetch);

    await expect(client.registerCitizen({})).resolves.toMatchObject({
      request_id: "req-2", status: "PENDING", terminal: false,
    });
  });

  it("retains the Gateway pending outcome when the default wait times out", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({
      baseUrl: "http://localhost:9",
      wallet,
      writeOptions: { timeoutMs: 1 },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({
        ok: true,
        data: {
          request_id: "req-timeout",
          action: "citizens/register",
          status: "PENDING",
          terminal: false,
          phase: "RECEIVED",
          tx_hash: null,
          next_action: "POLL_REQUEST",
        },
      }),
    })) as unknown as typeof fetch);

    const error = await client.registerCitizen({}).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GatewayActionPendingError);
    expect((error as GatewayActionPendingError).outcome).toMatchObject({
      request_id: "req-timeout",
      phase: "RECEIVED",
      status: "PENDING",
    });
  });

  it("does not invent a Gateway phase when request status is unavailable", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network unavailable"); }) as unknown as typeof fetch);

    const error = await client.waitForRequest("req-unavailable", {
      timeoutMs: 1,
      pollIntervalMs: 1,
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GatewayActionPendingError);
    expect((error as GatewayActionPendingError).requestId).toBe("req-unavailable");
    expect((error as GatewayActionPendingError).outcome).toBeNull();
  });

  it("waits for a pending write to finalize by default", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          ok: true,
          data: {
            request_id: "req-wait",
            action: "citizens/register",
            status: "PENDING",
            terminal: false,
            phase: "RECEIVED",
            tx_hash: null,
            next_action: "POLL_REQUEST",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            request_id: "req-wait",
            action: "citizens/register",
            status: "FINALIZED",
            terminal: true,
            phase: "FINALIZED",
            tx_hash: "0x2",
            result: {},
            next_action: "NONE",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(client.registerCitizen({})).resolves.toMatchObject({
      request_id: "req-wait", status: "FINALIZED", terminal: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a typed error for a terminal failed request", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          request_id: "req-3",
          action: "jury/submit-rubric",
          status: "FAILED",
          terminal: true,
          phase: "FAILED",
          tx_hash: null,
          next_action: "REFRESH_CONTEXT",
          error: {
            code: "JURY_CASE_NOT_VOTING",
            message: "The jury case is not accepting votes.",
            next_action: "REFRESH_CONTEXT",
          },
        },
      }),
    })) as unknown as typeof fetch);

    await expect(client.registerCitizen({})).rejects.toBeInstanceOf(GatewayActionFailedError);
  });

  it("throws when success body omits data", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 202,
        json: async () => ({ ok: true }),
      })) as unknown as typeof fetch,
    );

    await expect(client.registerCitizen({})).rejects.toThrow("MISSING_DATA");
  });

  it("rejects a successful write response that is not a normalized outcome", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: { status: "RECEIVED" } }),
      })) as unknown as typeof fetch,
    );

    await expect(client.registerCitizen({})).rejects.toMatchObject({
      errorCode: "INVALID_RESPONSE",
    });
  });

  it("retains public Gateway error fields for retry handling", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({
          ok: false,
          error: {
            code: "DISPLAY_UPDATE_COOLDOWN",
            message: "Try later.",
            next_action: "REFRESH_CONTEXT",
            next_allowed_at: "2026-07-25T12:00:00.000Z",
          },
        }),
      })) as unknown as typeof fetch,
    );

    await expect(client.registerCitizen({})).rejects.toMatchObject({
      errorCode: "DISPLAY_UPDATE_COOLDOWN",
      response: { next_allowed_at: "2026-07-25T12:00:00.000Z" },
    });
  });
});
