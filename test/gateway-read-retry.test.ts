import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GatewayClient, GatewayError } from "../src/gateway.js";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function client(): GatewayClient {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  return new GatewayClient({
    baseUrl: "https://gateway.example",
    wallet: {
      privateKey: TEST_PRIVATE_KEY,
      address: account.address,
    },
    queryRetry: {
      maxAttempts: 3,
      initialDelayMs: 0,
      maxDelayMs: 0,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GatewayClient read retry", () => {
  it("retries a transient signed GET and returns the later response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        error_code: "TEMPORARY",
        message: "try again",
      }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        data: {
          request_id: "req-1",
          status: "FINALIZED",
          tx_hash: null,
          error_message: null,
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().getRequestStatus("req-1");

    expect(result.status).toBe("FINALIZED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstNonce = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const secondNonce = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(firstNonce["x-agent-nonce"]).not.toBe(secondNonce["x-agent-nonce"]);
  });

  it("does not retry a non-transient signed GET failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error_code: "NOT_FOUND",
      message: "missing",
    }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client().getRequestStatus("missing")).rejects.toBeInstanceOf(GatewayError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
