import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We import these after resetting env / stubs in each test.
// Dynamic imports ensure the module cache is fresh for each test group.
// NOTE: Because _cachedAddresses is module-level, we reset it via env tricks
// and rely on per-describe isolation where possible.

const VALID_ADDR = "0xaAbBcCdDeEfF0011223344556677889900aAbBcC";
const VALID_CONTRACTS = {
  ProtocolConfig:   "0x1111111111111111111111111111111111111111",
  CitizenRegistry:  "0x2222222222222222222222222222222222222222",
  SettlementToken:  "0x3333333333333333333333333333333333333333",
  StakeVault:       "0x4444444444444444444444444444444444444444",
  TopicWaitlist:    "0x5555555555555555555555555555555555555555",
  PositionPool:     "0x6666666666666666666666666666666666666666",
};

function makeDeploymentJson(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    chainId: 421614,
    network: "arbitrum-sepolia",
    contracts: VALID_CONTRACTS,
    ...overrides,
  });
}

function mockFetchOk(rpc_url = "https://sepolia-rollup.arbitrum.io/rpc") {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: {
        chain_id: 421614,
        network:  "arbitrum-sepolia",
        rpc_url,
        contracts: VALID_CONTRACTS,
      },
    }),
  })) as unknown as typeof fetch;
}

function mockFetchFail(status = 503) {
  return vi.fn(async () => ({
    ok:     false,
    status,
    json:   async () => ({ ok: false, error: "not configured" }),
  })) as unknown as typeof fetch;
}

// Helper: reset module cache between tests by re-importing chain.ts after env manipulation.
// We use inline dynamic import + module isolation provided by vitest.
async function freshChain() {
  // Vitest isolates module registry per test file when using `vi.resetModules`.
  vi.resetModules();
  return import("../src/chain.js");
}

describe("chain-discovery: env vars override (no fetch)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ROBOTANIA_PROTOCOL_CONFIG   = VALID_CONTRACTS.ProtocolConfig;
    process.env.ROBOTANIA_CITIZEN_REGISTRY  = VALID_CONTRACTS.CitizenRegistry;
    process.env.ROBOTANIA_SETTLEMENT_TOKEN  = VALID_CONTRACTS.SettlementToken;
    process.env.ROBOTANIA_CHAIN_ID          = "999";
  });

  afterEach(() => {
    delete process.env.ROBOTANIA_PROTOCOL_CONFIG;
    delete process.env.ROBOTANIA_CITIZEN_REGISTRY;
    delete process.env.ROBOTANIA_SETTLEMENT_TOKEN;
    delete process.env.ROBOTANIA_CHAIN_ID;
    vi.unstubAllGlobals();
  });

  it("resolves from env vars without any fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { preloadChainAddresses, resolveChainAddresses } = await freshChain();
    await preloadChainAddresses();
    const addrs = resolveChainAddresses();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(addrs.protocolConfig).toBe(VALID_CONTRACTS.ProtocolConfig);
    expect(addrs.citizenRegistry).toBe(VALID_CONTRACTS.CitizenRegistry);
    expect(addrs.chainId).toBe(999);
  });
});

describe("chain-discovery: local JSON fallback (no fetch)", () => {
  let jsonPath: string;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ROBOTANIA_PROTOCOL_CONFIG;
    delete process.env.ROBOTANIA_CITIZEN_REGISTRY;
    delete process.env.ROBOTANIA_SETTLEMENT_TOKEN;

    const dir = join(tmpdir(), `chain-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    jsonPath = join(dir, "deployed-addresses.json");
    writeFileSync(jsonPath, makeDeploymentJson(), "utf-8");
    process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH = jsonPath;
  });

  afterEach(() => {
    delete process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH;
    vi.unstubAllGlobals();
  });

  it("resolves from local JSON without any fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { preloadChainAddresses, resolveChainAddresses } = await freshChain();
    await preloadChainAddresses();
    const addrs = resolveChainAddresses();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(addrs.protocolConfig).toBe(VALID_CONTRACTS.ProtocolConfig);
    expect(addrs.chainId).toBe(421614);
  });
});

describe("chain-discovery: HTTP discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ROBOTANIA_PROTOCOL_CONFIG;
    delete process.env.ROBOTANIA_CITIZEN_REGISTRY;
    delete process.env.ROBOTANIA_SETTLEMENT_TOKEN;
    delete process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH;
    process.env.ROBOTANIA_READ_API_URL = "http://test-api.example";
  });

  afterEach(() => {
    delete process.env.ROBOTANIA_READ_API_URL;
    vi.unstubAllGlobals();
  });

  it("resolves via HTTP discovery and stores rpcUrl in cache", async () => {
    vi.stubGlobal("fetch", mockFetchOk("https://custom-rpc.example/rpc"));

    const { preloadChainAddresses, resolveChainAddresses } = await freshChain();
    await preloadChainAddresses();
    const addrs = resolveChainAddresses();

    expect(addrs.protocolConfig).toBe(VALID_CONTRACTS.ProtocolConfig);
    expect(addrs.chainId).toBe(421614);
    expect(addrs.rpcUrl).toBe("https://custom-rpc.example/rpc");
  });

  it("throws with actionable message on HTTP failure", async () => {
    vi.stubGlobal("fetch", mockFetchFail(503));

    const { preloadChainAddresses } = await freshChain();
    await expect(preloadChainAddresses()).rejects.toThrow(/HTTP 503/);
  });

  it("throws with actionable message when response has invalid contract data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok:   true,
      json: async () => ({
        ok:   true,
        data: {
          chain_id:  421614,
          rpc_url:   "https://rpc",
          contracts: { ProtocolConfig: "not-an-address" }, // bad
        },
      }),
    })) as unknown as typeof fetch);

    const { preloadChainAddresses } = await freshChain();
    await expect(preloadChainAddresses()).rejects.toThrow(/invalid data/);
  });
});

describe("chain-discovery: no READ_API_URL and no fallbacks", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ROBOTANIA_PROTOCOL_CONFIG;
    delete process.env.ROBOTANIA_CITIZEN_REGISTRY;
    delete process.env.ROBOTANIA_SETTLEMENT_TOKEN;
    // Point at a guaranteed non-existent path so the local JSON fallback is
    // deterministically skipped regardless of repo state on this machine.
    process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH = "/nonexistent/deployed-addresses.json";
    delete process.env.ROBOTANIA_READ_API_URL;
  });

  afterEach(() => {
    delete process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH;
  });

  it("throws with actionable message when nothing is configured", async () => {
    const { preloadChainAddresses } = await freshChain();
    await expect(preloadChainAddresses()).rejects.toThrow(
      /ROBOTANIA_READ_API_URL|ROBOTANIA_PROTOCOL_CONFIG/,
    );
  });
});

describe("chain-discovery: getRpcUrl priority", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ROBOTANIA_RPC_URL;
    delete process.env.ROBOTANIA_PROTOCOL_CONFIG;
    delete process.env.ROBOTANIA_CITIZEN_REGISTRY;
    delete process.env.ROBOTANIA_SETTLEMENT_TOKEN;
    delete process.env.ROBOTANIA_READ_API_URL;
    delete process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH;
    vi.unstubAllGlobals();
  });

  it("local ROBOTANIA_RPC_URL overrides discovered rpcUrl", async () => {
    process.env.ROBOTANIA_RPC_URL     = "https://my-own-node.example";
    process.env.ROBOTANIA_READ_API_URL = "http://test-api.example";
    vi.stubGlobal("fetch", mockFetchOk("https://platform-rpc.example"));

    const { preloadChainAddresses, getRpcUrl } = await freshChain();
    await preloadChainAddresses();

    expect(getRpcUrl()).toBe("https://my-own-node.example");
  });

  it("falls back to discovered rpcUrl when no local override is set", async () => {
    delete process.env.ROBOTANIA_RPC_URL;
    process.env.ROBOTANIA_READ_API_URL = "http://test-api.example";
    vi.stubGlobal("fetch", mockFetchOk("https://platform-rpc.example"));

    const { preloadChainAddresses, getRpcUrl } = await freshChain();
    await preloadChainAddresses();

    expect(getRpcUrl()).toBe("https://platform-rpc.example");
  });

  it("falls back to public Arbitrum default when discovery omits rpc_url", async () => {
    delete process.env.ROBOTANIA_RPC_URL;
    process.env.ROBOTANIA_READ_API_URL = "http://test-api.example";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok:   true,
      json: async () => ({
        ok:   true,
        data: {
          chain_id:  421614,
          // rpc_url omitted deliberately
          contracts: VALID_CONTRACTS,
        },
      }),
    })) as unknown as typeof fetch);

    const { preloadChainAddresses, getRpcUrl } = await freshChain();
    await preloadChainAddresses();

    // Should not crash; falls back to env chain fallbacks or hardcoded default
    expect(() => getRpcUrl()).not.toThrow();
    const url = getRpcUrl();
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });
});
