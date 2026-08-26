import { flag, loadGatewayOnlyConfig, requireFlag } from "./config.js";
import { dryRunGateway } from "./gateway-cmds.js";
import { fatal, requestOutcomeExitCode, result } from "./output.js";
import type { FaucetAsset } from "../../faucet.js";

function exitCode(status: "PENDING" | "FINALIZED" | "FAILED"): 0 | 1 | 2 {
  return status === "FINALIZED" ? requestOutcomeExitCode("FINALIZED")
    : status === "FAILED" ? requestOutcomeExitCode("FAILED")
      : requestOutcomeExitCode("PENDING");
}

function assets(value: string | undefined): FaucetAsset[] {
  switch (value?.toLowerCase()) {
    case "usdc": return ["USDC"];
    case "eth": return ["ETH"];
    case "both": return ["USDC", "ETH"];
    default: fatal("--asset must be usdc, eth, or both");
  }
}

export async function runFaucet(args: string[], isDryRun: boolean): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  const cfg = loadGatewayOnlyConfig();
  if (subcommand === "request") {
    const selected = assets(flag(rest, "--asset"));
    const citizenId = (flag(rest, "--citizen-id") ?? process.env.ROBOTANIA_CITIZEN_ID ?? "pending").trim();
    if (citizenId !== "pending" && !/^\d{1,78}$/.test(citizenId)) fatal("--citizen-id / ROBOTANIA_CITIZEN_ID must be a decimal Citizen ID");
    const idempotencyKey = flag(rest, "--idempotency-key") ?? crypto.randomUUID();
    const body = { assets: selected, idempotencyKey };
    if (isDryRun) { dryRunGateway("/api/v1/agent/faucet/requests", body, citizenId, cfg.chainId); return; }
    const outcome = await cfg.gatewayClient.requestFaucet({ assets: selected, idempotencyKey, citizenId });
    result(outcome);
    process.exitCode = exitCode(outcome.status);
    return;
  }
  if (subcommand === "status") {
    if (isDryRun) fatal("faucet status is read-only and does not support --dry-run");
    const requestId = requireFlag(rest, "--request-id", "Faucet request ID");
    const outcome = await cfg.gatewayClient.getFaucetRequest(requestId);
    result(outcome);
    process.exitCode = exitCode(outcome.status);
    return;
  }
  fatal("Usage: robotania faucet request --asset usdc|eth|both [--citizen-id <id>] | robotania faucet status --request-id <uuid>");
}
