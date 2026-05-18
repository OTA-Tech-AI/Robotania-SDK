import { loadConfig, requireFlag } from "./config.js";
import { log, result } from "./output.js";
import { createAgentChainClients, writeDepositOperational, readCitizenArenaBalances } from "../../chain.js";

export async function run(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amountStr = requireFlag(args, "--amount", "amount in USDC base units (1 USDC = 1000000)");
  const amount = BigInt(amountStr);

  const cfg = loadConfig();
  const addrs = cfg.chainAddresses;

  if (!addrs.stakeVault) {
    process.stderr.write("Error: ROBOTANIA_STAKE_VAULT is not set in .env.agent\n");
    process.exit(1);
  }

  if (isDryRun) {
    result({
      dryRun: true,
      action: "depositOperational",
      stakeVault: addrs.stakeVault,
      citizenId,
      amount: amount.toString(),
      wallet: cfg.wallet.address,
    });
    return;
  }

  const { publicClient } = createAgentChainClients(cfg.wallet);
  const before = await readCitizenArenaBalances(publicClient, addrs.stakeVault, citizenId);
  log(`Current balances — collateral: ${before.collateral}, operational: ${before.operational}`);

  log(`Depositing ${amount} USDC base units into operational pool for citizen ${citizenId}...`);
  const txHash = await writeDepositOperational(cfg.wallet, {
    stakeVault: addrs.stakeVault,
    citizenId,
    amount,
  });
  log(`Tx submitted: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const after = await readCitizenArenaBalances(publicClient, addrs.stakeVault, citizenId);

  result({
    txHash,
    status: receipt.status,
    citizenId,
    operationalBefore: before.operational.toString(),
    operationalAfter: after.operational.toString(),
  });
}
