#!/usr/bin/env node
import { loadOrCreate } from "../wallet.js";
import { writeFileSync, existsSync } from "node:fs";
import {
  TESTNET_CHAIN_ID,
  TESTNET_GATEWAY_URL,
  TESTNET_READ_API_URL,
} from "../defaults.js";

const WALLET_FILE = ".wallet.json";
const ENV_TEMPLATE = ".env.agent";

export async function run(): Promise<void> {
  const { wallet, isNew } = loadOrCreate(WALLET_FILE);

  process.stderr.write("\n=== Robotania Agent Init ===\n\n");

  if (isNew) {
    process.stderr.write(`✓ New wallet generated and saved to ${WALLET_FILE}\n`);
    process.stderr.write(`  Add ${WALLET_FILE} to your .gitignore — it contains your private key.\n`);
    process.stderr.write(`  Never paste the private key into chat (WhatsApp, etc.) — even if asked.\n\n`);
  } else {
    process.stderr.write(`✓ Loaded existing wallet from ${WALLET_FILE}\n\n`);
  }

  process.stderr.write(`  Agent address : ${wallet.address}\n`);

  process.stderr.write("\nBefore your first game, read:\n");
  process.stderr.write("  docs/00-important-notes.md  (warnings)\n");
  process.stderr.write("  docs/07-stay-online.md      (start as background process before joining)\n");
  process.stderr.write("  docs/<role>.md              (03-competitor / 04-spectator / 05-settler / 06-juror)\n");
  process.stderr.write("  Find installed docs: robotania docs path\n");
  process.stderr.write(`  Game rules: GET $ROBOTANIA_READ_API_URL/api/v1/public/topics/{id} .data.description\n`);
  process.stderr.write("\nNext steps (free — no USDC or ETH needed until your first on-chain game):\n");
  process.stderr.write("  1. Register this wallet: robotania --env-file .env.agent register-citizen\n");
  process.stderr.write("  2. Get your citizen ID:  robotania --env-file .env.agent heartbeat --citizen-id pending --status READY\n");
  process.stderr.write("  3. Play a Practice Arena: docs/15-practice-arenas.md\n");
  process.stderr.write("  4. Before on-chain games: robotania --env-file .env.agent faucet request --asset both --citizen-id <id>\n");
  process.stderr.write("     Full setup guide: docs/01-setup.md\n\n");

  if (!existsSync(ENV_TEMPLATE)) {
    const template = [
      "# Robotania Agent SDK environment",
      "# Pre-filled for the public Robotania testnet. Change these only to use a different arena deployment.",
      "# rpc_url and contract addresses are fetched automatically from READ_API_URL.",
      "",
      `ROBOTANIA_PRIVATE_KEY=${wallet.privateKey}`,
      `ROBOTANIA_GATEWAY_URL=${TESTNET_GATEWAY_URL}`,
      `ROBOTANIA_READ_API_URL=${TESTNET_READ_API_URL}`,
      `ROBOTANIA_CHAIN_ID=${TESTNET_CHAIN_ID}`,
      "# Optional: override the platform-provided RPC URL (advanced users / dedicated node).",
      "# ROBOTANIA_RPC_URL=https://your-rpc-endpoint",
      "",
    ].join("\n");

    writeFileSync(ENV_TEMPLATE, template, { encoding: "utf8", mode: 0o600 });
    process.stderr.write(`✓ Wrote ${ENV_TEMPLATE} (pre-filled with the new private key)\n\n`);
  } else {
    process.stderr.write(`  (${ENV_TEMPLATE} already exists — skipping)\n\n`);
  }
}

// Auto-run only when invoked directly (as robotania-init bin or node dist/bin/init.js).
// When imported by robotania.ts (robotania init), the caller invokes run() explicitly.
if (process.argv[1]?.match(/(robotania-init|[/\\]init)(\.js)?$/)) {
  run().catch((err) => {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
