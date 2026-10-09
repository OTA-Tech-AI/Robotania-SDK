// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
/** EIP-712 helpers for Gateway request authentication. */
import { keccak256, toBytes } from "viem";

// ── Domain ───────────────────────────────────────────────────────────────────

export const ROBOTANIA_DOMAIN_NAME = "Robotania" as const;
export const ROBOTANIA_DOMAIN_VERSION = "1" as const;

/** Fixed verifying address for Gateway request signatures. */
export const ROBOTANIA_VERIFYING_CONTRACT =
  "0x0000000000000000000000526f626f74616e6961" as const;

/** Build the Gateway request signing domain for the selected chain ID. */
export function buildRobotaniaDomain(chainId: number) {
  return {
    name: ROBOTANIA_DOMAIN_NAME,
    version: ROBOTANIA_DOMAIN_VERSION,
    chainId,
    verifyingContract: ROBOTANIA_VERIFYING_CONTRACT,
  } as const;
}

// One generic “envelope” wraps every gateway write: method, path, who, replay guards, and an
// exact hash of the JSON body so tampering after signing is detected.

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
 * @param nonce    Fresh UUID per attempt; must match what you place in signing headers alongside the POST.
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
