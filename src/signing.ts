// SOURCE COPY from packages/shared/src/signing.ts (Q026)
// Keep in sync manually; do not import from @robotania/shared here.
// NOTE: This file diverges from shared at keccak256Hex — shared uses a dynamic
// require() so it can run without viem as a hard dep. Agent-sdk always has viem,
// so we use a static import here to keep esbuild bundling clean.
import { keccak256, toBytes } from "viem";

/**
 * Q026 — Agent gateway canonical signing: EIP-712 (V1)
 *
 * All authenticated gateway write requests MUST be signed as EIP-712 typed structured data.
 * raw eth_sign / personal_sign is NOT the canonical format for production agents.
 *
 * Sentinel verifyingContract:
 *   0x0000000000000000000000526f626f74616e6961  — 11 zero-bytes + "Robotania" UTF-8 hex (40 hex chars = 20 bytes)
 *   This is NOT a deployed contract. It is a stable domain-separation constant that prevents
 *   cross-application signature replay. All SDK implementations and gateway verifiers MUST use
 *   this exact value.
 */

// ── Domain ───────────────────────────────────────────────────────────────────

export const ROBOTANIA_DOMAIN_NAME = "Robotania" as const;
export const ROBOTANIA_DOMAIN_VERSION = "1" as const;

/**
 * V1 locked (Q026): sentinel verifyingContract for domain separation.
 * Decoded: 0x0000…0000 (11 zero bytes) + "Robotania" as UTF-8 hex (526f626f74616e6961, 9 bytes)
 * = 20 bytes total — a valid EIP-55 address slot, intentionally not a deployed contract.
 *
 * Bug fix: original constant had 12 leading zero bytes (42 hex chars = 21 bytes), which viem
 * rejects at runtime. Corrected to 11 leading zero bytes (40 hex chars = 20 bytes).
 */
export const ROBOTANIA_VERIFYING_CONTRACT =
  "0x0000000000000000000000526f626f74616e6961" as const;

/**
 * Build the EIP-712 domain object for a given chainId.
 * The gateway verifier reads its chainId from CHAIN_ID env; agents derive it from the
 * deployment config or `eth_chainId` RPC call.
 */
export function buildRobotaniaDomain(chainId: number) {
  return {
    name: ROBOTANIA_DOMAIN_NAME,
    version: ROBOTANIA_DOMAIN_VERSION,
    chainId,
    verifyingContract: ROBOTANIA_VERIFYING_CONTRACT,
  } as const;
}

// ── AgentRequest typed struct (V1 generic request) ───────────────────────────
//
// Per Q026, per-action typed structs are the long-term target. For V1, a single generic
// AgentRequest struct covers all write families. Action-specific types are added in a
// follow-up spec/SDK version when the action surface stabilises.
//
// Anti-replay fields per Q026:
//   - citizenId   — binds the signature to the specific citizen (or "pending" for register)
//   - nonce       — idempotency key (UUID); gateway rejects re-use within retention window
//   - deadline    — unix seconds; gateway rejects if now > deadline
//   - payloadHash — keccak256(JSON body); binds the sig to the exact bytes sent

export const AGENT_REQUEST_TYPE = [
  { name: "method", type: "string" },
  { name: "path", type: "string" },
  { name: "citizenId", type: "string" },
  { name: "nonce", type: "string" },
  { name: "deadline", type: "uint64" },
  { name: "payloadHash", type: "bytes32" },
] as const;

export const AGENT_REQUEST_TYPES = {
  AgentRequest: AGENT_REQUEST_TYPE,
} as const;

export type AgentRequestMessage = {
  method: string;
  path: string;
  citizenId: string;
  nonce: string;
  deadline: bigint;
  payloadHash: `0x${string}`;
};

/**
 * Build the EIP-712 message for a gateway write request.
 *
 * @param method   HTTP verb ("POST", "GET")
 * @param path     Full URL path (e.g. "/api/v1/agent/matches/submit-turn")
 * @param citizenId The citizen initiating the request. Use "pending" for register.
 * @param nonce    Caller-supplied idempotency UUID (v4 recommended). Also sent in body.
 * @param deadlineSec Unix timestamp (seconds) after which the gateway rejects the request.
 *                    Recommended: Date.now() / 1000 + 300 (5 min from now).
 * @param body     The JSON body string exactly as it will be sent on the wire.
 */
export function buildAgentRequestMessage(
  method: string,
  path: string,
  citizenId: string,
  nonce: string,
  deadlineSec: number,
  body: string,
): AgentRequestMessage {
  return {
    method,
    path,
    citizenId,
    nonce,
    deadline: BigInt(Math.floor(deadlineSec)),
    payloadHash: keccak256Hex(body),
  };
}

function keccak256Hex(data: string): `0x${string}` {
  return keccak256(toBytes(data));
}
