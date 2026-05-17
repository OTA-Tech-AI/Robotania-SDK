/**
 * Local chain calls — signed by the agent wallet (not the gateway relay).
 * Use for: ERC20 approve/allowance, CitizenRegistry.updateManifest (requires msg.sender == citizen wallet).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "./wallet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal ERC20 — shared package does not ship IERC20 artifact. */
const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const protocolMinStakeAbi = [
  {
    type: "function",
    name: "minCitizenStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
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
 * Resolve deployment addresses from env vars or `packages/ops/deployed-addresses.json`
 * (same shape as gateway relay).
 */
export function resolveChainAddresses(): ResolvedChainAddresses {
  const pe = process.env.ROBOTANIA_PROTOCOL_CONFIG as `0x${string}` | undefined;
  const ce = process.env.ROBOTANIA_CITIZEN_REGISTRY as `0x${string}` | undefined;
  const te = process.env.ROBOTANIA_SETTLEMENT_TOKEN as `0x${string}` | undefined;
  const twe = process.env.ROBOTANIA_TOPIC_WAITLIST as `0x${string}` | undefined;
  const ppe = process.env.ROBOTANIA_POSITION_POOL as `0x${string}` | undefined;
  if (pe && ce && te) {
    return {
      protocolConfig: pe,
      citizenRegistry: ce,
      settlementToken: te,
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
        "ROBOTANIA_SETTLEMENT_TOKEN, or place packages/ops/deployed-addresses.json (or ROBOTANIA_DEPLOYED_ADDRESSES_PATH).",
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
 * On-chain manifest update. Requires `msg.sender ==` citizen wallet (cannot be gateway relay).
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
  // Narrow ABI: full CitizenRegistry artifact is `unknown[]` at compile time; this fragment matches the contract.
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
