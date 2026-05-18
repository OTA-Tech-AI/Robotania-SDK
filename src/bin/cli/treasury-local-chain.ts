/**
 * Local vault moves (withdraw + pool bridges) sent from this wallet — same UX pattern as deposit-collateral.
 */

import { loadConfig, requireFlag } from "./config.js";
import { log, result } from "./output.js";
import {
  createAgentChainClients,
  readCitizenArenaBalances,
  writeWithdrawCollateral,
  writeWithdrawOperational,
  writeCollateralToOperational,
  writeOperationalToCollateral,
} from "../../chain.js";

function requireStakeVaultAddress(cfg: ReturnType<typeof loadConfig>): `0x${string}` {
  const v = cfg.chainAddresses.stakeVault;
  if (!v) {
    process.stderr.write("Error: set ROBOTANIA_STAKE_VAULT (or provide it via your deployment JSON)\n");
    process.exit(1);
  }
  return v;
}

export async function runWithdrawCollateralLocal(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amountStr = requireFlag(args, "--amount", "amount in USDC base units (1 USDC = 1000000)");
  const amount = BigInt(amountStr);

  const cfg = loadConfig();
  const stakeVault = requireStakeVaultAddress(cfg);

  if (isDryRun) {
    result({
      dryRun: true,
      action: "withdrawCollateral",
      stakeVault,
      citizenId,
      amount: amount.toString(),
      wallet: cfg.wallet.address,
    });
    return;
  }

  const { publicClient } = createAgentChainClients(cfg.wallet);
  const before = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  log(`Current balances — collateral: ${before.collateral}, operational: ${before.operational}`);
  log(`Withdrawing ${amount} (base units) from collateral for citizen ${citizenId}...`);
  const txHash = await writeWithdrawCollateral(cfg.wallet, {
    stakeVault,
    citizenId,
    amount,
  });
  log(`Tx submitted: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const after = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  result({
    txHash,
    status: receipt.status,
    citizenId,
    collateralBefore: before.collateral.toString(),
    collateralAfter: after.collateral.toString(),
  });
}

export async function runWithdrawOperationalLocal(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amountStr = requireFlag(args, "--amount", "amount in USDC base units (1 USDC = 1000000)");
  const amount = BigInt(amountStr);

  const cfg = loadConfig();
  const stakeVault = requireStakeVaultAddress(cfg);

  if (isDryRun) {
    result({
      dryRun: true,
      action: "withdrawOperational",
      stakeVault,
      citizenId,
      amount: amount.toString(),
      wallet: cfg.wallet.address,
    });
    return;
  }

  const { publicClient } = createAgentChainClients(cfg.wallet);
  const before = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  log(`Current balances — collateral: ${before.collateral}, operational: ${before.operational}`);
  log(`Withdrawing ${amount} (base units) from operational for citizen ${citizenId}...`);
  const txHash = await writeWithdrawOperational(cfg.wallet, {
    stakeVault,
    citizenId,
    amount,
  });
  log(`Tx submitted: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const after = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  result({
    txHash,
    status: receipt.status,
    citizenId,
    operationalBefore: before.operational.toString(),
    operationalAfter: after.operational.toString(),
  });
}

export async function runCollateralToOperationalLocal(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amountStr = requireFlag(args, "--amount", "amount in USDC base units");
  const amount = BigInt(amountStr);

  const cfg = loadConfig();
  const stakeVault = requireStakeVaultAddress(cfg);

  if (isDryRun) {
    result({ dryRun: true, action: "collateralToOperational", stakeVault, citizenId, amount: amount.toString(), wallet: cfg.wallet.address });
    return;
  }

  const { publicClient } = createAgentChainClients(cfg.wallet);
  const before = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  log(`Bridging collateral → operational: ${amount} for citizen ${citizenId}`);
  const txHash = await writeCollateralToOperational(cfg.wallet, { stakeVault, citizenId, amount });
  log(`Tx submitted: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const after = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  result({
    txHash,
    citizenId,
    collateralBefore: before.collateral.toString(),
    collateralAfter: after.collateral.toString(),
    operationalBefore: before.operational.toString(),
    operationalAfter: after.operational.toString(),
  });
}

export async function runOperationalToCollateralLocal(args: string[], isDryRun: boolean): Promise<void> {
  const citizenId = requireFlag(args, "--citizen-id", "citizen ID");
  const amountStr = requireFlag(args, "--amount", "amount in USDC base units");
  const amount = BigInt(amountStr);

  const cfg = loadConfig();
  const stakeVault = requireStakeVaultAddress(cfg);

  if (isDryRun) {
    result({ dryRun: true, action: "operationalToCollateral", stakeVault, citizenId, amount: amount.toString(), wallet: cfg.wallet.address });
    return;
  }

  const { publicClient } = createAgentChainClients(cfg.wallet);
  const before = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  log(`Bridging operational → collateral: ${amount} for citizen ${citizenId}`);
  const txHash = await writeOperationalToCollateral(cfg.wallet, { stakeVault, citizenId, amount });
  log(`Tx submitted: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const after = await readCitizenArenaBalances(publicClient, stakeVault, citizenId);
  result({
    txHash,
    citizenId,
    collateralBefore: before.collateral.toString(),
    collateralAfter: after.collateral.toString(),
    operationalBefore: before.operational.toString(),
    operationalAfter: after.operational.toString(),
  });
}
