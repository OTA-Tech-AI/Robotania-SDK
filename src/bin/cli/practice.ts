import { readFileSync } from "node:fs";
import { flag, loadGatewayOnlyConfig, requireFlag } from "./config.js";
import { fatal, log, result } from "./output.js";
import { parseMatchSideFlag } from "./side.js";
import { readCoverImageBase64 } from "./cover-image.js";
import { readBoardSymbolMapFile } from "./board-symbol-map.js";
import { dryRunGateway } from "./gateway-cmds.js";
import type { CreatePracticeArenaParams, SetPracticeGameDisplayParams } from "../../gateway.js";
import type { PracticeTurnPayloadContent } from "../../types.js";

function readJsonObject(path: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must contain a JSON object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    fatal(`Failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function optionalCitizenId(args: string[]): string | undefined {
  return flag(args, "--citizen-id") ?? process.env.ROBOTANIA_CITIZEN_ID;
}

function optionalIdempotencyKey(args: string[]): string | undefined {
  return flag(args, "--idempotency-key");
}

function practiceDryRun(path: string, body: Record<string, unknown>, citizenId?: string): void {
  const cfg = loadGatewayOnlyConfig();
  dryRunGateway(path, body, citizenId?.trim() || "pending", cfg.chainId);
}

export async function runCreatePractice(args: string[], isDryRun: boolean): Promise<void> {
  const body = readJsonObject(requireFlag(args, "--params-file", "practice params JSON file"), "--params-file");
  const noFill = args.includes("--no-official-competitor-fill");
  const yesFill = args.includes("--allow-official-competitor-fill");
  if (noFill && yesFill) fatal("Use only one of --allow-official-competitor-fill or --no-official-competitor-fill.");
  if (noFill) body.allowOfficialCompetitorFill = false;
  else if (yesFill) body.allowOfficialCompetitorFill = true;
  const humanDescription = flag(args, "--human-description");
  const coverFile = flag(args, "--cover-image-file");
  const symbolsFile = flag(args, "--board-symbol-map-file");
  if (humanDescription !== undefined) body.humanDescription = humanDescription;
  if (coverFile) body.coverImageBase64 = readCoverImageBase64(coverFile);
  if (symbolsFile) body.boardSymbolMap = readBoardSymbolMapFile(symbolsFile);
  const idempotencyKey = optionalIdempotencyKey(args);
  if (idempotencyKey !== undefined) body.idempotencyKey = idempotencyKey;
  const citizenId = optionalCitizenId(args);
  if (isDryRun) return practiceDryRun("/api/v1/agent/practice/arenas/create", body, citizenId);
  log("Creating Practice Arena (off-chain; no USDC or transaction)...");
  result(await loadGatewayOnlyConfig().gatewayClient.createPracticeArena({ ...body, citizenId } as CreatePracticeArenaParams));
}

export async function runJoinPractice(args: string[], isDryRun: boolean): Promise<void> {
  const idempotencyKey = optionalIdempotencyKey(args);
  const body = { practiceArenaId: requireFlag(args, "--practice-arena-id", "Practice Arena ID"), ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) };
  const citizenId = optionalCitizenId(args);
  if (isDryRun) return practiceDryRun("/api/v1/agent/practice/arenas/join", body, citizenId);
  log("Joining Practice Arena...");
  result(await loadGatewayOnlyConfig().gatewayClient.joinPracticeArena({ ...body, citizenId }));
}

export async function runCancelPractice(args: string[], isDryRun: boolean): Promise<void> {
  const idempotencyKey = optionalIdempotencyKey(args);
  const body = { practiceArenaId: requireFlag(args, "--practice-arena-id", "Practice Arena ID"), ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) };
  const citizenId = optionalCitizenId(args);
  if (isDryRun) return practiceDryRun("/api/v1/agent/practice/arenas/cancel", body, citizenId);
  result(await loadGatewayOnlyConfig().gatewayClient.cancelPracticeArena({ ...body, citizenId }));
}

export async function runSetPracticeGameDisplay(args: string[], isDryRun: boolean): Promise<void> {
  const practiceArenaId = requireFlag(args, "--practice-arena-id", "Practice Arena ID");
  const hasHuman = args.includes("--human-description");
  const hasCover = args.includes("--cover-image-file");
  const hasSymbols = args.includes("--board-symbol-map-file");
  const clearHumanDescription = args.includes("--clear-human-description");
  const clearCoverImage = args.includes("--clear-cover-image");
  const clearBoardSymbolMap = args.includes("--clear-board-symbol-map");
  const idempotencyKey = optionalIdempotencyKey(args);
  if ((!hasHuman && !hasCover && !hasSymbols && !clearHumanDescription && !clearCoverImage && !clearBoardSymbolMap) ||
      (hasHuman && clearHumanDescription) || (hasCover && clearCoverImage) || (hasSymbols && clearBoardSymbolMap)) {
    fatal("Provide at least one display change; a set flag cannot be combined with its matching --clear-* flag.");
  }
  // Flag validation above guarantees this shape has one or more valid changes.
  // Conditional spreads cannot preserve that discriminated union to TypeScript.
  const body = {
    practiceArenaId,
    ...(hasHuman ? { humanDescription: requireFlag(args, "--human-description", "human-facing description") } : {}),
    ...(hasCover ? { coverImageBase64: readCoverImageBase64(requireFlag(args, "--cover-image-file", "cover image file")) } : {}),
    ...(hasSymbols ? { boardSymbolMap: readBoardSymbolMapFile(requireFlag(args, "--board-symbol-map-file", "board symbol map JSON file")) } : {}),
    ...(clearHumanDescription ? { clearHumanDescription: true } : {}),
    ...(clearCoverImage ? { clearCoverImage: true } : {}),
    ...(clearBoardSymbolMap ? { clearBoardSymbolMap: true } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  } as SetPracticeGameDisplayParams;
  const citizenId = optionalCitizenId(args);
  if (isDryRun) {
    return practiceDryRun(
      "/api/v1/agent/practice/arenas/set-display",
      body as Record<string, unknown>,
      citizenId,
    );
  }
  log("Updating Practice Arena display metadata...");
  result(await loadGatewayOnlyConfig().gatewayClient.setPracticeGameDisplay({ ...body, citizenId }));
}

export async function runSubmitPracticeTurn(args: string[], isDryRun: boolean): Promise<void> {
  const idempotencyKey = optionalIdempotencyKey(args);
  const body = {
    practiceMatchId: requireFlag(args, "--practice-match-id", "Practice match ID"),
    payloadContent: readJsonObject(
      requireFlag(args, "--payload-file", "turn payload JSON file"),
      "--payload-file",
    ) as PracticeTurnPayloadContent,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
  const citizenId = optionalCitizenId(args);
  if (isDryRun) return practiceDryRun("/api/v1/agent/practice/matches/submit-turn", body, citizenId);
  result(await loadGatewayOnlyConfig().gatewayClient.submitPracticeTurn({ ...body, citizenId }));
}

export async function runPredictPractice(args: string[], isDryRun: boolean): Promise<void> {
  const idempotencyKey = optionalIdempotencyKey(args);
  const body = { practiceMatchId: requireFlag(args, "--practice-match-id", "Practice match ID"), side: parseMatchSideFlag(requireFlag(args, "--side", "Side A/B")), ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) };
  const citizenId = optionalCitizenId(args);
  if (isDryRun) return practiceDryRun("/api/v1/agent/practice/matches/predict", body, citizenId);
  result(await loadGatewayOnlyConfig().gatewayClient.predictPracticeWinner({ ...body, citizenId, side: body.side === 1 ? 1 : 2 }));
}

export async function runPracticeJuryVote(args: string[], isDryRun: boolean): Promise<void> {
  const idempotencyKey = optionalIdempotencyKey(args);
  const body = { practiceJuryCaseId: requireFlag(args, "--practice-jury-case-id", "Practice jury case ID"), outcomeSide: parseMatchSideFlag(requireFlag(args, "--side", "Side A/B")), reasonText: requireFlag(args, "--reason", "jury reason"), ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) };
  const citizenId = optionalCitizenId(args);
  if (isDryRun) return practiceDryRun("/api/v1/agent/practice/jury/vote", body, citizenId);
  result(await loadGatewayOnlyConfig().gatewayClient.submitPracticeJuryVote({ ...body, citizenId, outcomeSide: body.outcomeSide === 1 ? 1 : 2 }));
}
