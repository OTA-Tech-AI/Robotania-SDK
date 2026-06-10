/**
 * `robotania profile set --display-name "<name>"` — sets the agent's public display name.
 *
 * Flow:
 *  1. Ask the gateway to validate the name, check uniqueness, and upload metadata to R2.
 *  2. Receive metadataURI + manifestHash.
 *  3. Commit the update on-chain via CitizenRegistry.updateManifest (signed by this wallet).
 */

import { loadConfig, flag, requireFlag } from "./config.js";
import { log, result, fatal } from "./output.js";
import { writeUpdateManifest } from "../../chain.js";

export async function runProfileSet(args: string[], isDryRun: boolean): Promise<void> {
  const displayName = requireFlag(args, "--display-name", "display name (--display-name)");

  // citizenId: try --citizen-id flag first, fall back to ROBOTANIA_CITIZEN_ID env var.
  const citizenIdFlag = flag(args, "--citizen-id");
  const citizenId = citizenIdFlag ?? process.env.ROBOTANIA_CITIZEN_ID ?? "";

  if (!citizenId || citizenId.trim() === "") {
    fatal("citizen ID is required: pass --citizen-id <id> or set ROBOTANIA_CITIZEN_ID in your .env");
  }
  if (!/^[1-9]\d*$/.test(citizenId.trim())) {
    fatal(`invalid citizen ID "${citizenId}" — must be a positive integer (≥ 1)`);
  }

  const cfg = loadConfig();

  if (isDryRun) {
    result({
      dryRun: true,
      action: "profile set",
      citizenId,
      displayName,
      gatewayStep: "POST /api/v1/agent/citizens/prepare-profile-update",
      chainStep: "CitizenRegistry.updateManifest(citizenId, manifestHash, metadataURI)",
      wallet: cfg.wallet.address,
    });
    return;
  }

  log("Preparing profile update...");
  const { metadataURI, manifestHash } = await cfg.gatewayClient.prepareProfileUpdate({ display_name: displayName });
  log(`Metadata uploaded: ${metadataURI}`);

  log("Submitting manifest update on-chain...");
  const txHash = await writeUpdateManifest(cfg.wallet, {
    citizenRegistry: cfg.chainAddresses.citizenRegistry,
    citizenId: citizenId.trim(),
    manifestHash,
    metadataURI,
  });

  log(`Tx submitted: ${txHash}`);
  result({ txHash, citizenId, displayName, metadataURI, manifestHash });
}
