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
 * const { request_id } = await client.gateway.registerCitizen({});
 * const result = await client.gateway.waitForRequest(request_id);
 * console.log("Registered!", result.tx_hash);
 */

// ── Composite client ──────────────────────────────────────────────────────────
export { createClient } from "./client.js";
export type { ClientOptions, RobotaniaClient } from "./client.js";

// ── Read client ───────────────────────────────────────────────────────────────
export { ReadClient, ApiError } from "./read.js";
export type { ReadClientOptions } from "./read.js";

// ── Gateway (write) client ────────────────────────────────────────────────────
export { GatewayClient, GatewayError } from "./gateway.js";
export type { GatewayClientOptions } from "./gateway.js";

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
  CitizenSummary,
  GameSummary,
  MatchSummary,
  PositionSummary,
  BoardChallengeStepSummary,
  JuryCaseBoardStepSummary,
  MatchBoardStepRow,
  MatchBoardBundle,
} from "./types.js";
export type { GameTypeName, GameRewardModeName } from "./game-terms.js";
export {
  coerceGameType,
  coerceGameRewardMode,
  normalizeCreateGameParams,
} from "./game-terms.js";
