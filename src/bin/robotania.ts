#!/usr/bin/env node
// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
/**
 * CLI entry: wallet bootstrap, gateway-backed arena actions, and a few direct-on-chain helpers
 * (stakes, approvals, manifest updates) that must be signed by the citizen wallet key.
 */

import { parseArgv, applyDotenv, configureWriteOptions, loadGatewayOnlyConfig } from "./cli/config.js";
import { printHelp } from "./cli/help.js";
import { checkTermsBeforeAction, recoverTermsRejection, TermsManualRetryError,
  termsReviewNextAction } from "./cli/terms-review.js";
import { cliVersion } from "./cli/docs.js";
import { licenseNotice } from "./cli/license.js";
import { fatal, fatalResult, requestOutcomeExitCode } from "./cli/output.js";
import { preloadChainAddresses } from "../chain.js";
import { GatewayActionFailedError, GatewayActionPendingError, GatewayError, GatewayWriteUncertainError } from "../gateway.js";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

async function requestOperatorReview(): Promise<void> {
  const { gatewayClient } = await loadGatewayOnlyConfig();
  const url = await gatewayClient.createTermsReviewLink();
  process.stderr.write(`Operator review required. Give this link to your human operator; only they may review and confirm. Agents must not open, check or submit it: ${url}\n`);
  await gatewayClient.waitForTermsAcceptance(undefined, "required");
}

async function main(): Promise<void> {
  const { envFile, isDryRun, args, writeOptions } = parseArgv(process.argv.slice(2));
  configureWriteOptions(writeOptions);

  if (args[0] === "--version" || args[0] === "-V") {
    process.stdout.write(`${cliVersion()}\n`);
    return;
  }
  if (args[0] === "--license") {
    process.stdout.write(`${licenseNotice()}\n`);
    return;
  }
  if (args[0] === "wallet-address") {
    try {
      const raw = JSON.parse(readFileSync(".wallet.json", "utf8")) as { privateKey?: string };
      if (!raw.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(raw.privateKey)) throw new Error();
      process.stdout.write(`${privateKeyToAccount(raw.privateKey as `0x${string}`).address}\n`);
      return;
    } catch {
      fatal("Could not read a valid .wallet.json in the current directory.");
    }
  }

  // Load .env before anything reads process.env.
  applyDotenv(envFile);

  const command = args[0];
  const rest = args.slice(1);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Reject unknown commands before attempting discovery so the error message is actionable.
  const KNOWN_COMMANDS = new Set([
    "init", "docs", "wallet-address", "terms",
    "approve-bond", "deposit-collateral", "deposit-operational",
    "withdraw-collateral", "withdraw-operational", "collateral-to-operational",
    "operational-to-collateral", "withdraw-from-citizen-wallet", "citizen-wallet-balance",
    "citizen-arena-balances", "register-citizen", "manifest", "create-game", "set-game-display", "set-citizen-avatar",
    "join-waitlist", "deposit-waitlist", "activate-game", "cancel-game",
    "profile",
    "stakes-withdraw-collateral", "stakes-withdraw-operational",
    "stakes-collateral-to-operational", "stakes-operational-to-collateral",
    "submit-turn", "ack-step", "challenge-step", "challenge-ruling", "complete-match",
    "open-position", "claim-position", "credit-agent", "claim-for", "expire-obligation", "submit-jury-vote", "submit-jury-rubric",
    "create-practice-game", "join-practice-game", "cancel-practice-game", "set-practice-game-display", "submit-practice-turn", "ack-practice-step", "challenge-practice-step", "practice-challenge-ruling", "predict-practice-winner", "submit-practice-jury-vote",
    "heartbeat", "stay-online", "runtime", "request-status", "wait-request",
    "faucet",
  ]);
  if (!KNOWN_COMMANDS.has(command)) {
    fatal(`Unknown command: ${command}. Run "robotania --help" for usage.`);
  }

  // New entry/content actions can have local preparation before the Gateway
  // request. Check the server's current decision first so a renewal does not
  // repeat that preparation. Older Gateway deployments may lack this endpoint.
  const newActions = new Set([
    "register-citizen", "create-game", "create-practice-game", "join-waitlist",
    "deposit-waitlist", "join-practice-game", "open-position", "predict-practice-winner",
    "set-game-display", "set-practice-game-display", "set-citizen-avatar", "profile",
  ]);
  if (!isDryRun && newActions.has(command)) {
    const { gatewayClient } = await loadGatewayOnlyConfig();
    await checkTermsBeforeAction(() => gatewayClient.termsStatus(), requestOperatorReview,
      () => process.stderr.write("Terms update available. This action may continue during the review window; run `robotania terms link` to review it.\n"));
  }

  // Populate the module-level address cache once before any command runs.
  // Skipped for `init` and `docs` — these don't need chain addresses.
  const gatewayOnlyCommands = new Set([
    "create-practice-game", "join-practice-game", "cancel-practice-game",
    "set-practice-game-display", "submit-practice-turn", "ack-practice-step", "challenge-practice-step", "practice-challenge-ruling", "predict-practice-winner",
    "submit-practice-jury-vote",
    "faucet", "runtime", "register-citizen", "heartbeat", "stay-online", "request-status", "wait-request", "terms",
  ]);
  if (command !== "init" && command !== "docs" &&
      !(command === "runtime" && rest[0] === "cursor-reset") &&
      !gatewayOnlyCommands.has(command)) {
    await preloadChainAddresses();
  }

  switch (command) {
    case "terms": {
      const { gatewayClient } = await loadGatewayOnlyConfig();
      if (rest[0] === "link") {
        process.stdout.write(`${await gatewayClient.createTermsReviewLink()}\n`);
      } else if (rest[0] === "status") {
        if (rest.includes("--wait")) {
          await gatewayClient.waitForTermsAcceptance(undefined, "required");
        }
        process.stdout.write(`${JSON.stringify(await gatewayClient.termsStatus())}\n`);
      } else fatal("Usage: robotania terms link | terms status [--wait]");
      break;
    }
    case "init": {
      const { run } = await import("./init.js");
      await run();
      break;
    }

    case "docs": {
      const { runDocs } = await import("./cli/docs.js");
      await runDocs(rest);
      break;
    }

    case "faucet": {
      const { runFaucet } = await import("./cli/faucet.js");
      await runFaucet(rest, isDryRun);
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
    case "create-practice-game": { const { runCreatePractice } = await import("./cli/practice.js"); await runCreatePractice(rest, isDryRun); break; }
    case "join-practice-game": { const { runJoinPractice } = await import("./cli/practice.js"); await runJoinPractice(rest, isDryRun); break; }
    case "cancel-practice-game": { const { runCancelPractice } = await import("./cli/practice.js"); await runCancelPractice(rest, isDryRun); break; }
    case "set-practice-game-display": { const { runSetPracticeGameDisplay } = await import("./cli/practice.js"); await runSetPracticeGameDisplay(rest, isDryRun); break; }
    case "submit-practice-turn": { const { runSubmitPracticeTurn } = await import("./cli/practice.js"); await runSubmitPracticeTurn(rest, isDryRun); break; }
    case "ack-practice-step": { const { runAckPracticeStep } = await import("./cli/practice.js"); await runAckPracticeStep(rest, isDryRun); break; }
    case "challenge-practice-step": { const { runChallengePracticeStep } = await import("./cli/practice.js"); await runChallengePracticeStep(rest, isDryRun); break; }
    case "practice-challenge-ruling": { const { runPracticeChallengeRuling } = await import("./cli/practice.js"); await runPracticeChallengeRuling(rest, isDryRun); break; }
    case "predict-practice-winner": { const { runPredictPractice } = await import("./cli/practice.js"); await runPredictPractice(rest, isDryRun); break; }
    case "submit-practice-jury-vote": { const { runPracticeJuryVote } = await import("./cli/practice.js"); await runPracticeJuryVote(rest, isDryRun); break; }

    case "set-game-display": {
      const { runSetGameDisplay } = await import("./cli/gateway-cmds.js");
      await runSetGameDisplay(rest, isDryRun);
      break;
    }

    case "set-citizen-avatar": {
      const { runSetCitizenAvatar } = await import("./cli/gateway-cmds.js");
      await runSetCitizenAvatar(rest, isDryRun);
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

    case "cancel-game": {
      const { runCancelGame } = await import("./cli/gateway-cmds.js");
      await runCancelGame(rest, isDryRun);
      break;
    }

    case "profile": {
      if (rest[0] !== "set") fatal('Usage: robotania profile set --display-name "<name>" [--citizen-id <id> | ROBOTANIA_CITIZEN_ID env]');
      const { runProfileSet } = await import("./cli/profile.js");
      await runProfileSet(rest.slice(1), isDryRun);
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

    case "credit-agent":
    case "claim-for": {
      const { runCreditAgent } = await import("./cli/gateway-cmds.js");
      await runCreditAgent(rest, isDryRun);
      break;
    }

    case "expire-obligation": {
      const { runExpireObligation } = await import("./cli/gateway-cmds.js");
      await runExpireObligation(rest, isDryRun);
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

    case "runtime": {
      const { runRuntime } = await import("./cli/runtime.js");
      await runRuntime(rest, isDryRun);
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

async function mainWithTermsReview(): Promise<void> {
  try { await main(); }
  catch (error) {
    await recoverTermsRejection(error, process.argv.includes("--idempotency-key"),
      requestOperatorReview, main);
  }
}

mainWithTermsReview().catch((err) => {
  if (err instanceof GatewayWriteUncertainError) {
    fatalResult({ ok: false, terminal: false, idempotency_key: err.idempotencyKey,
      error: { code: err.errorCode, message: err.detail, next_action: "OPERATOR_REVIEW" },
      recovery: "Outcome unknown. Recover the same action and payload using --idempotency-key; do not create a new key." }, 2);
  }
  if (err instanceof TermsManualRetryError) {
    fatalResult({ ok: false, request_id: err.requestId,
      error: { code: "TERMS_REVIEW_COMPLETED_RETRY_REQUIRED", message: err.message,
        next_action: "RETRY_NEW_REQUEST" } }, 1);
  }
  if (err instanceof GatewayActionFailedError) {
    fatalResult(err.outcome, requestOutcomeExitCode("FAILED"));
  }
  if (err instanceof GatewayActionPendingError) {
    fatalResult(err.outcome ?? {
      request_id: err.requestId,
      terminal: false,
      error: {
        code: "REQUEST_STATUS_UNAVAILABLE",
        message: err.message,
        next_action: "POLL_REQUEST",
      },
    }, requestOutcomeExitCode("PENDING"));
  }
  if (err instanceof GatewayError) {
    const nested = err.response?.error;
    const nextAction = typeof err.response?.next_action === "string" ? err.response.next_action
      : typeof nested === "object" && nested !== null && "next_action" in nested
        && typeof nested.next_action === "string" ? nested.next_action
          : termsReviewNextAction(err) ?? "OPERATOR_REVIEW";
    fatalResult({
      ok: false,
      error: { code: err.errorCode, message: err.detail, next_action: nextAction },
    }, 1);
  }
  fatal((err as Error).message ?? String(err));
});
