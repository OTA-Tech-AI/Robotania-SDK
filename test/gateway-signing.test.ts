/**
 * Gateway EIP-712 signing invariants — verify the typed-data signature format
 * matches what packages/gateway/src/middleware/auth.ts expects.
 *
 * The gateway auth protocol (auth.ts uses verifyTypedData from viem):
 *   domain   = buildRobotaniaDomain(chainId)
 *   types    = AGENT_REQUEST_TYPES
 *   message  = { method, path, citizenId, nonce, deadline: BigInt, payloadHash }
 *   payloadHash = keccak256(toBytes(JSON.stringify(body)))
 *
 * The SDK's GatewayClient.signRequest() builds the same typed struct.
 */

import { describe, it, expect } from "vitest";
import { createRandom } from "../src/wallet.js";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, keccak256, toBytes } from "viem";
import {
  buildRobotaniaDomain,
  AGENT_REQUEST_TYPES,
  type AgentRequestMessage,
} from "../src/signing.js";

describe("gateway EIP-712 signing protocol", () => {
  it("signature produced by the SDK's signRequest is verifiable with verifyTypedData", async () => {
    const wallet = createRandom();
    const account = privateKeyToAccount(wallet.privateKey);

    const chainId = 31337;
    const method = "POST";
    const path = "/api/v1/agent/citizens/register";
    const citizenId = "pending";
    const nonce = crypto.randomUUID();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const bodyStr = JSON.stringify({ walletAddress: wallet.address });
    const payloadHash = keccak256(toBytes(bodyStr));

    const message: AgentRequestMessage = { method, path, citizenId, nonce, deadline, payloadHash };
    const domain = buildRobotaniaDomain(chainId);

    const signature = await account.signTypedData({
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message,
    });

    const valid = await verifyTypedData({
      address: wallet.address,
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("signature from wrong key does NOT verify", async () => {
    const walletA = createRandom();
    const walletB = createRandom();
    const accountB = privateKeyToAccount(walletB.privateKey);

    const chainId = 31337;
    const nonce = crypto.randomUUID();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const bodyStr = "{}";
    const payloadHash = keccak256(toBytes(bodyStr));
    const message: AgentRequestMessage = {
      method: "POST",
      path: "/api/v1/agent/test",
      citizenId: "1",
      nonce,
      deadline,
      payloadHash,
    };
    const domain = buildRobotaniaDomain(chainId);

    const signature = await accountB.signTypedData({
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message,
    });

    const valid = await verifyTypedData({
      address: walletA.address,
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message,
      signature,
    });
    expect(valid).toBe(false);
  });

  it("signature with tampered body does NOT verify", async () => {
    const wallet = createRandom();
    const account = privateKeyToAccount(wallet.privateKey);

    const chainId = 31337;
    const nonce = crypto.randomUUID();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const domain = buildRobotaniaDomain(chainId);

    const originalBody = JSON.stringify({ a: 1 });
    const tamperedBody = JSON.stringify({ a: 2 });

    const originalMsg: AgentRequestMessage = {
      method: "POST",
      path: "/api/v1/agent/test",
      citizenId: "1",
      nonce,
      deadline,
      payloadHash: keccak256(toBytes(originalBody)),
    };
    const tamperedMsg: AgentRequestMessage = { ...originalMsg, payloadHash: keccak256(toBytes(tamperedBody)) };

    const signature = await account.signTypedData({
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message: originalMsg,
    });

    const valid = await verifyTypedData({
      address: wallet.address,
      domain,
      types: AGENT_REQUEST_TYPES,
      primaryType: "AgentRequest",
      message: tamperedMsg,
      signature,
    });
    expect(valid).toBe(false);
  });
});
