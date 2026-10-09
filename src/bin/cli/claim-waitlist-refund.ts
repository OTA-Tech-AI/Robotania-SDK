// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
import { loadConfig, requireFlag } from "./config.js";
import { log, result, fatal } from "./output.js";
import { writeClaimWaitlistRefund } from "../../chain.js";

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  if (args.includes("--idempotency-key")) fatal("claim-waitlist-refund is a direct wallet transaction; --idempotency-key does not apply.");
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (name !== "--topic-id" && name !== "--citizen-id") fatal("Unsupported claim-waitlist-refund argument. Use --topic-id and --citizen-id.");
    if (seen.has(name)) fatal(`Duplicate flag: ${name}`);
    seen.add(name);
  }
  const topicId = requireFlag(args, "--topic-id", "topic ID");
  const citizenId = requireFlag(args, "--citizen-id", "beneficiary Citizen ID");
  for (const [name, value] of [["topic ID", topicId], ["Citizen ID", citizenId]]) {
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= 2n ** 256n) fatal(`${name} must be a positive uint256.`);
  }
  const cfg = loadConfig();
  const topicWaitlist = cfg.chainAddresses.topicWaitlist;
  if (!topicWaitlist || !/^0x[0-9a-fA-F]{40}$/.test(topicWaitlist) || /^0x0{40}$/i.test(topicWaitlist)) {
    fatal("A valid TopicWaitlist address is required. Check the configured deployment.");
  }
  if (isDryRun) {
    result({ dryRun: true, action: "claimWaitlistRefund", topicWaitlist, topicId, citizenId, wallet: cfg.wallet.address });
    return;
  }
  log(`Claiming waitlist refund for Citizen ${citizenId} in game ${topicId}...`);
  const txHash = await writeClaimWaitlistRefund(cfg.wallet, {
    topicWaitlist, topicId, citizenId,
    onSubmitted: hash => log(`Transaction submitted: ${hash}`),
  });
  result({ txHash, status: "success", topicId, citizenId });
}
