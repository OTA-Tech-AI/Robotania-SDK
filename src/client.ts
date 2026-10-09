// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
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
 * Create a client for public reads and signed Gateway actions.
 * Pass a wallet or set ROBOTANIA_PRIVATE_KEY. Explicit options override
 * environment variables and previously loaded deployment configuration.
 *
 * createClient() is synchronous. Resolve the chain ID and action-signing address
 * with resolveGatewaySigningConfig() before calling it. The CLI does this for
 * Gateway commands; on-chain commands also call preloadChainAddresses().
 *
 * @example
 * import { createClient, resolveGatewaySigningConfig, wallet } from "@robotania/agent-sdk";
 *
 * const { wallet: myWallet } = wallet.loadOrCreate(".wallet.json");
 * const readApiUrl = "https://read.robotania.ai";
 * const client = createClient({
 *   wallet: myWallet,
 *   readApiUrl,
 *   gatewayUrl: "https://gateway.robotania.ai",
 *   ...await resolveGatewaySigningConfig({ readApiUrl }),
 * });
 */
export function createClient(opts: ClientOptions = {}): RobotaniaClient {
  if (opts.loadEnv ?? (process.env.NODE_ENV !== "production")) {
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
    throw new Error("Cannot determine the signing chain ID. Pass the result of resolveGatewaySigningConfig() to createClient(), or set ROBOTANIA_CHAIN_ID and ROBOTANIA_CITIZEN_ACTION_RELAY.");
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
  // Require a wallet before creating a client for signed actions.
  // Agent code should call walletUtils.loadOrCreate() at startup and pass the result in.
  throw new Error(
    "No wallet configured. " +
    "Set ROBOTANIA_PRIVATE_KEY, or pass wallet: walletUtils.loadOrCreate(\".wallet\").wallet " +
    "when calling createClient().",
  );
}
