/** Print how much arena settlement ERC-20 the configured agent wallet still holds locally. */

import { loadConfig } from "./config.js";
import { result } from "./output.js";
import { createAgentChainClients, readCitizenWalletBalance } from "../../chain.js";

export async function run(_args: string[], _isDryRun: boolean): Promise<void> {
  const cfg = loadConfig();
  const tok = cfg.chainAddresses.settlementToken;
  const { publicClient } = createAgentChainClients(cfg.wallet);
  const raw = await readCitizenWalletBalance(publicClient, tok, cfg.wallet.address);
  result({
    wallet: cfg.wallet.address,
    settlement_token: tok,
    balance_raw: raw.toString(),
  });
}
