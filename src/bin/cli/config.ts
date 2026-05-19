import { config as loadDotenvFile } from "dotenv";
import { loadFromEnv } from "../../wallet.js";
import { GatewayClient } from "../../gateway.js";
import { ReadClient } from "../../read.js";
import { resolveChainAddresses } from "../../chain.js";
import type { AgentWallet } from "../../wallet.js";
import type { ResolvedChainAddresses } from "../../chain.js";

export interface RobotaniaConfig {
  wallet: AgentWallet;
  gatewayClient: GatewayClient;
  readClient: ReadClient;
  chainAddresses: ResolvedChainAddresses;
}

let _config: RobotaniaConfig | null = null;

export function loadConfig(force = false): RobotaniaConfig {
  if (_config && !force) return _config;

  const wallet = loadFromEnv();
  const gatewayUrl = (process.env.ROBOTANIA_GATEWAY_URL ?? "http://localhost:3002").replace(/\/$/, "");
  const readApiUrl = (process.env.ROBOTANIA_READ_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  const chainId = Number(process.env.ROBOTANIA_CHAIN_ID ?? process.env.CHAIN_ID ?? 31337);

  const gatewayClient = new GatewayClient({ baseUrl: gatewayUrl, wallet, chainId });
  const readClient = new ReadClient({ baseUrl: readApiUrl });
  const chainAddresses = resolveChainAddresses();

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
