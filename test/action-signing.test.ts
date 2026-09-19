import { describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, parseAbi, toBytes, verifyTypedData } from "viem";
import { createRandom } from "../src/wallet.js";
import {
  signPreparedCitizenAction,
  type PreparedCitizenAction,
} from "../src/action-signing.js";

const vaultAbi = parseAbi([
  "function withdrawOperational(uint256 citizenId,uint256 amount)",
]);
const juryAbi = parseAbi([
  "function submitJuryVote(uint256 juryCaseId,uint256 jurorCitizenId,uint8 outcome,bytes32 reasonHash)",
  "function submitJuryRubric(uint256 juryCaseId,uint256 jurorCitizenId,bytes32 rubricHash)",
]);
const matchAbi = parseAbi([
  "function submitTurn(uint256 matchId,uint256 citizenId,uint32 expectedTurnNumber,bytes32 payloadHash,string payloadURI)",
]);
const TRUSTED_RELAY = "0x00000000000000000000000000000000000000a1" as const;

function prepared(calldata: `0x${string}`, overrides: Partial<PreparedCitizenAction> = {}): PreparedCitizenAction {
  return {
    preparation_id: "prep-1",
    citizen_id: "42",
    relay: TRUSTED_RELAY,
    chain_id: 421614,
    authorization_version: "1",
    target: "0x00000000000000000000000000000000000000b2",
    calldata,
    calldata_hash: keccak256(calldata),
    nonce: "9001",
    deadline: String(Math.floor(Date.now() / 1000) + 600),
    ...overrides,
  };
}

describe("Citizen action preparation signing", () => {
  it("signs the exact prepared call with the CitizenAction domain", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 5_000_000n],
    });
    const action = prepared(calldata);

    const headers = await signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      action,
    );

    expect(headers["x-agent-action-preparation"]).toBe("prep-1");
    expect(await verifyTypedData({
      address: wallet.address,
      domain: {
        name: "Robotania Citizen Action",
        version: "1",
        chainId: 421614,
        verifyingContract: action.relay,
      },
      types: {
        CitizenAction: [
          { name: "authorizationVersion", type: "uint64" },
          { name: "citizenId", type: "uint256" },
          { name: "target", type: "address" },
          { name: "dataHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "CitizenAction",
      message: {
        authorizationVersion: 1n,
        citizenId: 42n,
        target: action.target,
        dataHash: action.calldata_hash,
        nonce: 9001n,
        deadline: BigInt(action.deadline),
      },
      signature: headers["x-agent-action-signature"] as `0x${string}`,
    })).toBe(true);
  });

  it("uses the canonical prepared Citizen when the HTTP request identifies the wallet only", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 5_000_000n],
    });
    const action = prepared(calldata);

    const headers = await signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "pending",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      action,
    );

    expect(await verifyTypedData({
      address: wallet.address,
      domain: {
        name: "Robotania Citizen Action",
        version: "1",
        chainId: 421614,
        verifyingContract: action.relay,
      },
      types: {
        CitizenAction: [
          { name: "authorizationVersion", type: "uint64" },
          { name: "citizenId", type: "uint256" },
          { name: "target", type: "address" },
          { name: "dataHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "CitizenAction",
      message: {
        authorizationVersion: 1n,
        citizenId: 42n,
        target: action.target,
        dataHash: action.calldata_hash,
        nonce: 9001n,
        deadline: BigInt(action.deadline),
      },
      signature: headers["x-agent-action-signature"] as `0x${string}`,
    })).toBe(true);
  });

  it("refuses calldata whose amount differs from the signed HTTP intent", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 6_000_000n],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      prepared(calldata),
    )).rejects.toThrow("changed amount");
  });

  it("refuses a preparation for another chain", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 5_000_000n],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      prepared(calldata, { chain_id: 1 }),
    )).rejects.toThrow("does not match configured chain");
  });

  it("refuses a preparation for an untrusted Relay contract", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 5_000_000n],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      "0x00000000000000000000000000000000000000c3",
      "42",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      prepared(calldata),
    )).rejects.toThrow("does not match the trusted deployment");
  });

  it("refuses a preparation whose permit lifetime is unexpectedly long", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 5_000_000n],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      prepared(calldata, { deadline: String(Math.floor(Date.now() / 1000) + 31 * 60) }),
    )).rejects.toThrow("unexpectedly far in the future");
  });

  it("refuses a malformed requested Citizen id", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawOperational",
      args: [42n, 5_000_000n],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "citizen-42",
      "/api/v1/agent/stakes/withdraw-operational",
      { amount: "5000000" },
      prepared(calldata),
    )).rejects.toThrow("requested citizen_id");
  });

  it("refuses a jury reason hash that differs from the signed HTTP intent", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: juryAbi,
      functionName: "submitJuryVote",
      args: [7n, 42n, 1, keccak256(toBytes("different reason"))],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/jury/submit-vote",
      {
        juryCaseId: "7",
        jurorCitizenId: "42",
        outcome: 1,
        reasonText: "This is the actual sufficiently detailed jury reason.",
      },
      prepared(calldata),
    )).rejects.toThrow("changed the jury vote reason");
  });

  it("accepts the Gateway canonical jury reason hash", async () => {
    const wallet = createRandom();
    const reasonText = "This is the actual sufficiently detailed jury reason.";
    const canonicalReason = JSON.stringify({
      juror_citizen_id: "42",
      jury_case_id: "7",
      outcome: 1,
      reason_text: reasonText,
      schema: "jury_vote_reason_v1",
    });
    const calldata = encodeFunctionData({
      abi: juryAbi,
      functionName: "submitJuryVote",
      args: [7n, 42n, 1, keccak256(toBytes(canonicalReason))],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/jury/submit-vote",
      { juryCaseId: "7", jurorCitizenId: "42", outcome: 1, reasonText },
      prepared(calldata),
    )).resolves.toMatchObject({ "x-agent-action-preparation": "prep-1" });
  });

  it("refuses a rubric hash that differs from the signed HTTP intent", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: juryAbi,
      functionName: "submitJuryRubric",
      args: [7n, 42n, keccak256(toBytes("different rubric"))],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/jury/submit-rubric",
      {
        juryCaseId: "7",
        jurorCitizenId: "42",
        rubric: {
          summary: "This is the actual sufficiently detailed rubric summary.",
          logic_consistency: { A: 8, B: 7 },
          evidence_quality: { A: 9, B: 6 },
          rebuttal_effectiveness: { A: 7, B: 8 },
          fallacy_count: { A: 1, B: 2 },
        },
      },
      prepared(calldata),
    )).rejects.toThrow("changed the jury rubric");
  });

  it("refuses a debate turn hash that differs from payloadContent", async () => {
    const wallet = createRandom();
    const calldata = encodeFunctionData({
      abi: matchAbi,
      functionName: "submitTurn",
      args: [9n, 42n, 3, keccak256(toBytes("different turn")), "https://example.invalid/turn"],
    });

    await expect(signPreparedCitizenAction(
      wallet,
      421614,
      TRUSTED_RELAY,
      "42",
      "/api/v1/agent/matches/submit-turn",
      {
        matchId: "9",
        citizenId: "42",
        payloadContent: { schemaVersion: 1, text: "The actual debate turn." },
      },
      prepared(calldata),
    )).rejects.toThrow("changed the submitted turn payload hash");
  });
});
