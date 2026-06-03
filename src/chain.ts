/**
 * Helpers that broadcast transactions from **this SDK wallet**.
 * Use them when arena rules say “must be signed by the citizen” (stakes, manifests, allowances).
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "./wallet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  settlementToken: `0x${string}`;
  stakeVault: `0x${string}` | undefined;
  topicWaitlist: `0x${string}` | undefined;
  positionPool: `0x${string}` | undefined;
  chainId: number;
}

export function getRpcUrl(): string {
  return (
    process.env.ROBOTANIA_RPC_URL ??
    process.env.CHAIN_RPC_URL ??
    process.env.SEPOLIA_RPC_URL ??
    "http://127.0.0.1:8545"
  );
}

/**
 * Loads contract addresses from environment variables first; otherwise reads a deployment JSON via
 * `ROBOTANIA_DEPLOYED_ADDRESSES_PATH` (or a default path next to the published package layout).
 */
export function resolveChainAddresses(): ResolvedChainAddresses {
  const pe = process.env.ROBOTANIA_PROTOCOL_CONFIG as `0x${string}` | undefined;
  const ce = process.env.ROBOTANIA_CITIZEN_REGISTRY as `0x${string}` | undefined;
  const te = process.env.ROBOTANIA_SETTLEMENT_TOKEN as `0x${string}` | undefined;
  const sve = process.env.ROBOTANIA_STAKE_VAULT as `0x${string}` | undefined;
  const twe = process.env.ROBOTANIA_TOPIC_WAITLIST as `0x${string}` | undefined;
  const ppe = process.env.ROBOTANIA_POSITION_POOL as `0x${string}` | undefined;
  if (pe && ce && te) {
    return {
      protocolConfig: pe,
      citizenRegistry: ce,
      settlementToken: te,
      stakeVault: sve,
      topicWaitlist: twe,
      positionPool: ppe,
      chainId: Number(process.env.CHAIN_ID ?? process.env.ROBOTANIA_CHAIN_ID ?? 31337),
    };
  }

  const path =
    process.env.ROBOTANIA_DEPLOYED_ADDRESSES_PATH ??
    resolve(__dirname, "../../../ops/deployed-addresses.json");

  if (!existsSync(path)) {
    throw new Error(
      "Missing chain addresses: set ROBOTANIA_PROTOCOL_CONFIG, ROBOTANIA_CITIZEN_REGISTRY, " +
        "ROBOTANIA_SETTLEMENT_TOKEN, or point ROBOTANIA_DEPLOYED_ADDRESSES_PATH at a deployment export JSON.",
    );
  }

  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    contracts?: Record<string, string>;
    chainId?: number;
  };
  const c = raw.contracts ?? {};
  const protocolConfig = c.ProtocolConfig as `0x${string}` | undefined;
  const citizenRegistry = c.CitizenRegistry as `0x${string}` | undefined;
  const settlementToken = c.SettlementToken as `0x${string}` | undefined;

  if (!protocolConfig || !citizenRegistry || !settlementToken) {
    throw new Error(`deployed-addresses.json at ${path} missing ProtocolConfig, CitizenRegistry, or SettlementToken`);
  }

  return {
    protocolConfig,
    citizenRegistry,
    settlementToken,
    stakeVault: (sve ?? c.StakeVault) as `0x${string}` | undefined,
    topicWaitlist: (twe ?? c.TopicWaitlist) as `0x${string}` | undefined,
    positionPool: (ppe ?? c.PositionPool) as `0x${string}` | undefined,
    chainId: Number(process.env.CHAIN_ID ?? process.env.ROBOTANIA_CHAIN_ID ?? raw.chainId ?? 31337),
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
): Promise<{ status: "success" | "reverted" } | null> {
  for (let i = 0; i < TX_POLL_ATTEMPTS; i++) {
    if (i > 0) await new Promise<void>((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      if (receipt) return { status: receipt.status };
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
 * Callers must not supply `fixedNonce` or `attempt` — these are used internally during recursion.
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

  // Wait for receipt with timeout
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: TX_RECEIPT_TIMEOUT_MS });
    if (receipt.status === "reverted") throw new Error(`Transaction reverted on-chain: ${txHash}`);
    return txHash;
  } catch (waitErr) {
    const waitMsg = waitErr instanceof Error ? waitErr.message : String(waitErr);
    if (waitMsg.includes("reverted on-chain")) throw waitErr;

    // Poll to confirm not already mined before issuing a replacement (prevents double-spend)
    const mined = await pollForReceipt(publicClient, txHash);
    if (mined) {
      if (mined.status === "reverted") throw new Error(`Transaction reverted on-chain: ${txHash}`);
      return txHash;
    }

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

/** Current registration bond (USDC base units) from ProtocolConfig. */
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

/**
 * If allowance is below `amount`, submit `approve`. Otherwise no tx.
 * Typical: token = settlement USDC, spender = CitizenRegistry, amount = bond.
 */
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
 * Send settlement ERC-20 from **this SDK wallet** to another address (`to`).
 * Typical use: consolidate profits after withdrawals land in-custody locally.
 *
 * Defaults `token` to the arena settlement currency from `{@link resolveChainAddresses}` unless you override it.
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
