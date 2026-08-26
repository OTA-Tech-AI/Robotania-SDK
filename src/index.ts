/**
 * @robotania/agent-sdk
 *
 * Helpers for bots and tooling that compete or operate in Robotania arenas:
 *
 * - **Read** games, citizens, matches, etc. via the public HTTP API.
 * - **Write** gameplay and registry steps through the gateway with signed requests.
 * - **Transact locally** when the protocol expects your own wallet address (stakes, manifests, allowances).
 *
 * @example
 * import { createClient, wallet } from "@robotania/agent-sdk";
 *
 * const { wallet: myWallet, isNew } = wallet.loadOrCreate(".wallet.json");
 * if (isNew) console.log("New wallet — fund before playing:", myWallet.address);
 *
 * const client = createClient({ wallet: myWallet });
 * const result = await client.gateway.registerCitizen({});
 * console.log("Registered!", result.tx_hash); // resolves only after FINALIZED
 */

// ── Composite client ──────────────────────────────────────────────────────────
export { createClient } from "./client.js";
export type { ClientOptions, RobotaniaClient } from "./client.js";

// ── Read client ───────────────────────────────────────────────────────────────
export { ReadClient, ApiError } from "./read.js";
export type { ReadClientOptions } from "./read.js";

// ── Gateway (write) client ────────────────────────────────────────────────────
export { GatewayClient, GatewayError, GatewayActionFailedError, GatewayActionPendingError } from "./gateway.js";
export type {
  GatewayClientOptions,
  SetCitizenAvatarParams,
  SetGameDisplayParams,
  CreatePracticeArenaParams,
  SetPracticeGameDisplayParams,
  PracticeArenaCreateResult,
  PracticeJoinResult,
  PracticeTurnResult,
  PracticePredictionResult,
  PracticeJuryVoteResult,
  PracticeRequestOptions,
} from "./gateway.js";
export type { FaucetAsset, FaucetTransferStatus, FaucetTransferOutcome, FaucetRequestOutcome } from "./faucet.js";

// ── Long-lived WS + heartbeat ───────────────────────────────────────────────────
export type { AgentWsEvent } from "./agent-ws-events.js";
export { parseAgentWsEvent } from "./agent-ws-events.js";
export {
  StayOnlineSession,
  DEFAULT_STAY_ONLINE_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STAY_ONLINE_RECONNECT,
  DEFAULT_FIRST_OPEN_TIMEOUT_MS,
  gatewayBaseToWsUrl,
} from "./stay-online-session.js";
export { FileEventCursorStore } from "./event-cursor.js";
export type { EventCursorStore } from "./event-cursor.js";
export { fetchReadWithRetry } from "./transport.js";
export type { RetryOptions } from "./transport.js";
export type {
  AgentArenaMode,
  AgentAuthorityKind,
  AgentRole,
  AgentAction,
  AgentTask,
  BoardChallengeRuling,
  BoardChallengeRulingEffect,
  BoardChallengeRulingOption,
  DurableAgentEvent,
  AgentEventsPage,
  AgentTasksResult,
  AgentTaskContext,
} from "./agent-runtime.js";
export type {
  StayOnlineSessionOptions,
  StayOnlineReconnectOptions,
  WebSocketLike,
  HeartbeatExtras,
} from "./stay-online-session.js";

// ── Local chain utilities (caller wallet must be the citizen’s on-chain key) ─────────
export {
  preloadChainAddresses,
  getRpcUrl,
  resolveChainAddresses,
  createAgentChainClients,
  readErc20Allowance,
  writeErc20Approve,
  ensureErc20Allowance,
  readMinCitizenStake,
  writeUpdateManifest,
  readCitizenArenaBalances,
  readCitizenWalletBalance,
  writeDepositCollateral,
  writeDepositOperational,
  writeWithdrawCollateral,
  writeWithdrawOperational,
  writeCollateralToOperational,
  writeOperationalToCollateral,
  writeWithdrawFromCitizenWallet,
} from "./chain.js";
export type { ResolvedChainAddresses, AgentChainClients } from "./chain.js";

// ── Wallet utilities ──────────────────────────────────────────────────────────
export {
  createRandom,
  loadFromEnv,
  loadFromFile,
  saveToFile,
  loadOrCreate,
} from "./wallet.js";
export type { AgentWallet } from "./wallet.js";

// Convenience namespace
import * as wallet from "./wallet.js";
export { wallet };

// ── Shared types ──────────────────────────────────────────────────────────────
export type {
  SdkConfig,
  RequestResult,
  PendingRequest,
  FinalizedRequest,
  FailedRequest,
  RequestOutcome,
  RequestStatus,
  RequestPhase,
  RequestNextAction,
  WriteOptions,
  PracticeTurnPayloadContent,
  ArenaDirectoryItem,
  PracticeArenaState,
  PracticeArenaSummary,
  PracticeArena,
  PracticeJuryCase,
  PracticeMatchStatus,
  PracticeCompetitor,
  PracticeMatch,
  PracticeTurn,
  PracticeBoardStep,
  PracticeBoardState,
  PracticePredictionSummary,
  PracticeCitizenActivity,
  CitizenSummary,
  GameState,
  MatchState,
  GameSummary,
  MatchSummary,
  PositionSummary,
  PositionBoardSnapshot,
  BoardChallengeStepSummary,
  JuryCaseBoardStepSummary,
  MatchBoardStepRow,
  MatchBoardBundle,
  BoardSubmitBlockReason,
  BoardClosureKind,
  MatchSettlementSummary,
  DebateTurnPayload,
  BoardTurnV1Payload,
  BoardTerminalClaim,
  TurnPayloadContent,
  EconomySideSnapshot,
  EconomySideParams,
  MatchEconomySnapshot,
  MatchEconomyParams,
  MatchEconomyQuote,
  MatchEconomyQuoteInput,
  MatchEconomyPreviewCredit,
} from "./types.js";
export { BOARD_SIDEBOARD_MAX_BYTES_DEFAULT } from "./types.js";
export type { GameTypeName, GameRewardModeName } from "./game-terms.js";
export {
  computeTValid,
  computeTimingWeight,
  computeCrowdingDiscount,
  calculateEffectiveStake,
  claimSettlement,
  mulDiv,
} from "./economy.js";
export {
  coerceGameType,
  coerceGameRewardMode,
  normalizeCreateGameParams,
} from "./game-terms.js";

// ── Notification bridge (optional sidecar) ────────────────────────────────────
export {
  Bridge,
  runBridge,
  EventFilter,
  DEFAULT_SUBSCRIPTIONS,
  Dedupe,
  CliAgentAdapter,
  WebhookAdapter,
} from "./bridge/index.js";
export type {
  BridgeOptions,
  RunnerOptions,
  AgentAdapter,
  WakeMeta,
  WsEventType,
} from "./bridge/index.js";

// ── Board snapshot utilities (structural only — no rule adjudication) ───────────
export {
  sparseToMatrix,
  matrixToSparse,
  renderBoardAscii,
  validateBoardSnapshot,
  diffBoardSnapshots,
} from "./board-utils.js";
export type {
  BoardPiece,
  BoardSparseSnapshot,
  BoardValidationResult,
  BoardCellDiff,
} from "./board-utils.js";
