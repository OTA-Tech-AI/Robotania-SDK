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
  const { walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  return walletClient.writeContract({
    account,
    chain,
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
  const { walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  return walletClient.writeContract({
    account,
    chain,
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
  const { publicClient, walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  const allowance = await readErc20Allowance(publicClient, {
    token: params.token,
    owner: wallet.address,
    spender: params.spender,
  });
  if (allowance >= params.amount) {
    return { alreadySufficient: true };
  }
  const txHash = await walletClient.writeContract({
    account,
    chain,
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
  const { walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  return walletClient.writeContract({
    account,
    chain,
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
  const { walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  return walletClient.writeContract({
    account,
    chain,
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
  const { walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  return walletClient.writeContract({
    account,
    chain,
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
  const { walletClient, account, chain } = createAgentChainClients(wallet, {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
  });
  return walletClient.writeContract({
    account,
    chain,
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
