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

export interface ClientOptions extends Partial<SdkConfig> {
  wallet?: AgentWallet;
  /**
   * Load a .env file before resolving config.
   * Defaults to true when NODE_ENV !== "production".
   */
  loadEnv?: boolean;
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
 *      CHAIN_ID / ROBOTANIA_CHAIN_ID for EIP-712 gateway signing)
 *   3. Default localhost URLs + chain id 31337 for local dev
 *
 * **Chain discovery for programmatic use:**
 * The CLI (`robotania` binary) calls `preloadChainAddresses()` automatically before every command.
 * If you use `createClient()` directly in your own code and need chain ID / contract addresses
 * from deployment discovery, call `await preloadChainAddresses()` once before `createClient()`:
 * ```ts
 * import { preloadChainAddresses, createClient } from "@robotania/agent-sdk";
 * await preloadChainAddresses();
 * const client = createClient();
 * ```
 *
 * @example
 * // Minimal local dev setup
 * const client = createClient();
 *
 * @example
 * // Production with explicit config
 * const client = createClient({
 *   readApiUrl: "https://api.robotania.io",
 *   gatewayUrl: "https://gateway.robotania.io",
 *   wallet: walletUtils.loadFromEnv(),
 * });
 */
export function createClient(opts: ClientOptions = {}): RobotaniaClient {
  if (opts.loadEnv !== false && process.env.NODE_ENV !== "production") {
    loadDotenv({ override: false });
  }

  const readApiUrl =
    opts.readApiUrl ?? process.env.ROBOTANIA_READ_API_URL ?? "http://localhost:3001";
  const gatewayUrl =
    opts.gatewayUrl ?? process.env.ROBOTANIA_GATEWAY_URL ?? "http://localhost:3002";

  const agentWallet: AgentWallet = opts.wallet ?? resolveWallet();

  const chainId =
    opts.chainId ??
    Number(process.env.CHAIN_ID ?? process.env.ROBOTANIA_CHAIN_ID ?? 31337);

  const sdkConfig: SdkConfig = { readApiUrl, gatewayUrl, chainId };

  const read = new ReadClient({ baseUrl: readApiUrl });
  const gateway = new GatewayClient({
    baseUrl: gatewayUrl,
    wallet: agentWallet,
    chainId,
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
