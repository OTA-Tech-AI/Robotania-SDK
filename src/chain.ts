// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
/**
 * Local wallet transactions and chain reads.
 * Approvals, stakes, manifests, transfers and refunds are signed locally.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  erc20Abi,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
  type ReplacementReturnType,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "./wallet.js";
import { configuredSigningChainId } from "./signing-chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function deploymentChainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Deployment chain ID must be a positive safe integer; set ROBOTANIA_CHAIN_ID explicitly if needed.");
  }
  return value;
}

function explicitChainId(): number {
  const chainId = configuredSigningChainId();
  if (chainId === undefined) {
    throw new Error("Set ROBOTANIA_CHAIN_ID or CHAIN_ID when supplying contract addresses without deployment discovery.");
  }
  return chainId;
}

const protocolMinStakeAbi = [
  {
    type: "function",
    name: "minCitizenStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const stakeVaultAbi = [
  {
    type: "function",
    name: "depositCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "depositOperational",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "collateralBalanceByCitizen",
    stateMutability: "view",
    inputs: [{ name: "citizenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operationalBalanceByCitizen",
    stateMutability: "view",
    inputs: [{ name: "citizenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawOperational",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "collateralToOperational",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "operationalToCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const updateManifestAbi = [
  {
    type: "function",
    name: "updateManifest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "citizenId", type: "uint256" },
      { name: "manifestHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
] as const;


export interface ResolvedChainAddresses {
  protocolConfig: `0x${string}`;
  citizenRegistry: `0x${string}`;
  citizenActionRelay: `0x${string}` | undefined;
  settlementToken: `0x${string}`;
  stakeVault: `0x${string}` | undefined;
  topicWaitlist: `0x${string}` | undefined;
  positionPool: `0x${string}` | undefined;
  chainId: number;
  /** Platform-supplied RPC URL from HTTP discovery. Undefined when resolved via env vars or local JSON. */
  rpcUrl?: string;
}

let _cachedAddresses: ResolvedChainAddresses | null = null;

/**
 * Priority: local ROBOTANIA_RPC_URL override → platform-discovered rpc_url → CHAIN_RPC_URL → SEPOLIA_RPC_URL → localhost.
 * Local override always wins so advanced users can point at their own node.
 */
export function getRpcUrl(): string {
  return (
    process.env.ROBOTANIA_RPC_URL ??
    _cachedAddresses?.rpcUrl ??
    process.env.CHAIN_RPC_URL ??
    process.env.SEPOLIA_RPC_URL ??
    "http://127.0.0.1:8545"
  );
}

/**
 * Load and cache chain addresses from environment variables, local JSON or the Read API.
 * Call before direct chain operations that need discovery. Later calls reuse the cached result.
 */
export async function preloadChainAddresses(): Promise<void> {
  if (_cachedAddresses) return;

  // 1. Explicit env vars (manual override / offline)
  const pe = process.env.ROBOTANIA_PROTOCOL_CONFIG as `0x${string}` | undefined;
  const ce = process.env.ROBOTANIA_CITIZEN_REGISTRY as `0x${string}` | undefined;
  const ae = process.env.ROBOTANIA_CITIZEN_ACTION_RELAY as `0x${string}` | undefined;
  const te = process.env.ROBOTANIA_SETTLEMENT_TOKEN as `0x${string}` | undefined;
  if (pe && ce && ae && te) {
    _cachedAddresses = {
      protocolConfig:  pe,
      citizenRegistry: ce,
      citizenActionRelay: ae,
      settlementToken: te,
      stakeVault:      process.env.ROBOTANIA_STAKE_VAULT as `0x${string}` | undefined,
      topicWaitlist:   process.env.ROBOTANIA_TOPIC_WAITLIST as `0x${string}` | undefined,
      positionPool:    process.env.ROBOTANIA_POSITION_POOL as `0x${string}` | undefined,
      chainId:         explicitChainId(),
    };
    return;
  }

  // 2. Local JSON file
  const jsonPath =
    process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH ??
    resolve(__dirname, "../../../ops/deployed-addresses.json");
  if (existsSync(jsonPath)) {
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
      contracts?: Record<string, string>;
      chainId?: number;
    };
    const c = raw.contracts ?? {};
    const protocolConfig = (pe ?? c.ProtocolConfig) as `0x${string}` | undefined;
    const citizenRegistry = (ce ?? c.CitizenRegistry) as `0x${string}` | undefined;
    const citizenActionRelay = (ae ?? c.CitizenActionRelay) as `0x${string}` | undefined;
    const settlementToken = (te ?? c.SettlementToken) as `0x${string}` | undefined;
    if (!protocolConfig || !citizenRegistry || !citizenActionRelay || !settlementToken) {
      throw new Error(
        `deployed-addresses.json at ${jsonPath} is missing ProtocolConfig, CitizenRegistry, CitizenActionRelay, or SettlementToken`,
      );
    }
    _cachedAddresses = {
      protocolConfig,
      citizenRegistry,
      citizenActionRelay,
      settlementToken,
      stakeVault:    (process.env.ROBOTANIA_STAKE_VAULT ?? c.StakeVault) as `0x${string}` | undefined,
      topicWaitlist: (process.env.ROBOTANIA_TOPIC_WAITLIST ?? c.TopicWaitlist) as `0x${string}` | undefined,
      positionPool:  (process.env.ROBOTANIA_POSITION_POOL ?? c.PositionPool) as `0x${string}` | undefined,
      chainId:       configuredSigningChainId() ?? deploymentChainId(raw.chainId),
    };
    return;
  }

  // 3. HTTP discovery from Read API
  const base = (process.env.ROBOTANIA_READ_API_URL ?? "").replace(/\/$/, "");
  if (!base) {
    throw new Error(
      "Cannot discover chain addresses: set ROBOTANIA_READ_API_URL or ROBOTANIA_PROTOCOL_CONFIG.",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/public/system/deployment`);
  } catch (err) {
    throw new Error(
      `Deployment discovery failed: could not reach ${base} (${(err as Error).message}). ` +
      `Check ROBOTANIA_READ_API_URL is reachable.`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Deployment discovery failed (HTTP ${res.status}) from ${base}. Check ROBOTANIA_READ_API_URL is reachable.`,
    );
  }
  const body = (await res.json()) as { data?: { chain_id?: number; rpc_url?: string; contracts?: Record<string, string> } };
  const data = body.data ?? {};
  const c = {
    ProtocolConfig: pe ?? data.contracts?.ProtocolConfig,
    CitizenRegistry: ce ?? data.contracts?.CitizenRegistry,
    CitizenActionRelay: ae ?? data.contracts?.CitizenActionRelay,
    SettlementToken: te ?? data.contracts?.SettlementToken,
  };
  const configuredChainId = configuredSigningChainId();
  const invalidDiscoveredChainId = !Number.isSafeInteger(data.chain_id) || Number(data.chain_id) <= 0;

  // Validate required fields before caching — fail fast with actionable error
  const missing = (["ProtocolConfig", "CitizenRegistry", "CitizenActionRelay", "SettlementToken"] as const).filter(
    (k) => !c[k] || !/^0x[0-9a-fA-F]{40}$/.test(c[k]),
  );
  if (missing.length > 0 || (configuredChainId === undefined && invalidDiscoveredChainId)) {
    throw new Error(
      `Deployment configuration contains invalid data for ${base}. ` +
      `Missing or malformed fields: ${[...missing, ...(configuredChainId === undefined && invalidDiscoveredChainId ? ["chain_id"] : [])].join(", ")}. ` +
      `Check the Read API deployment and configured address overrides.`,
    );
  }

  _cachedAddresses = {
    protocolConfig:  c.ProtocolConfig as `0x${string}`,
    citizenRegistry: c.CitizenRegistry as `0x${string}`,
    citizenActionRelay: c.CitizenActionRelay as `0x${string}`,
    settlementToken: c.SettlementToken as `0x${string}`,
    stakeVault:      (process.env.ROBOTANIA_STAKE_VAULT ?? data.contracts?.StakeVault) as `0x${string}` | undefined,
    topicWaitlist:   (process.env.ROBOTANIA_TOPIC_WAITLIST ?? data.contracts?.TopicWaitlist) as `0x${string}` | undefined,
    positionPool:    (process.env.ROBOTANIA_POSITION_POOL ?? data.contracts?.PositionPool) as `0x${string}` | undefined,
    chainId:         configuredChainId ?? deploymentChainId(data.chain_id),
    rpcUrl:          data.rpc_url,  // platform-supplied; no private key
  };
}

/**
 * Return cached addresses, or resolve synchronous environment/local-file configuration.
 * For Read API discovery, call preloadChainAddresses() first.
 */
export function resolveChainAddresses(): ResolvedChainAddresses {
  if (_cachedAddresses) return _cachedAddresses;

  // Sync fallback: env vars
  const pe = process.env.ROBOTANIA_PROTOCOL_CONFIG as `0x${string}` | undefined;
  const ce = process.env.ROBOTANIA_CITIZEN_REGISTRY as `0x${string}` | undefined;
  const te = process.env.ROBOTANIA_SETTLEMENT_TOKEN as `0x${string}` | undefined;
  const sve = process.env.ROBOTANIA_STAKE_VAULT as `0x${string}` | undefined;
  const twe = process.env.ROBOTANIA_TOPIC_WAITLIST as `0x${string}` | undefined;
  const ppe = process.env.ROBOTANIA_POSITION_POOL as `0x${string}` | undefined;
  const are = process.env.ROBOTANIA_CITIZEN_ACTION_RELAY as `0x${string}` | undefined;
  if (pe && ce && te && are) {
    return {
      protocolConfig:  pe,
      citizenRegistry: ce,
      citizenActionRelay: are,
      settlementToken: te,
      stakeVault:      sve,
      topicWaitlist:   twe,
      positionPool:    ppe,
      chainId:         explicitChainId(),
    };
  }

  // Sync fallback: local JSON
  const path =
    process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH ??
    resolve(__dirname, "../../../ops/deployed-addresses.json");

  if (!existsSync(path)) {
    throw new Error(
      "Missing chain addresses: set ROBOTANIA_PROTOCOL_CONFIG, ROBOTANIA_CITIZEN_REGISTRY, " +
        "ROBOTANIA_CITIZEN_ACTION_RELAY, ROBOTANIA_SETTLEMENT_TOKEN, or ROBOTANIA_READ_API_URL " +
        "(for HTTP discovery via preloadChainAddresses).",
    );
  }

  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    contracts?: Record<string, string>;
    chainId?: number;
  };
  const c = raw.contracts ?? {};
  const protocolConfig = (pe ?? c.ProtocolConfig) as `0x${string}` | undefined;
  const citizenRegistry = (ce ?? c.CitizenRegistry) as `0x${string}` | undefined;
  const citizenActionRelay = (are ?? c.CitizenActionRelay) as `0x${string}` | undefined;
  const settlementToken = (te ?? c.SettlementToken) as `0x${string}` | undefined;

  if (!protocolConfig || !citizenRegistry || !citizenActionRelay || !settlementToken) {
    throw new Error(`deployed-addresses.json at ${path} missing ProtocolConfig, CitizenRegistry, CitizenActionRelay, or SettlementToken`);
  }

  return {
    protocolConfig,
    citizenRegistry,
    citizenActionRelay,
    settlementToken,
    stakeVault:    (sve ?? c.StakeVault) as `0x${string}` | undefined,
    topicWaitlist: (twe ?? c.TopicWaitlist) as `0x${string}` | undefined,
    positionPool:  (ppe ?? c.PositionPool) as `0x${string}` | undefined,
    chainId:       configuredSigningChainId() ?? deploymentChainId(raw.chainId),
  };
}

function defineRobotaniaChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: "Robotania",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export interface AgentChainClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  chain: Chain;
  chainId: number;
  rpcUrl: string;
}

/** Public + wallet clients bound to the agent's private key. */
export function createAgentChainClients(
  wallet: AgentWallet,
  overrides?: { rpcUrl?: string; chainId?: number },
): AgentChainClients {
  const rpcUrl = overrides?.rpcUrl ?? getRpcUrl();
  const chainId = overrides?.chainId ?? resolveChainAddresses().chainId;
  const chain = defineRobotaniaChain(chainId, rpcUrl);
  const account = privateKeyToAccount(wallet.privateKey);
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account,
    chain,
    transport,
  });

  return { publicClient, walletClient, account, chain, chainId, rpcUrl };
}

// ─── Transaction Manager ──────────────────────────────────────────────────────

const TX_MAX_RETRIES = 3;
const TX_RECEIPT_TIMEOUT_MS = 90_000;
const TX_POLL_INTERVAL_MS = 3_000;
const TX_POLL_ATTEMPTS = 3;

type ChainTxParams = {
  address: `0x${string}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: readonly any[];
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: readonly any[];
  onBroadcast?: (nonce: number, hash?: `0x${string}`) => void | Promise<void>;
};

function isNonRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("execution reverted") ||
    msg.includes("reverted with reason") ||
    msg.includes("insufficient funds") ||
    msg.includes("nonce too low")
  );
}

async function pollForReceipt(
  publicClient: PublicClient,
  txHash: `0x${string}`,
): Promise<Pick<TransactionReceipt, "status" | "transactionHash"> | null> {
  for (let i = 0; i < TX_POLL_ATTEMPTS; i++) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      if (receipt) return receipt;
    } catch {
      // not yet indexed — continue polling
    }
  }
  return null;
}

async function resolveEip1559Fees(
  publicClient: PublicClient,
  multiplier: bigint,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  try {
    const feeData = await publicClient.estimateFeesPerGas();
    if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
      return {
        maxFeePerGas: (feeData.maxFeePerGas * multiplier) / 100n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * multiplier) / 100n,
      };
    }
  } catch {
    // fall through to legacy
  }
  // Legacy fallback (eth_gasPrice) — used when EIP-1559 fee data is unavailable
  const gasPrice = await publicClient.getGasPrice();
  const boosted = (gasPrice * multiplier) / 100n;
  return { maxFeePerGas: boosted, maxPriorityFeePerGas: boosted / 10n };
}

/**
 * Broadcast a contract write with automatic gas buffer, pinned nonce, EIP-1559 fee estimation
 * (with legacy fallback), and replace-by-fee retry on timeout.
 *
 * Nonce is derived once from `eth_getTransactionCount(pending)` and pinned for all bump retries,
 * ensuring replacements target the same mempool slot rather than issuing new transactions.
 *
 * Callers must not supply `fixedNonce` or `attempt` — they control retry behavior.
 */
async function sendChainTx(
  clients: AgentChainClients,
  txParams: ChainTxParams,
  fixedNonce?: number,
  attempt = 0,
): Promise<`0x${string}`> {
  const { publicClient, walletClient, account, chain } = clients;

  // Nonce — read once on first attempt, pinned for all bump retries
  const nonce =
    fixedNonce ??
    (await publicClient.getTransactionCount({ address: account.address as `0x${string}`, blockTag: "pending" }));

  // Gas estimate with 30% buffer; non-retryable errors (e.g. revert simulation) surface immediately
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const estimatedGas = await (publicClient.estimateContractGas as any)({
    account,
    address: txParams.address,
    abi: txParams.abi,
    functionName: txParams.functionName,
    args: txParams.args ?? [],
  });
  const gas = ((estimatedGas as bigint) * 130n) / 100n;

  // EIP-1559 fees: base +30%, then additional +30% per retry attempt (attempt 0 → ×1.3, 1 → ×1.6, …)
  const feeMultiplier = 130n + BigInt(attempt) * 30n;
  const { maxFeePerGas, maxPriorityFeePerGas } = await resolveEip1559Fees(publicClient, feeMultiplier);

  // Broadcast
  let txHash: `0x${string}`;
  if (txParams.onBroadcast) await txParams.onBroadcast(nonce);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txHash = await (walletClient.writeContract as any)({
      account,
      chain,
      nonce,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      address: txParams.address,
      abi: txParams.abi,
      functionName: txParams.functionName,
      args: txParams.args ?? [],
    });
  } catch (broadcastErr) {
    if (isNonRetryableError(broadcastErr)) throw broadcastErr;
    if (attempt >= TX_MAX_RETRIES) throw broadcastErr;
    await new Promise<void>((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
    return sendChainTx(clients, txParams, nonce, attempt + 1);
  }
  if (txParams.onBroadcast) await txParams.onBroadcast(nonce, txHash);

  // Handle confirmed outcomes outside the retry path.
  let replacement: ReplacementReturnType | undefined;
  let receipt: Pick<TransactionReceipt, "status" | "transactionHash">;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: TX_RECEIPT_TIMEOUT_MS,
      onReplaced: info => { replacement = info; },
    });
  } catch {
    // Poll to confirm not already mined before issuing a replacement (prevents double-spend)
    const mined = await pollForReceipt(publicClient, txHash);
    if (mined) {
      receipt = mined;
    } else {
      if (attempt >= TX_MAX_RETRIES) {
        throw new Error(
          `Transaction unconfirmed after ${TX_MAX_RETRIES} retries. Last tx: ${txHash}. ` +
            `Check the block explorer for the current status.`,
        );
      }
      // Replace-by-fee: same nonce, higher fees on next attempt
      return sendChainTx(clients, txParams, nonce, attempt + 1);
    }
  }

  const minedHash = receipt.transactionHash;
  if (!minedHash || (replacement ? minedHash !== replacement.transactionReceipt.transactionHash : minedHash !== txHash)) {
    throw new ChainTransactionUncertainError(account.address, clients.chainId, nonce, txHash,
      new Error("Receipt does not identify the submitted transaction or a verified replacement."));
  }
  if (replacement && replacement.reason !== "repriced") {
    throw new ChainTransactionReplacedError(account.address, clients.chainId, nonce, txHash, minedHash, replacement.reason);
  }
  if (receipt.status === "reverted") throw new Error(`Transaction reverted on-chain: ${minedHash}`);
  if (minedHash !== txHash && txParams.onBroadcast) await txParams.onBroadcast(nonce, minedHash);
  return minedHash;
}

export async function readErc20Allowance(
  publicClient: PublicClient,
  params: { token: `0x${string}`; owner: `0x${string}`; spender: `0x${string}` },
): Promise<bigint> {
  return publicClient.readContract({
    address: params.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.owner, params.spender],
  });
}

/** Approve `spender` for `amount` of `token`, signed by the agent wallet. */
export async function writeErc20Approve(
  wallet: AgentWallet,
  params: {
    token: `0x${string}`;
    spender: `0x${string}`;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  return sendChainTx(clients, {
    address: params.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [params.spender, params.amount],
  });
}

/**
 * Attach a manifest hash / metadata URI after registration — must be submitted from **your** citizen wallet.
 */
export async function writeUpdateManifest(
  wallet: AgentWallet,
  params: {
    citizenRegistry: `0x${string}`;
    citizenId: bigint | string;
    manifestHash: `0x${string}`;
    metadataURI: string;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  return sendChainTx(clients, {
    address: params.citizenRegistry,
    abi: updateManifestAbi,
    functionName: "updateManifest",
    args: [BigInt(params.citizenId), params.manifestHash, params.metadataURI],
  });
}

/** Minimum collateral for on-chain participation, in USDC base units. */
export async function readMinCitizenStake(
  publicClient: PublicClient,
  protocolConfig: `0x${string}`,
): Promise<bigint> {
  const raw = await publicClient.readContract({
    address: protocolConfig,
    abi: protocolMinStakeAbi,
    functionName: "minCitizenStake",
  });
  return raw as bigint;
}

/** Approve the requested token allowance if insufficient; otherwise submit no transaction. */
export async function ensureErc20Allowance(
  wallet: AgentWallet,
  params: {
    token: `0x${string}`;
    spender: `0x${string}`;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<{ txHash?: `0x${string}`; alreadySufficient: boolean }> {
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  const allowance = await readErc20Allowance(clients.publicClient, {
    token: params.token,
    owner: wallet.address,
    spender: params.spender,
  });
  if (allowance >= params.amount) {
    return { alreadySufficient: true };
  }
  const txHash = await sendChainTx(clients, {
    address: params.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [params.spender, params.amount],
  });
  return { txHash, alreadySufficient: false };
}

/** Move settlement tokens into the **collateral** side of your vault ledger. */
export async function writeDepositCollateral(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  return sendChainTx(clients, {
    address: params.stakeVault,
    abi: stakeVaultAbi,
    functionName: "depositCollateral",
    args: [BigInt(params.citizenId), params.amount],
  });
}

/** Move settlement tokens into the **operational** side of your vault ledger (pulls from this wallet after approval). */
export async function writeDepositOperational(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  return sendChainTx(clients, {
    address: params.stakeVault,
    abi: stakeVaultAbi,
    functionName: "depositOperational",
    args: [BigInt(params.citizenId), params.amount],
  });
}

async function writeStakeVaultEntry(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
    functionName: "withdrawCollateral" | "withdrawOperational" | "collateralToOperational" | "operationalToCollateral";
  },
): Promise<`0x${string}`> {
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  return sendChainTx(clients, {
    address: params.stakeVault,
    abi: stakeVaultAbi,
    functionName: params.functionName,
    args: [BigInt(params.citizenId), params.amount],
  });
}

/** A direct wallet transaction may have been submitted, but its outcome is unknown. */
export class ChainTransactionUncertainError extends Error {
  readonly code = "CHAIN_TRANSACTION_UNCERTAIN";

  constructor(
    readonly walletAddress: `0x${string}`,
    readonly chainId: number,
    readonly nonce: number,
    readonly txHash: `0x${string}` | null,
    cause: unknown,
  ) {
    super("Transaction outcome is unknown. Check its hash or this wallet's transaction nonce before retrying.", { cause });
    this.name = "ChainTransactionUncertainError";
  }
}

/** The wallet nonce was mined by a cancellation or a different operation. */
export class ChainTransactionReplacedError extends Error {
  readonly code = "CHAIN_TRANSACTION_REPLACED";

  constructor(
    readonly walletAddress: `0x${string}`,
    readonly chainId: number,
    readonly nonce: number,
    readonly originalTxHash: `0x${string}`,
    readonly txHash: `0x${string}`,
    readonly reason: "cancelled" | "replaced",
  ) {
    super(`Transaction ${reason}; the submitted transaction did not execute. Check replacement transaction ${txHash} before retrying.`);
    this.name = "ChainTransactionReplacedError";
  }
}

/** Claim a cancelled or expired game's spectator waitlist deposit into operational balance. */
export async function writeClaimWaitlistRefund(
  wallet: AgentWallet,
  params: {
    topicWaitlist: `0x${string}`;
    topicId: bigint | string;
    citizenId: bigint | string;
    rpcUrl?: string;
    chainId?: number;
    /** Persist each returned transaction hash, including fee replacements. */
    onSubmitted?: (hash: `0x${string}`) => void | Promise<void>;
  },
): Promise<`0x${string}`> {
  const id = (value: bigint | string, field: string): bigint => {
    if (typeof value !== "bigint" && (typeof value !== "string" || !/^\d+$/.test(value))) {
      throw new Error(`${field} must be a positive uint256`);
    }
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed >= 2n ** 256n) throw new Error(`${field} must be a positive uint256`);
    return parsed;
  };
  const topicId = id(params.topicId, "topicId");
  const citizenId = id(params.citizenId, "citizenId");
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.topicWaitlist) || /^0x0{40}$/i.test(params.topicWaitlist)) {
    throw new Error("A valid nonzero TopicWaitlist address is required");
  }
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  let nonce: number | undefined;
  let txHash: `0x${string}` | null = null;
  let attempts = 0;
  try {
    return await sendChainTx(clients, {
      address: params.topicWaitlist,
      abi: [{
        type: "function", name: "claimWaitlistRefund", stateMutability: "nonpayable",
        inputs: [{ name: "topicId", type: "uint256" }, { name: "citizenId", type: "uint256" }],
        outputs: [],
      }] as const,
      functionName: "claimWaitlistRefund",
      args: [topicId, citizenId],
      onBroadcast: async (currentNonce, hash) => {
        nonce = currentNonce;
        if (hash) {
          txHash = hash;
          await params.onSubmitted?.(hash);
        } else attempts++;
      },
    });
  } catch (error) {
    if (error instanceof ChainTransactionReplacedError || error instanceof ChainTransactionUncertainError) throw error;
    const reverted = error instanceof Error && error.message.startsWith("Transaction reverted on-chain:");
    if (nonce !== undefined && !reverted && (txHash !== null || attempts > 1 || !isNonRetryableError(error))) {
      throw new ChainTransactionUncertainError(clients.account.address, clients.chainId, nonce, txHash, error);
    }
    throw error;
  }
}

/** Withdraw collateral back to your registered citizen wallet address. */
export async function writeWithdrawCollateral(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  return writeStakeVaultEntry(wallet, { ...params, functionName: "withdrawCollateral" });
}

/** Withdraw operational vault balance back to your registered citizen wallet address. */
export async function writeWithdrawOperational(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  return writeStakeVaultEntry(wallet, { ...params, functionName: "withdrawOperational" });
}

export async function writeCollateralToOperational(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  return writeStakeVaultEntry(wallet, { ...params, functionName: "collateralToOperational" });
}

export async function writeOperationalToCollateral(
  wallet: AgentWallet,
  params: {
    stakeVault: `0x${string}`;
    citizenId: bigint | string;
    amount: bigint;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  return writeStakeVaultEntry(wallet, { ...params, functionName: "operationalToCollateral" });
}

/**
 * Transfer ERC-20 tokens from this SDK wallet to `to`.
 * `amount` uses the selected token's base units; `token` defaults to the arena settlement token.
 */
export async function writeWithdrawFromCitizenWallet(
  wallet: AgentWallet,
  params: {
    to: `0x${string}`;
    amount: bigint;
    token?: `0x${string}`;
    rpcUrl?: string;
    chainId?: number;
  },
): Promise<`0x${string}`> {
  const token = params.token ?? resolveChainAddresses().settlementToken;
  const clients = createAgentChainClients(wallet, { rpcUrl: params.rpcUrl, chainId: params.chainId });
  return sendChainTx(clients, {
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.to, params.amount],
  });
}

async function readStakeVaultCollateralOperational(
  publicClient: PublicClient,
  stakeVault: `0x${string}`,
  citizenId: bigint | string,
): Promise<{ collateral: bigint; operational: bigint }> {
  const [collateral, operational] = await Promise.all([
    publicClient.readContract({
      address: stakeVault,
      abi: stakeVaultAbi,
      functionName: "collateralBalanceByCitizen",
      args: [BigInt(citizenId)],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: stakeVault,
      abi: stakeVaultAbi,
      functionName: "operationalBalanceByCitizen",
      args: [BigInt(citizenId)],
    }) as Promise<bigint>,
  ]);
  return { collateral, operational };
}

/** Snapshot how much lives in collateral vs operational within the vault for one citizen ID. */
export async function readCitizenArenaBalances(
  publicClient: PublicClient,
  stakeVault: `0x${string}`,
  citizenId: bigint | string,
): Promise<{ collateral: bigint; operational: bigint }> {
  return readStakeVaultCollateralOperational(publicClient, stakeVault, citizenId);
}

/** How much settlement ERC-20 a wallet holds (use after withdrawals to sanity-check totals). */
export async function readCitizenWalletBalance(
  publicClient: PublicClient,
  settlementToken: `0x${string}`,
  walletAddress: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: settlementToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress],
  }) as Promise<bigint>;
}
