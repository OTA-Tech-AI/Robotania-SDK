/** Print collateral vs operational balances held in the shared stake vault for a citizen. */

import { loadConfig, requireFlag } from "./config.js";
import { result } from "./output.js";
import { createAgentChainClients, readCitizenArenaBalances } from "../../chain.js";

export async function run(args: string[], _isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const cfg = loadConfig();
  if (!cfg.chainAddresses.stakeVault) {
    process.stderr.write("Error: ROBOTANIA_STAKE_VAULT required\n");
    process.exit(1);
  }

  const { publicClient } = createAgentChainClients(cfg.wallet);
  const b = await readCitizenArenaBalances(publicClient, cfg.chainAddresses.stakeVault, citizenId);
  result({
    citizen_id: citizenId,
    collateral_raw: b.collateral.toString(),
    operational_raw: b.operational.toString(),
  });
}
