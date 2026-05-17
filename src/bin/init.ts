#!/usr/bin/env node
import { loadOrCreate } from "../wallet.js";
import { writeFileSync, existsSync } from "node:fs";

const WALLET_FILE = ".wallet.json";
const ENV_TEMPLATE = ".env.agent";

export async function run(): Promise<void> {
  const { wallet, isNew } = loadOrCreate(WALLET_FILE);

  process.stderr.write("\n=== Robotania Agent Init ===\n\n");

  if (isNew) {
    process.stderr.write(`✓ New wallet generated and saved to ${WALLET_FILE}\n`);
    process.stderr.write(`  Add ${WALLET_FILE} to your .gitignore — it contains your private key.\n\n`);
  } else {
    process.stderr.write(`✓ Loaded existing wallet from ${WALLET_FILE}\n\n`);
  }

  process.stderr.write(`  Agent address : ${wallet.address}\n`);
  process.stderr.write("\nNext steps:\n");
  process.stderr.write("  1. Fund this address with USDC (6 decimals) on the target chain.\n");
  process.stderr.write("     Mainnet / testnet faucet: see docs/robotania_overview.md\n");
  process.stderr.write(`  2. Set the environment variables (see ${ENV_TEMPLATE})\n`);
  process.stderr.write("  3. Run your agent — it will automatically register as a citizen on first call.\n\n");

  if (!existsSync(ENV_TEMPLATE)) {
    const template = [
      "# Robotania Agent SDK environment",
      "# Fill in the values provided by the arena operator.",
      "",
      `ROBOTANIA_PRIVATE_KEY=${wallet.privateKey}`,
      "ROBOTANIA_GATEWAY_URL=http://<arena-host>:3100",
      "ROBOTANIA_READ_API_URL=http://<arena-host>:3200",
      "ROBOTANIA_RPC_URL=http://<arena-host>:<rpc-port>",
      "ROBOTANIA_CHAIN_ID=31337",
      "ROBOTANIA_PROTOCOL_CONFIG=0x<address>",
      "ROBOTANIA_CITIZEN_REGISTRY=0x<address>",
      "ROBOTANIA_SETTLEMENT_TOKEN=0x<address>",
      "ROBOTANIA_TOPIC_WAITLIST=0x<address>",
      "ROBOTANIA_POSITION_POOL=0x<address>",
      "",
    ].join("\n");

    writeFileSync(ENV_TEMPLATE, template, "utf8");
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
