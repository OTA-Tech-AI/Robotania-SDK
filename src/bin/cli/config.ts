import { config as loadDotenvFile } from "dotenv";
import { loadFromEnv } from "../../wallet.js";
import { GatewayClient } from "../../gateway.js";
import { ReadClient } from "../../read.js";
import { resolveChainAddresses } from "../../chain.js";
import { LOCAL_DEV_GATEWAY_URL, LOCAL_DEV_READ_API_URL } from "../../defaults.js";
import type { AgentWallet } from "../../wallet.js";
import type { ResolvedChainAddresses } from "../../chain.js";

export interface RobotaniaConfig {
  wallet: AgentWallet;
  gatewayClient: GatewayClient;
  readClient: ReadClient;
  chainAddresses: ResolvedChainAddresses;
}

/** Minimal signed-Gateway configuration for off-chain-only commands. */
export interface GatewayOnlyConfig {
  wallet: AgentWallet;
  gatewayClient: GatewayClient;
  chainId: number;
}

let _config: RobotaniaConfig | null = null;
let _gatewayOnlyConfig: GatewayOnlyConfig | null = null;

export function loadGatewayOnlyConfig(force = false): GatewayOnlyConfig {
  if (_gatewayOnlyConfig && !force) return _gatewayOnlyConfig;
  const wallet = loadFromEnv();
  const gatewayUrl = (process.env.ROBOTANIA_GATEWAY_URL ?? LOCAL_DEV_GATEWAY_URL).replace(/\/$/, "");
  const rawChainId = process.env.ROBOTANIA_CHAIN_ID ?? process.env.CHAIN_ID ?? "31337";
  const chainId = Number(rawChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("ROBOTANIA_CHAIN_ID / CHAIN_ID must be a positive integer for signed Gateway requests.");
  }
  const gatewayClient = new GatewayClient({ baseUrl: gatewayUrl, wallet, chainId });
  _gatewayOnlyConfig = { wallet, gatewayClient, chainId };
  return _gatewayOnlyConfig;
}

export function loadConfig(force = false): RobotaniaConfig {
  if (_config && !force) return _config;

  const wallet = loadFromEnv();
  const gatewayUrl = (process.env.ROBOTANIA_GATEWAY_URL ?? LOCAL_DEV_GATEWAY_URL).replace(/\/$/, "");
  const readApiUrl = (process.env.ROBOTANIA_READ_API_URL ?? LOCAL_DEV_READ_API_URL).replace(/\/$/, "");
  const chainAddresses = resolveChainAddresses();

  const gatewayClient = new GatewayClient({ baseUrl: gatewayUrl, wallet, chainId: chainAddresses.chainId });
  const readClient = new ReadClient({ baseUrl: readApiUrl });

  _config = { wallet, gatewayClient, readClient, chainAddresses };
  return _config;
}

export interface ParsedArgv {
  envFile?: string;
  isDryRun: boolean;
  args: string[];
}

export function parseArgv(argv: string[]): ParsedArgv {
  const args: string[] = [];
  let envFile: string | undefined;
  let isDryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env-file" && i + 1 < argv.length) {
      envFile = argv[++i];
    } else if (argv[i] === "--dry-run") {
      isDryRun = true;
    } else {
      args.push(argv[i]);
    }
  }

  return { envFile, isDryRun, args };
}

export function applyDotenv(envFile?: string): void {
  if (envFile) {
    loadDotenvFile({ path: envFile });
  } else {
    loadDotenvFile();
  }
}

export function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export function requireFlag(args: string[], name: string, label: string): string {
  const val = flag(args, name);
  if (!val) {
    process.stderr.write(`Error: ${label} is required (use ${name} <value>)\n`);
    process.exit(1);
  }
  return val;
}
