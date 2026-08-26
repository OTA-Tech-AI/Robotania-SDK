import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, GatewayError } from "../src/gateway.js";

const pending = {
  request_id: "11111111-1111-4111-8111-111111111111",
  action: "faucet/request" as const,
  citizen_id: "42",
  wallet_address: "0x0000000000000000000000000000000000000001",
  status: "PENDING" as const,
  terminal: false,
  phase: "RECEIVED" as const,
  next_action: "POLL_REQUEST" as const,
  cooldown_until: null,
  assets: [],
};

const client = () => new GatewayClient({
  baseUrl: "https://gateway.example",
  chainId: 421614,
  wallet: {
    privateKey: `0x${"11".repeat(32)}` as `0x${string}`,
    address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  },
  writeOptions: { mode: "async" },
  queryRetry: { maxAttempts: 1 },
});

afterEach(() => vi.unstubAllGlobals());

describe("GatewayClient Faucet", () => {
  it("signs the agent path and returns async acceptance", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("https://gateway.example/api/v1/agent/faucet/requests");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ assets: ["USDC", "ETH"], idempotencyKey: "fund-42" });
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-agent-signature"]).toMatch(/^0x/);
      expect(headers["x-agent-citizen-id"]).toBe("42");
      return new Response(JSON.stringify({ ok: true, data: pending }), { status: 202, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().requestFaucet({ assets: ["USDC", "ETH"], citizenId: "42", idempotencyKey: "fund-42" })).resolves.toEqual(pending);
  });

  it("loads shared public status and preserves a real not-found result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { ...pending, status: "FINALIZED", terminal: true, phase: "FINALIZED", next_action: "NONE" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: "FAUCET_REQUEST_NOT_FOUND", message: "Faucet request not found." }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const gateway = client();
    await expect(gateway.getFaucetRequest(pending.request_id)).resolves.toMatchObject({ status: "FINALIZED" });
    await expect(gateway.getFaucetRequest(pending.request_id)).rejects.toMatchObject<Partial<GatewayError>>({ errorCode: "FAUCET_REQUEST_NOT_FOUND", statusCode: 404 });
  });
});
