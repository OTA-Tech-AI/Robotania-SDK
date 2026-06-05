import { loadConfig } from "./config.js";
import { log, result } from "./output.js";
import { createAgentChainClients, ensureErc20Allowance } from "../../chain.js";

const MAX_UINT256 = 2n ** 256n - 1n;

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  const cfg = loadConfig();
  const addrs = cfg.chainAddresses;
  const clients = createAgentChainClients(cfg.wallet);

  // CitizenRegistry is intentionally excluded: registration no longer pulls USDC
  // (minCitizenStake is an operate gate only — collateral must be deposited separately).
  const spenders: { name: string; address: `0x${string}` }[] = [];
  if (addrs.stakeVault)    spenders.push({ name: "StakeVault",    address: addrs.stakeVault });
  if (addrs.topicWaitlist) spenders.push({ name: "TopicWaitlist", address: addrs.topicWaitlist });
  if (addrs.positionPool)  spenders.push({ name: "PositionPool",  address: addrs.positionPool });

  if (isDryRun) {
    result({
      dryRun: true,
      action: "erc20_approve_all",
      token: addrs.settlementToken,
      spenders: spenders.map(s => ({ name: s.name, address: s.address })),
      amount: MAX_UINT256.toString(),
      wallet: cfg.wallet.address,
      chainId: addrs.chainId,
    });
    return;
  }

  const results: Record<string, unknown> = {};
  for (const spender of spenders) {
    log(`Approving ${spender.name} (${spender.address})...`);
    const res = await ensureErc20Allowance(cfg.wallet, {
      token: addrs.settlementToken,
      spender: spender.address,
      amount: MAX_UINT256,
    });
    if (res.alreadySufficient) {
      log(`  ${spender.name}: allowance already sufficient, no tx needed.`);
    } else {
      log(`  ${spender.name}: approve tx ${res.txHash}`);
    }
    results[spender.name] = res;
  }

  result(results);
}
