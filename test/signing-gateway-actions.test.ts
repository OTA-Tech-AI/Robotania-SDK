import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, verifyTypedData } from "viem";
import { GatewayClient } from "../src/gateway.js";
import { resolveSigningChainId } from "../src/signing-chain.js";
import { AGENT_REQUEST_TYPES, buildRobotaniaDomain } from "../src/signing.js";
import { createRandom } from "../src/wallet.js";

const savedChainId = process.env.ROBOTANIA_CHAIN_ID;
const savedLegacyChainId = process.env.CHAIN_ID;

beforeEach(() => {
  delete process.env.ROBOTANIA_CHAIN_ID;
  delete process.env.CHAIN_ID;
});

afterEach(() => {
  if (savedChainId === undefined) delete process.env.ROBOTANIA_CHAIN_ID;
  else process.env.ROBOTANIA_CHAIN_ID = savedChainId;
  if (savedLegacyChainId === undefined) delete process.env.CHAIN_ID;
  else process.env.CHAIN_ID = savedLegacyChainId;
  vi.unstubAllGlobals();
});

describe("discovered Gateway signing domain", () => {
  it("signs registration, Practice join, and faucet requests for Arbitrum Sepolia", async () => {
    const wallet = createRandom();
    const signedPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/public/system/signing-chain")) {
        return new Response(JSON.stringify({ ok: true, data: { chain_id: 421614 } }), { status: 200 });
      }

      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      const body = String(init?.body ?? "");
      const valid = await verifyTypedData({
        address: wallet.address,
        domain: buildRobotaniaDomain(421614),
        types: AGENT_REQUEST_TYPES,
        primaryType: "AgentRequest",
        message: {
          method: "POST",
          path,
          citizenId: headers.get("x-agent-citizen-id") ?? "",
          nonce: headers.get("x-agent-nonce") ?? "",
          deadline: BigInt(headers.get("x-agent-deadline") ?? "0"),
          payloadHash: keccak256(toBytes(body)),
        },
        signature: (headers.get("x-agent-signature") ?? "0x") as `0x${string}`,
      });
      expect(valid).toBe(true);
      signedPaths.push(path);

      const faucet = path === "/api/v1/agent/faucet/requests";
      const data = faucet
        ? { request_id: "req-faucet", action: "faucet/request", citizen_id: "pending", wallet_address: wallet.address, status: "FINALIZED", terminal: true, phase: "FINALIZED", next_action: "NONE", cooldown_until: null, assets: [] }
        : { request_id: `req-${signedPaths.length}`, action: path, status: "FINALIZED", terminal: true, phase: "FINALIZED", tx_hash: null, result: {}, next_action: "NONE" };
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    }) as unknown as typeof fetch);

    const chainId = await resolveSigningChainId({ readApiUrl: "https://read.signing-test.example" });
    const client = new GatewayClient({ baseUrl: "https://gateway.signing-test.example", wallet, chainId });
    await client.registerCitizen({});
    await client.joinPracticeArena({ practiceArenaId: "P1" });
    await client.requestFaucet({ assets: ["USDC"] });

    expect(signedPaths).toEqual([
      "/api/v1/agent/citizens/register",
      "/api/v1/agent/practice/arenas/join",
      "/api/v1/agent/faucet/requests",
    ]);
  });
});
