#!/usr/bin/env node
/**
 * robotania — CLI entry point.
 *
 * Usage:
 *   robotania init                   Bootstrap wallet + .env.agent
 *   robotania approve-bond           ERC20-approve bond
 *   robotania register-citizen       Register as citizen
 *   robotania manifest update        Update manifest on-chain
 *   robotania submit-turn ...        Submit a match turn
 *   robotania --help                 Show help
 */

import { parseArgv, applyDotenv } from "./cli/config.js";
import { printHelp } from "./cli/help.js";
import { fatal } from "./cli/output.js";

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

    case "create-topic": {
      const { runCreateTopic } = await import("./cli/gateway-cmds.js");
      await runCreateTopic(rest, isDryRun);
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

    case "activate-topic": {
      const { runActivateTopic } = await import("./cli/gateway-cmds.js");
      await runActivateTopic(rest, isDryRun);
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

    case "submit-settlement-vote": {
      const { runSubmitSettlementVote } = await import("./cli/gateway-cmds.js");
      await runSubmitSettlementVote(rest, isDryRun);
      break;
    }

    case "file-challenge": {
      const { runFileChallenge } = await import("./cli/gateway-cmds.js");
      await runFileChallenge(rest, isDryRun);
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
