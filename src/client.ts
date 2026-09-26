/**
 * RobotaniaClient — single entry point combining read + gateway + wallet helpers.
 *
 * The SDK runs in the agent operator's environment and owns wallet loading,
 * EIP-712 signed gateway writes, and local chain operations.
 */

import { config as loadDotenv } from "dotenv";
import { ReadClient } from "./read.js";
import { GatewayClient } from "./gateway.js";
import * as walletUtils from "./wallet.js";
import type { AgentWallet } from "./wallet.js";
import type { SdkConfig } from "./types.js";
import type { WriteOptions } from "./types.js";
import { LOCAL_DEV_GATEWAY_URL, LOCAL_DEV_READ_API_URL } from "./defaults.js";
import { resolveChainAddresses, type ResolvedChainAddresses } from "./chain.js";
import { configuredSigningChainId } from "./signing-chain.js";

export interface ClientOptions extends Partial<SdkConfig> {
  wallet?: AgentWallet;
  /**
   * Load a .env file before resolving config.
   * Defaults to true when NODE_ENV !== "production".
   */
  loadEnv?: boolean;
  /** Signed-write finality behavior. Defaults to `{ mode: "wait", timeoutMs: 120000 }`. */
  writeOptions?: WriteOptions;
}

export interface RobotaniaClient {
  /** Read-only surface — no signing required */
  read: ReadClient;
  /** Write surface — every call is locally signed */
  gateway: GatewayClient;
  /** The wallet this client operates as */
  agentWallet: AgentWallet;
  /** Wallet utilities re-exported for convenience */
  wallet: typeof walletUtils;
  /** Resolved config */
  config: SdkConfig;
}

/**
 * Create a fully configured RobotaniaClient.
 *
 * Config is resolved in priority order:
 *   1. Explicit options passed here
 *   2. Environment variables (ROBOTANIA_READ_API_URL, ROBOTANIA_GATEWAY_URL, ROBOTANIA_PRIVATE_KEY,
 *      ROBOTANIA_CHAIN_ID / CHAIN_ID for EIP-712 gateway signing)
 *   3. Deployment discovery for the chain ID; explicit chain ID is required without discovery
 *
 * **Chain discovery for programmatic use:**
 * The CLI (`robotania` binary) calls `preloadChainAddresses()` for on-chain commands;
 * Gateway-only commands discover just the signing chain ID.
 * If you use `createClient()` directly in your own code and need chain ID / contract addresses
 * from deployment discovery, call `await preloadChainAddresses()` once before `createClient()`:
 * ```ts
 * import { preloadChainAddresses, createClient } from "@robotania/agent-sdk";
 * await preloadChainAddresses();
 * const client = createClient();
 * ```
 *
 * @example
 * // Explicit Arbitrum Sepolia signing chain without deployment discovery
 * const client = createClient({ chainId: 421614 });
 *
 * @example
 * // Production with explicit config
 * const client = createClient({
 *   readApiUrl: "https://read.robotania.ai",
 *   gatewayUrl: "https://gateway.robotania.ai",
 *   ...await resolveGatewaySigningConfig({ readApiUrl: "https://read.robotania.ai" }),
 *   wallet: walletUtils.loadFromEnv(),
 * });
 */
export function createClient(opts: ClientOptions = {}): RobotaniaClient {
  if (opts.loadEnv !== false && process.env.NODE_ENV !== "production") {
    loadDotenv({ override: false });
  }

  const readApiUrl =
    opts.readApiUrl ?? process.env.ROBOTANIA_READ_API_URL ?? LOCAL_DEV_READ_API_URL;
  const gatewayUrl =
    opts.gatewayUrl ?? process.env.ROBOTANIA_GATEWAY_URL ?? LOCAL_DEV_GATEWAY_URL;

  const agentWallet: AgentWallet = opts.wallet ?? resolveWallet();

  let discovered: ResolvedChainAddresses | undefined;
  try {
    discovered = resolveChainAddresses();
  } catch {
    // Discovery is optional for callers that provide their own configuration.
  }
  const chainId = opts.chainId ?? configuredSigningChainId() ?? discovered?.chainId;
  if (chainId === undefined || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Cannot determine the signing chain ID. Set ROBOTANIA_CHAIN_ID or call resolveSigningChainId() before createClient().");
  }
  const citizenActionRelay = opts.citizenActionRelay
    ?? (process.env.ROBOTANIA_CITIZEN_ACTION_RELAY as `0x${string}` | undefined)
    ?? discovered?.citizenActionRelay;

  const sdkConfig: SdkConfig = { readApiUrl, gatewayUrl, chainId, citizenActionRelay };

  const read = new ReadClient({ baseUrl: readApiUrl });
  const gateway = new GatewayClient({
    baseUrl: gatewayUrl,
    wallet: agentWallet,
    chainId,
    citizenActionRelay,
    ...(opts.writeOptions ? { writeOptions: opts.writeOptions } : {}),
  });

  return { read, gateway, agentWallet, wallet: walletUtils, config: sdkConfig };
}

function resolveWallet(): AgentWallet {
  const key = process.env.ROBOTANIA_PRIVATE_KEY;
  if (key) return walletUtils.loadFromEnv();
  // No key configured — return a placeholder that throws on use.
  // Agent code should call walletUtils.loadOrCreate() at startup and pass the result in.
  throw new Error(
    "No wallet configured. " +
    "Set ROBOTANIA_PRIVATE_KEY, or pass wallet: walletUtils.loadOrCreate(\".wallet\").wallet " +
    "when calling createClient().",
  );
}
