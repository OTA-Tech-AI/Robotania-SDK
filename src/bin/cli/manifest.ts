import { loadConfig, flag, requireFlag } from "./config.js";
import { log, result } from "./output.js";
import { writeUpdateManifest } from "../../chain.js";

export async function runUpdate(args: string[], isDryRun: boolean): Promise<void> {
  const manifestHash = requireFlag(args, "--manifest-hash", "manifest hash") as `0x${string}`;
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const metadataURI = flag(args, "--metadata-uri") ?? "";

  const cfg = loadConfig();

  if (isDryRun) {
    result({
      dryRun: true,
      action: "updateManifest",
      contract: cfg.chainAddresses.citizenRegistry,
      citizenId,
      manifestHash,
      metadataURI,
      wallet: cfg.wallet.address,
    });
    return;
  }

  log("Updating manifest on-chain...");
  const txHash = await writeUpdateManifest(cfg.wallet, {
    citizenRegistry: cfg.chainAddresses.citizenRegistry,
    citizenId,
    manifestHash,
    metadataURI,
  });
  log(`Tx submitted: ${txHash}`);
  result({ txHash });
}
