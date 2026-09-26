import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envKeys = ["ROBOTANIA_CHAIN_ID", "CHAIN_ID", "ROBOTANIA_READ_API_URL", "ROBOTANIA_PRIVATE_KEY", "ROBOTANIA_GATEWAY_URL", "ROBOTANIA_CITIZEN_ACTION_RELAY"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  vi.resetModules();
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

describe("Gateway signing chain ID", () => {
  it("automatically signs the second registration authorization after discovery", async () => {
    const { encodeFunctionData, keccak256, parseAbi, verifyTypedData } = await import("viem");
    const relay = "0x00000000000000000000000000000000000000a1" as const;
    const target = "0x00000000000000000000000000000000000000b2" as const;
    process.env.ROBOTANIA_PRIVATE_KEY = `0x${"11".repeat(32)}`;
    process.env.ROBOTANIA_READ_API_URL = "https://read.registration.example";
    process.env.ROBOTANIA_GATEWAY_URL = "https://gateway.registration.example";
    let authorizationPosts = 0;
    const deadline = String(Math.floor(Date.now() / 1000) + 600);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/system/signing-chain")) {
        return new Response(JSON.stringify({ data: { chain_id: 421614, citizen_action_relay: relay } }));
      }
      expect(new URL(url).pathname).toBe("/api/v1/agent/citizens/register");
      const body = JSON.parse(String(init?.body)) as { walletAddress: `0x${string}`; metadataURI: string; manifestHash: `0x${string}` };
      const calldata = encodeFunctionData({
        abi: parseAbi(["function registerCitizen(address wallet,string metadataURI,bytes32 manifestHash)"]),
        functionName: "registerCitizen",
        args: [body.walletAddress, body.metadataURI, body.manifestHash],
      });
      if (++authorizationPosts === 1) {
        return new Response(JSON.stringify({ error_code: "CITIZEN_ACTION_AUTHORIZATION_REQUIRED", preparation: {
          preparation_id: "registration-prep", citizen_id: null, chain_id: 421614,
          relay, target, calldata, calldata_hash: keccak256(calldata),
          authorization_version: "1", nonce: "1", deadline,
        } }), { status: 428 });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("x-agent-action-preparation")).toBe("registration-prep");
      expect(await verifyTypedData({
        address: body.walletAddress,
        domain: { name: "Robotania Citizen Action", version: "1", chainId: 421614, verifyingContract: relay },
        types: { RegistrationAction: [
          { name: "authorizationVersion", type: "uint64" }, { name: "wallet", type: "address" },
          { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" },
          { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        ] },
        primaryType: "RegistrationAction",
        message: { authorizationVersion: 1n, wallet: body.walletAddress, target, dataHash: keccak256(calldata), nonce: 1n, deadline: BigInt(deadline) },
        signature: headers.get("x-agent-action-signature") as `0x${string}`,
      })).toBe(true);
      return new Response(JSON.stringify({ ok: true, data: {
        request_id: "registration", action: "citizens/register", phase: "FINALIZED", tx_hash: null,
        status: "FINALIZED", terminal: true, next_action: "NONE", result: {},
      } }));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { loadGatewayOnlyConfig } = await import("../src/bin/cli/config.js");
    const cfg = await loadGatewayOnlyConfig();
    await expect(cfg.gatewayClient.registerCitizen({})).resolves.toMatchObject({ status: "FINALIZED" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(authorizationPosts).toBe(2);
  });

  it("supports explicit offline signing config without HTTP and rejects bad Relay overrides", async () => {
    process.env.ROBOTANIA_CHAIN_ID = "421614";
    process.env.ROBOTANIA_CITIZEN_ACTION_RELAY = "0x00000000000000000000000000000000000000a1";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveGatewaySigningConfig } = await import("../src/signing-chain.js");
    expect(await resolveGatewaySigningConfig()).toMatchObject({ chainId: 421614, citizenActionRelay: process.env.ROBOTANIA_CITIZEN_ACTION_RELAY });
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env.ROBOTANIA_CITIZEN_ACTION_RELAY = "0x0000000000000000000000000000000000000000";
    await expect(resolveGatewaySigningConfig()).rejects.toThrow(/nonzero/);
  });

  it("rejects missing Relay discovery and an explicit chain from another deployment", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: { chain_id: 421614 } })));
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveGatewaySigningConfig } = await import("../src/signing-chain.js");
    await expect(resolveGatewaySigningConfig({ readApiUrl: "https://read.no-relay.example" })).rejects.toThrow(/CitizenActionRelay/);
    process.env.ROBOTANIA_CHAIN_ID = "1";
    await expect(resolveGatewaySigningConfig({ readApiUrl: "https://read.no-relay.example" })).rejects.toThrow(/does not match/);
  });

  it("uses ROBOTANIA_CHAIN_ID before legacy CHAIN_ID without a network request", async () => {
    process.env.ROBOTANIA_CHAIN_ID = "421614";
    process.env.CHAIN_ID = "31337";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveSigningChainId } = await import("../src/signing-chain.js");
    expect(await resolveSigningChainId()).toBe(421614);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("supports an explicit offline local chain", async () => {
    process.env.CHAIN_ID = "31337";
    const { resolveSigningChainId } = await import("../src/signing-chain.js");
    expect(await resolveSigningChainId()).toBe(31337);
  });

  it("discovers only chain_id and caches the result for Practice and faucet", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ data: { chain_id: 421614 } }) }));
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveSigningChainId } = await import("../src/signing-chain.js");
    expect(await Promise.all([
      resolveSigningChainId({ readApiUrl: "https://read.example" }),
      resolveSigningChainId({ readApiUrl: "https://read.example" }),
    ])).toEqual([421614, 421614]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://read.example/api/v1/public/system/signing-chain");
  });

  it("passes the discovered ID into the CLI's signed Gateway config", async () => {
    process.env.ROBOTANIA_PRIVATE_KEY = `0x${"11".repeat(32)}`;
    process.env.ROBOTANIA_GATEWAY_URL = "https://gateway.example";
    process.env.ROBOTANIA_READ_API_URL = "https://read.example";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { chain_id: 421614, citizen_action_relay: "0x00000000000000000000000000000000000000a1" } }) })));
    const { loadGatewayOnlyConfig } = await import("../src/bin/cli/config.js");
    expect((await loadGatewayOnlyConfig()).chainId).toBe(421614);
  });

  it("rejects invalid overrides and missing or malformed discovery before signing", async () => {
    const { resolveSigningChainId } = await import("../src/signing-chain.js");
    process.env.ROBOTANIA_CHAIN_ID = "0";
    await expect(resolveSigningChainId()).rejects.toThrow(/positive safe integer/);
    delete process.env.ROBOTANIA_CHAIN_ID;

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { chain_id: "421614" } }) })));
    await expect(resolveSigningChainId({ readApiUrl: "https://read.example" })).rejects.toThrow(/positive safe integer/);
  });

  it("fails closed on an unreachable Read API and permits a later retry", async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { chain_id: 421614 } }) });
    vi.stubGlobal("fetch", fetchSpy);
    const { resolveSigningChainId } = await import("../src/signing-chain.js");
    await expect(resolveSigningChainId({ readApiUrl: "https://read.example" })).rejects.toThrow(/Could not discover/);
    expect(await resolveSigningChainId({ readApiUrl: "https://read.example" })).toBe(421614);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports a Read API timeout before any signed request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("The operation was aborted", "TimeoutError"); }));
    const { resolveSigningChainId } = await import("../src/signing-chain.js");
    await expect(resolveSigningChainId({ readApiUrl: "https://read.example" })).rejects.toThrow(/Could not discover the signing chain ID/);
  });
});
