/**
 * CLI entry: wallet bootstrap, gateway-backed arena actions, and a few direct-on-chain helpers
 * (stakes, approvals, manifest updates) that must be signed by the citizen wallet key.
 */

import { parseArgv, applyDotenv } from "./cli/config.js";
import { printHelp } from "./cli/help.js";
import { fatal } from "./cli/output.js";
import { preloadChainAddresses } from "../chain.js";

const { envFile, isDryRun, args } = parseArgv(process.argv.slice(2));

// Load .env before anything reads process.env
applyDotenv(envFile);

const command = args[0];
const rest = args.slice(1);

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Reject unknown commands before attempting discovery so the error message is actionable.
  const KNOWN_COMMANDS = new Set([
    "init", "approve-bond", "deposit-collateral", "deposit-operational",
    "withdraw-collateral", "withdraw-operational", "collateral-to-operational",
    "operational-to-collateral", "withdraw-from-citizen-wallet", "citizen-wallet-balance",
    "citizen-arena-balances", "register-citizen", "manifest", "create-game",
    "join-waitlist", "deposit-waitlist", "activate-game",
    "stakes-withdraw-collateral", "stakes-withdraw-operational",
    "stakes-collateral-to-operational", "stakes-operational-to-collateral",
    "submit-turn", "ack-step", "challenge-step", "challenge-ruling", "complete-match",
    "open-position", "claim-position", "submit-jury-vote", "submit-jury-rubric",
    "heartbeat", "stay-online", "request-status", "wait-request",
  ]);
  if (!KNOWN_COMMANDS.has(command)) {
    fatal(`Unknown command: ${command}. Run "robotania --help" for usage.`);
  }

  // Populate the module-level address cache once before any command runs.
  // Skipped for `init` — no wallet or addresses exist yet.
  if (command !== "init") {
    await preloadChainAddresses();
  }

  switch (command) {
    case "init": {
      const { run } = await import("./init.js");
      await run();
      break;
    }

    case "approve-bond": {
      const { run } = await import("./cli/approve-bond.js");
      await run(rest, isDryRun);
      break;
    }

    case "deposit-collateral": {
      const { run } = await import("./cli/deposit-collateral.js");
      await run(rest, isDryRun);
      break;
    }

    case "deposit-operational": {
      const { run } = await import("./cli/deposit-operational.js");
      await run(rest, isDryRun);
      break;
    }

    case "withdraw-collateral": {
      const { runWithdrawCollateralLocal } = await import("./cli/treasury-local-chain.js");
      await runWithdrawCollateralLocal(rest, isDryRun);
      break;
    }

    case "withdraw-operational": {
      const { runWithdrawOperationalLocal } = await import("./cli/treasury-local-chain.js");
      await runWithdrawOperationalLocal(rest, isDryRun);
      break;
    }

    case "collateral-to-operational": {
      const { runCollateralToOperationalLocal } = await import("./cli/treasury-local-chain.js");
      await runCollateralToOperationalLocal(rest, isDryRun);
      break;
    }

    case "operational-to-collateral": {
      const { runOperationalToCollateralLocal } = await import("./cli/treasury-local-chain.js");
      await runOperationalToCollateralLocal(rest, isDryRun);
      break;
    }

    case "withdraw-from-citizen-wallet": {
      const { run } = await import("./cli/withdraw-from-citizen-wallet.js");
      await run(rest, isDryRun);
      break;
    }

    case "citizen-wallet-balance": {
      const { run } = await import("./cli/citizen-wallet-balance.js");
      await run(rest, isDryRun);
      break;
    }

    case "citizen-arena-balances": {
      const { run } = await import("./cli/citizen-arena-balances.js");
      await run(rest, isDryRun);
      break;
    }

    case "register-citizen": {
      const { run } = await import("./cli/register.js");
      await run(rest, isDryRun);
      break;
    }

    case "manifest": {
      if (rest[0] !== "update") fatal("Usage: robotania manifest update --manifest-hash 0x... --citizen-id <id>");
      const { runUpdate } = await import("./cli/manifest.js");
      await runUpdate(rest.slice(1), isDryRun);
      break;
    }

    case "create-game": {
      const { run } = await import("./cli/create-game.js");
      await run(rest, isDryRun);
      break;
    }

    case "join-waitlist": {
      const { runJoinWaitlist } = await import("./cli/gateway-cmds.js");
      await runJoinWaitlist(rest, isDryRun);
      break;
    }

    case "deposit-waitlist": {
      const { runDepositWaitlist } = await import("./cli/gateway-cmds.js");
      await runDepositWaitlist(rest, isDryRun);
      break;
    }

    case "activate-game": {
      const { runActivateGame } = await import("./cli/gateway-cmds.js");
      await runActivateGame(rest, isDryRun);
      break;
    }

    case "stakes-withdraw-collateral": {
      const { runStakesWithdrawCollateral } = await import("./cli/gateway-cmds.js");
      await runStakesWithdrawCollateral(rest, isDryRun);
      break;
    }

    case "stakes-withdraw-operational": {
      const { runStakesWithdrawOperational } = await import("./cli/gateway-cmds.js");
      await runStakesWithdrawOperational(rest, isDryRun);
      break;
    }

    case "stakes-collateral-to-operational": {
      const { runStakesCollateralToOperational } = await import("./cli/gateway-cmds.js");
      await runStakesCollateralToOperational(rest, isDryRun);
      break;
    }

    case "stakes-operational-to-collateral": {
      const { runStakesOperationalToCollateral } = await import("./cli/gateway-cmds.js");
      await runStakesOperationalToCollateral(rest, isDryRun);
      break;
    }

    case "submit-turn": {
      const { runSubmitTurn } = await import("./cli/gateway-cmds.js");
      await runSubmitTurn(rest, isDryRun);
      break;
    }

    case "ack-step": {
      const { runAckStep } = await import("./cli/gateway-cmds.js");
      await runAckStep(rest, isDryRun);
      break;
    }

    case "challenge-step": {
      const { runChallengeStep } = await import("./cli/gateway-cmds.js");
      await runChallengeStep(rest, isDryRun);
      break;
    }

    case "challenge-ruling": {
      const { runChallengeRuling } = await import("./cli/gateway-cmds.js");
      await runChallengeRuling(rest, isDryRun);
      break;
    }

    case "complete-match": {
      const { runCompleteMatch } = await import("./cli/gateway-cmds.js");
      await runCompleteMatch(rest, isDryRun);
      break;
    }

    case "open-position": {
      const { runOpenPosition } = await import("./cli/gateway-cmds.js");
      await runOpenPosition(rest, isDryRun);
      break;
    }

    case "claim-position": {
      const { runClaimPosition } = await import("./cli/gateway-cmds.js");
      await runClaimPosition(rest, isDryRun);
      break;
    }

    case "submit-jury-vote": {
      const { runSubmitJuryVote } = await import("./cli/gateway-cmds.js");
      await runSubmitJuryVote(rest, isDryRun);
      break;
    }

    case "submit-jury-rubric": {
      const { runSubmitJuryRubric } = await import("./cli/gateway-cmds.js");
      await runSubmitJuryRubric(rest, isDryRun);
      break;
    }

    case "heartbeat": {
      const { runHeartbeat } = await import("./cli/gateway-cmds.js");
      await runHeartbeat(rest, isDryRun);
      break;
    }

    case "stay-online": {
      const { runStayOnline } = await import("./cli/stay-online.js");
      await runStayOnline(rest, isDryRun);
      break;
    }

    case "request-status": {
      const { runRequestStatus } = await import("./cli/gateway-cmds.js");
      await runRequestStatus(rest, isDryRun);
      break;
    }

    case "wait-request": {
      const { runWaitRequest } = await import("./cli/gateway-cmds.js");
      await runWaitRequest(rest, isDryRun);
      break;
    }

    default:
      fatal(`Unknown command: ${command}. Run "robotania --help" for usage.`);
  }
}

main().catch((err) => {
  fatal((err as Error).message ?? String(err));
});
