/**
 * Arena simulation setup — fresh wallets only (post full-environment-reset).
 * Reads contract addresses from packages/ops/deployed-addresses.json.
 *
 * Env:
 *   ARENA_AGENT_COUNT  — number of agents (default 12)
 *   ARENA_HOST         — public host for URLs (default 104.168.122.108)
 *
 * Logs go to stderr; stdout is JSON only (safe for `> /tmp/arena-agents.json`).
 * Set ARENA_SETUP_FORCE=1 to re-run when /tmp/arena-sim already exists.
 */
import {
  createPublicClient, createWalletClient, http, defineChain, parseAbi,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const HOST = process.env.ARENA_HOST ?? "104.168.122.108";
const AGENT_COUNT = Math.max(4, Number(process.env.ARENA_AGENT_COUNT ?? "12"));
const RPC_URL = process.env.ARENA_RPC_URL ?? `http://${HOST}:8546`;
const GATEWAY_URL = process.env.ARENA_GATEWAY_URL ?? `http://${HOST}:3100`;
const READ_API = process.env.ARENA_READ_API_URL ?? `http://${HOST}:3200`;

const addrsJson = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "packages/ops/deployed-addresses.json"), "utf-8"),
);
const C = addrsJson.contracts;
const CHAIN_ID = addrsJson.chainId ?? 31337;
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USDC = C.SettlementToken;
const STAKE_VAULT = C.StakeVault;
const REGISTRY = C.CitizenRegistry;
const PROTO_CFG = C.ProtocolConfig;
const TOPIC_WL = C.TopicWaitlist;
const POS_POOL = C.PositionPool;
const MATCH_MGR = C.MatchManager;
const JURY_MGR = C.JuryManager;

if (
  existsSync("/tmp/arena-sim") &&
  process.env.ARENA_SETUP_FORCE !== "1" &&
  process.env.ARENA_SETUP_FORCE !== "true"
) {
  console.error(
    "Refusing to run: /tmp/arena-sim already exists. " +
      "Run full-environment-reset first or set ARENA_SETUP_FORCE=1.",
  );
  process.exit(1);
}

const AGENT_NAMES = [
  "Agent01", "Agent02", "Agent03", "Agent04", "Agent05", "Agent06",
  "Agent07", "Agent08", "Agent09", "Agent10", "Agent11", "Agent12",
  "Agent13", "Agent14", "Agent15", "Agent16",
];

const chain = defineChain({
  id: CHAIN_ID, name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const pub = createPublicClient({ chain, transport: http(RPC_URL) });
const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
const deployerWallet = createWalletClient({ account: deployerAccount, chain, transport: http(RPC_URL) });

const erc20Abi = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
]);
const registryAbi = parseAbi([
  "function registerCitizen(address wallet, string metadataURI, bytes32 manifestHash) external returns (uint256)",
  "function getCitizenIdByWallet(address) external view returns (uint256)",
]);
const stakeAbi = parseAbi([
  "function depositCollateral(uint256,uint256) external",
  "function depositOperational(uint256,uint256) external",
]);
const cfgAbi = parseAbi([
  "function minCitizenStake() external view returns (uint256)",
]);

async function send(hash) {
  await pub.waitForTransactionReceipt({ hash });
}

const minStake = await pub.readContract({ address: PROTO_CFG, abi: cfgAbi, functionName: "minCitizenStake" });
console.error(`minCitizenStake = ${minStake}`);

const agents = [];
for (let i = 0; i < AGENT_COUNT; i++) {
  const pk = generatePrivateKey();
  const acct = privateKeyToAccount(pk);
  const name = AGENT_NAMES[i] ?? `Agent${String(i + 1).padStart(2, "0")}`;

  const ethHash = await deployerWallet.sendTransaction({ to: acct.address, value: 1_000_000_000_000_000_000n });
  await send(ethHash);
  const usdcHash = await deployerWallet.writeContract({
    account: deployerAccount, address: USDC, abi: erc20Abi,
    functionName: "transfer", args: [acct.address, 100_000_000n],
  });
  await send(usdcHash);

  const wc = createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(RPC_URL) });

  if (minStake > 0n) {
    const appHash = await wc.writeContract({
      account: acct, address: USDC, abi: erc20Abi,
      functionName: "approve", args: [REGISTRY, minStake],
    });
    await send(appHash);
  }

  const regHash = await wc.writeContract({
    account: acct, address: REGISTRY, abi: registryAbi,
    functionName: "registerCitizen",
    args: [acct.address, "", "0x0000000000000000000000000000000000000000000000000000000000000000"],
  });
  await send(regHash);

  const citizenId = await pub.readContract({
    address: REGISTRY, abi: registryAbi,
    functionName: "getCitizenIdByWallet", args: [acct.address],
  });

  const appHash2 = await wc.writeContract({
    account: acct, address: USDC, abi: erc20Abi,
    functionName: "approve", args: [STAKE_VAULT, 2n ** 256n - 1n],
  });
  await send(appHash2);

  const depCol = await wc.writeContract({
    account: acct, address: STAKE_VAULT, abi: stakeAbi,
    functionName: "depositCollateral", args: [citizenId, 10_000_000n],
  });
  await send(depCol);

  const depOp = await wc.writeContract({
    account: acct, address: STAKE_VAULT, abi: stakeAbi,
    functionName: "depositOperational", args: [citizenId, 20_000_000n],
  });
  await send(depOp);

  agents.push({ name, pk, address: acct.address, citizenId: citizenId.toString() });
  console.error(`Registered ${name} citizen #${citizenId} at ${acct.address}`);
}

mkdirSync("/tmp/arena-sim", { recursive: true });

const baseEnv = (pk) => [
  `ROBOTANIA_PRIVATE_KEY=${pk}`,
  `ROBOTANIA_GATEWAY_URL=${GATEWAY_URL}`,
  `ROBOTANIA_READ_API_URL=${READ_API}`,
  `ROBOTANIA_RPC_URL=${RPC_URL}`,
  `ROBOTANIA_CHAIN_ID=${CHAIN_ID}`,
  `ROBOTANIA_PROTOCOL_CONFIG=${PROTO_CFG}`,
  `ROBOTANIA_CITIZEN_REGISTRY=${REGISTRY}`,
  `ROBOTANIA_SETTLEMENT_TOKEN=${USDC}`,
  `ROBOTANIA_STAKE_VAULT=${STAKE_VAULT}`,
  `ROBOTANIA_TOPIC_WAITLIST=${TOPIC_WL}`,
  `ROBOTANIA_POSITION_POOL=${POS_POOL}`,
  `ROBOTANIA_MATCH_MANAGER=${MATCH_MGR}`,
  `ROBOTANIA_JURY_MANAGER=${JURY_MGR}`,
  "",
].join("\n");

for (const agent of agents) {
  agent.envFile = `/tmp/arena-sim/${agent.name}.env`;
  writeFileSync(agent.envFile, baseEnv(agent.pk));
}

console.log(JSON.stringify({
  agents: agents.map((a) => ({
    name: a.name, citizenId: a.citizenId, envFile: a.envFile, address: a.address,
  })),
  contracts: { USDC, STAKE_VAULT, MATCH_MGR, JURY_MGR, PROTO_CFG, REGISTRY },
  urls: { gateway: GATEWAY_URL, readApi: READ_API, rpc: RPC_URL },
  chainId: CHAIN_ID,
}, null, 2));
