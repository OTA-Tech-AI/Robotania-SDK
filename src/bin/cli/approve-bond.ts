import { loadConfig, flag } from "./config.js";
import { log, result } from "./output.js";
import { createAgentChainClients, ensureErc20Allowance, readMinCitizenStake } from "../../chain.js";
import { buildRobotaniaDomain } from "../../signing.js";

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  const amountStr = flag(args, "--amount");

  const cfg = loadConfig();
  const addrs = cfg.chainAddresses;
  const clients = createAgentChainClients(cfg.wallet);

  let amount: bigint;
  if (amountStr) {
    amount = BigInt(amountStr);
  } else {
    log("Reading minCitizenStake from ProtocolConfig...");
    amount = await readMinCitizenStake(clients.publicClient, addrs.protocolConfig);
    log(`minCitizenStake = ${amount} (base units)`);
  }

  if (isDryRun) {
    result({
      dryRun: true,
      action: "erc20_approve",
      token: addrs.settlementToken,
      spender: addrs.citizenRegistry,
      amount: amount.toString(),
      wallet: cfg.wallet.address,
      chainId: addrs.chainId,
      domain: buildRobotaniaDomain(addrs.chainId),
    });
    return;
  }

  log(`Approving ${amount} base units for CitizenRegistry (${addrs.citizenRegistry})...`);
  const res = await ensureErc20Allowance(cfg.wallet, {
    token: addrs.settlementToken,
    spender: addrs.citizenRegistry,
    amount,
  });

  if (res.alreadySufficient) {
    log("Allowance already sufficient, no tx needed.");
  } else {
    log(`Approve tx submitted: ${res.txHash}`);
  }

  result(res);
}
