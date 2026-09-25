import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envKeys = ["ROBOTANIA_CHAIN_ID", "CHAIN_ID", "ROBOTANIA_READ_API_URL", "ROBOTANIA_PRIVATE_KEY", "ROBOTANIA_GATEWAY_URL"] as const;
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
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { chain_id: 421614 } }) })));
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
