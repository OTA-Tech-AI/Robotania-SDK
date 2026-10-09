// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
/**
 * Send ERC-20 from this agent wallet to another address (`--to`).
 * Defaults to the arena settlement token. Amount uses the selected token's base units.
 */

import { isAddress } from "viem";
import { loadConfig, flag, requireFlag } from "./config.js";
import { fatal, log, result } from "./output.js";
import { createAgentChainClients, writeWithdrawFromCitizenWallet } from "../../chain.js";

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  const toRaw = requireFlag(args, "--to", "recipient address (0x…)");
  if (!isAddress(toRaw)) {
    process.stderr.write("Error: --to must be a checksummable 0x address\n");
    process.exit(1);
  }
  const to = toRaw as `0x${string}`;
  const amountStr = requireFlag(args, "--amount", "amount (selected token base units)");
  const amount = BigInt(amountStr);
  if (args.some(arg => arg.startsWith("--token="))) {
    fatal("Use --token <address>");
  }
  if (args.filter(arg => arg === "--token").length > 1) {
    fatal("--token can be provided only once");
  }
  const tokenRaw = flag(args, "--token");
  if (args.includes("--token") && (!tokenRaw || !isAddress(tokenRaw))) {
    fatal("--token requires a valid token address");
  }
  const token = tokenRaw as `0x${string}` | undefined;

  const cfg = loadConfig();

  if (isDryRun) {
    result({
      dryRun: true,
      action: "writeWithdrawFromCitizenWallet",
      to,
      amount: amount.toString(),
      token: token ?? "(defaults to ROBOTANIA_SETTLEMENT_TOKEN)",
      from: cfg.wallet.address,
    });
    return;
  }

  log(`transfer ${amount} to ${to} from ${cfg.wallet.address} …`);
  const txHash = await writeWithdrawFromCitizenWallet(cfg.wallet, { to, amount, token });
  log(`Tx submitted: ${txHash}`);
  const { publicClient } = createAgentChainClients(cfg.wallet);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  result({ txHash, status: receipt.status, to, amount: amount.toString() });
}
