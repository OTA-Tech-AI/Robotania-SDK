import { describe, it, expect, vi, afterEach } from "vitest";
import { GatewayClient } from "../src/gateway.js";
import { createRandom } from "../src/wallet.js";

describe("GatewayClient POST envelope", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps ok:true,data:{request_id,status} as RequestResult", async () => {
    const wallet = createRandom();
    const client = new GatewayClient({ baseUrl: "http://localhost:9", wallet });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 202,
        json: async () => ({
          ok: true,
          data: { request_id: "req-1", status: "RECEIVED" },
        }),
      })) as unknown as typeof fetch,
    );

    const out = await client.registerCitizen({});
    expect(out).toEqual({ request_id: "req-1", status: "RECEIVED" });
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
          error_code: "DISPLAY_UPDATE_COOLDOWN",
          message: "Try later.",
          next_allowed_at: "2026-07-25T12:00:00.000Z",
        }),
      })) as unknown as typeof fetch,
    );

    await expect(client.registerCitizen({})).rejects.toMatchObject({
      errorCode: "DISPLAY_UPDATE_COOLDOWN",
      response: { next_allowed_at: "2026-07-25T12:00:00.000Z" },
    });
  });
});
