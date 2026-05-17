import { loadConfig, flag } from "./config.js";
import { log, result } from "./output.js";
import { buildRobotaniaDomain, AGENT_REQUEST_TYPES } from "../../signing.js";
import { keccak256, toBytes } from "viem";

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  const metadataURI = flag(args, "--metadata-uri") ?? "";
  const manifestHash = flag(args, "--manifest-hash") ?? "0x" + "0".repeat(64);

  const cfg = loadConfig();

  const body = {
    walletAddress: cfg.wallet.address,
    metadataURI,
    manifestHash,
  };

  if (isDryRun) {
    const nonce = crypto.randomUUID();
    const deadlineSec = Math.floor(Date.now() / 1000) + 300;
    const payloadHash = keccak256(toBytes(JSON.stringify(body)));
    result({
      dryRun: true,
      domain: buildRobotaniaDomain(cfg.chainAddresses.chainId),
      types: AGENT_REQUEST_TYPES,
      message: {
        method: "POST",
        path: "/api/v1/agent/citizens/register",
        citizenId: "pending",
        nonce,
        deadline: deadlineSec,
        payloadHash,
      },
      body,
    });
    return;
  }

  log("Registering citizen...");
  const res = await cfg.gatewayClient.registerCitizen({ metadataURI, manifestHash });
  log("Done.");
  result(res);
}
