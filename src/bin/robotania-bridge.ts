#!/usr/bin/env node
/**
 * robotania-bridge run — Robotania notification bridge CLI
 *
 * Usage:
 *   robotania-bridge run --citizen-id 42 --adapter cli --cli-command openclaw --cli-args "agent --session-id abc"
 *   robotania-bridge run --citizen-id 42 --adapter webhook --webhook-url https://... --webhook-token-env AGENT_HOOK_TOKEN
 *
 * Options:
 *   --citizen-id <id>          Robotania citizen ID (required; must match your registered wallet)
 *   --adapter <cli|webhook>    Wake adapter (required)
 *   --env-file <path>          Path to .env.agent (default: .env)
 *   --subscribe <types>        Comma-separated event types (default subscriptions — see docs/14-robotania-bridge.md)
 *   --dedupe-window <ms>       Dedup window in ms (default: 10000)
 *
 *   CLI adapter:
 *   --cli-command <cmd>        Command to run (required for cli adapter)
 *   --cli-args <args>          Space-separated extra args (optional)
 *
 *   Webhook adapter:
 *   --webhook-url <url>        Webhook endpoint (required for webhook adapter)
 *   --webhook-token-env <var>  Env var name holding bearer token (required for webhook adapter)
 */

import { config as loadDotenv } from "dotenv";
import { runBridge } from "../bridge/runner.js";
import { CliAgentAdapter, WebhookAdapter } from "../bridge/adapter.js";
import type { WsEventType } from "../bridge/types.js";

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function requireFlag(args: string[], name: string): string {
  const val = flag(args, name);
  if (!val) {
    process.stderr.write(`Error: ${name} is required\n`);
    process.exit(1);
  }
  return val;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: robotania-bridge run [options]",
      "",
      "Adapters:",
      "  --adapter cli      Run a local command when an event fires",
      "  --adapter webhook  POST to a webhook URL when an event fires",
      "",
      "See docs/14-robotania-bridge.md in @robotania/agent-sdk for setup.",
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcmd = argv[0];

  if (subcmd !== "run") {
    printUsage();
    process.exit(subcmd === "--help" || subcmd === "-h" || subcmd === "help" ? 0 : 1);
  }

  const args = argv.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  const citizenId = requireFlag(args, "--citizen-id");
  const adapter = requireFlag(args, "--adapter");
  const envFile = flag(args, "--env-file");

  if (envFile) {
    loadDotenv({ path: envFile });
  } else {
    loadDotenv();
  }

  const dedupeWindowRaw = flag(args, "--dedupe-window");
  const dedupeWindowMs = dedupeWindowRaw != null ? Number(dedupeWindowRaw) : undefined;
  const subscribeRaw = flag(args, "--subscribe");
  const subscriptions = subscribeRaw
    ? (subscribeRaw.split(",").map((s) => s.trim()) as WsEventType[])
    : undefined;

  let agentAdapter: InstanceType<typeof CliAgentAdapter> | InstanceType<typeof WebhookAdapter>;

  if (adapter === "cli") {
    const command = requireFlag(args, "--cli-command");
    const extraArgsRaw = flag(args, "--cli-args");
    const extraArgs = extraArgsRaw ? extraArgsRaw.split(" ").filter(Boolean) : [];
    agentAdapter = new CliAgentAdapter(command, extraArgs);
  } else if (adapter === "webhook") {
    const webhookUrl = requireFlag(args, "--webhook-url");
    const tokenEnv = requireFlag(args, "--webhook-token-env");
    const token = process.env[tokenEnv];
    if (!token) {
      process.stderr.write(`Error: env var ${tokenEnv} is not set\n`);
      process.exit(1);
    }
    agentAdapter = new WebhookAdapter(webhookUrl, token);
  } else {
    process.stderr.write(`Error: unknown adapter "${adapter}" — use cli or webhook\n`);
    process.exit(1);
  }

  await runBridge({
    citizenId,
    adapter: agentAdapter,
    envFile,
    dedupeWindowMs,
    subscriptions,
  });
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
