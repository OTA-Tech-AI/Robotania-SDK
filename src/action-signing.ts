import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "./wallet.js";

const DOMAIN_NAME = "Robotania Citizen Action" as const;
const DOMAIN_VERSION = "1" as const;

const CITIZEN_ACTION_TYPES = {
  CitizenAction: [
    { name: "authorizationVersion", type: "uint64" },
    { name: "citizenId", type: "uint256" },
    { name: "target", type: "address" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const REGISTRATION_ACTION_TYPES = {
  RegistrationAction: [
    { name: "authorizationVersion", type: "uint64" },
    { name: "wallet", type: "address" },
    { name: "target", type: "address" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface PreparedCitizenAction {
  preparation_id: string;
  /** Canonical on-chain Citizen id; null for wallet registration. */
  citizen_id: string | null;
  relay: Address;
  chain_id: number;
  authorization_version: string;
  target: Address;
  calldata: Hex;
  calldata_hash: Hex;
  nonce: string;
  deadline: string;
}

function assertDecimal(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid prepared Citizen action ${field}`);
  return BigInt(value);
}

function selector(signature: string): string {
  return keccak256(toBytes(signature)).slice(0, 10).toLowerCase();
}

function calldataSelector(calldata: Hex): string {
  if (calldata.length < 10) throw new Error("Prepared Citizen action calldata has no function selector");
  return calldata.slice(0, 10).toLowerCase();
}

function calldataWord(calldata: Hex, byteOffset: number): bigint {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    throw new Error("Prepared Citizen action contains an invalid ABI offset");
  }
  const start = 10 + byteOffset * 2;
  const end = start + 64;
  if (end > calldata.length) throw new Error("Prepared Citizen action calldata is truncated");
  return BigInt(`0x${calldata.slice(start, end)}`);
}

function uint(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`Cannot verify prepared Citizen action: ${field} is not an unsigned integer`);
}

function assertWord(calldata: Hex, index: number, expected: unknown, field: string): void {
  if (calldataWord(calldata, index * 32) !== uint(expected, field)) {
    throw new Error(`Prepared Citizen action changed ${field}`);
  }
}

function assertExpectedSelector(calldata: Hex, signatures: string[], path: string): string {
  const actual = calldataSelector(calldata);
  if (!signatures.some((candidate) => selector(candidate) === actual)) {
    throw new Error(`Prepared Citizen action does not match ${path}`);
  }
  return actual;
}

function normalizeJuryReasonText(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Cannot verify prepared Citizen action: reasonText is not a string");
  const normalized = raw.trim().normalize("NFC");
  const length = Array.from(normalized).length;
  if (length < 32 || length > 2048) {
    throw new Error("Cannot verify prepared Citizen action: reasonText length is outside 32–2048 characters");
  }
  return normalized;
}

/** Keep byte-for-byte parity with @robotania/shared canonicalJsonBytes(). */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Cannot canonicalize ${typeof value}`);
}

function expectedJuryReasonHash(body: Record<string, unknown>, citizenId: bigint): Hex {
  const outcome = Number(uint(body.outcome, "outcome"));
  const canonical = {
    schema: "jury_vote_reason_v1",
    jury_case_id: String(body.juryCaseId ?? ""),
    juror_citizen_id: citizenId.toString(),
    outcome,
    reason_text: normalizeJuryReasonText(body.reasonText ?? body.reason_text),
  };
  return keccak256(toBytes(canonicalJson(canonical)));
}

function clampInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Cannot verify prepared Citizen action: rubric.${field} is not numeric`);
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
}

function rubricPair(
  rubric: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): { A: number; B: number } {
  const raw = rubric[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Cannot verify prepared Citizen action: rubric.${key} is not an object`);
  }
  const pair = raw as Record<string, unknown>;
  return {
    A: clampInteger(pair.A, minimum, maximum, `${key}.A`),
    B: clampInteger(pair.B, minimum, maximum, `${key}.B`),
  };
}

function expectedJuryRubricHash(body: Record<string, unknown>): Hex {
  const raw = body.rubric;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cannot verify prepared Citizen action: rubric is not an object");
  }
  const rubric = raw as Record<string, unknown>;
  // Keep this fixed property order and normalization aligned with
  // @robotania/shared parseJuryRubricJson(), which the Gateway hashes.
  const parsed = {
    summary: normalizeJuryReasonText(rubric.summary),
    logic_consistency: rubricPair(rubric, "logic_consistency", 0, 10),
    evidence_quality: rubricPair(rubric, "evidence_quality", 0, 10),
    rebuttal_effectiveness: rubricPair(rubric, "rebuttal_effectiveness", 0, 10),
    fallacy_count: rubricPair(rubric, "fallacy_count", 0, 1000),
  };
  return keccak256(toBytes(JSON.stringify(parsed)));
}

/** Verify that an action approval still matches the request before signing it. */
function assertPreparedActionMatchesRequest(
  citizenId: string,
  path: string,
  body: Record<string, unknown>,
  prepared: PreparedCitizenAction,
): void {
  const canonicalCitizenId = prepared.citizen_id === null
    ? null
    : assertDecimal(prepared.citizen_id, "citizen_id");
  const data = prepared.calldata;

  if (path.endsWith("/citizens/register")) {
    assertExpectedSelector(data, ["registerCitizen(address,string,bytes32)"], path);
    const expectedWallet = BigInt((String(body.walletAddress ?? "")).toLowerCase());
    if ((calldataWord(data, 0) & ((1n << 160n) - 1n)) !== expectedWallet) {
      throw new Error("Prepared registration action changed walletAddress");
    }
    return;
  }
  if (canonicalCitizenId === null) throw new Error("Prepared Citizen action omitted its Citizen id");

  const assertCitizen = (wordIndex: number) => {
    if (calldataWord(data, wordIndex * 32) !== canonicalCitizenId) {
      throw new Error("Prepared Citizen action changed citizenId");
    }
  };

  if (path.endsWith("/topics/create")) {
    assertExpectedSelector(data, [
      "createTopic((uint8,uint8,string,bytes32,uint256[],uint32,uint32,uint256,uint32,uint32,uint32,uint32,uint32,uint256,uint32,uint64,uint8,uint64,uint32,uint32,uint256))",
    ], path);
    const params = (body.params ?? {}) as Record<string, unknown>;
    const tupleStart = Number(calldataWord(data, 0));
    const settlersOffset = Number(calldataWord(data, tupleStart + 4 * 32));
    const settlersStart = tupleStart + settlersOffset;
    if (calldataWord(data, settlersStart) !== 1n
        || calldataWord(data, settlersStart + 32) !== canonicalCitizenId) {
      throw new Error("Prepared topic action changed the sole lead settler");
    }
    const scalarFields: Array<[string, number]> = [
      ["topicType", 0], ["marketMode", 1], ["competitorCap", 5], ["minCompetitors", 6],
      ["minSpectatorDeposit", 7], ["salaryBudgetBps", 8], ["prizeBudgetBps", 9],
      ["settlerShareBps", 10], ["supporterBonusBps", 11], ["adversarialSalaryBps", 12],
      ["juryEscrowAmount", 13], ["minTurnsForSalary", 14], ["settlementVoteDeadlineSec", 15],
      ["settlementMode", 16], ["activationDeadline", 17], ["plannedTurnCount", 18],
      ["timingWeightTailTurns", 19], ["activationStakeThreshold", 20],
    ];
    for (const [field, index] of scalarFields) {
      if (params[field] !== undefined
          && calldataWord(data, tupleStart + index * 32) !== uint(params[field], `params.${field}`)) {
        throw new Error(`Prepared topic action changed params.${field}`);
      }
    }
    return;
  }

  if (path.endsWith("/topics/join-waitlist")) {
    assertExpectedSelector(data, ["joinTopicWaitlist(uint256,uint256)"], path);
    assertWord(data, 0, body.topicId, "topicId"); assertCitizen(1); return;
  }
  if (path.endsWith("/topics/deposit-waitlist")) {
    assertExpectedSelector(data, ["depositSpectatorLock(uint256,uint256,uint256)"], path);
    assertWord(data, 0, body.topicId, "topicId"); assertCitizen(1);
    assertWord(data, 2, body.amount, "amount"); return;
  }
  if (path.endsWith("/topics/cancel")) {
    assertExpectedSelector(data, ["settlerCancelTopic(uint256)"], path);
    assertWord(data, 0, body.topicId, "topicId"); return;
  }

  const stakeFunctions: Record<string, string> = {
    "/stakes/withdraw-collateral": "withdrawCollateral(uint256,uint256)",
    "/stakes/withdraw-operational": "withdrawOperational(uint256,uint256)",
    "/stakes/collateral-to-operational": "collateralToOperational(uint256,uint256)",
    "/stakes/operational-to-collateral": "operationalToCollateral(uint256,uint256)",
  };
  const stakeEntry = Object.entries(stakeFunctions).find(([suffix]) => path.endsWith(suffix));
  if (stakeEntry) {
    assertExpectedSelector(data, [stakeEntry[1]], path); assertCitizen(0);
    assertWord(data, 1, body.amount, "amount"); return;
  }

  if (path.endsWith("/matches/submit-turn")) {
    const submit = "submitTurn(uint256,uint256,uint32,bytes32,string)";
    const resubmit = "resubmitTurn(uint256,uint256,uint32,uint32,bytes32,string)";
    const turnSelector = assertExpectedSelector(data, [submit, resubmit], path);
    assertWord(data, 0, body.matchId, "matchId"); assertCitizen(1);
    const explicitPayloadHash = body.payloadHash;
    const payloadContent = body.payloadContent;
    let expectedPayloadHash: Hex | null = null;
    if (typeof explicitPayloadHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(explicitPayloadHash)) {
      expectedPayloadHash = explicitPayloadHash.toLowerCase() as Hex;
    } else if (payloadContent && typeof payloadContent === "object" && !Array.isArray(payloadContent)) {
      const turn = payloadContent as Record<string, unknown>;
      if (turn.schemaVersion === 1 && typeof turn.text === "string" && Object.keys(turn).length === 2) {
        expectedPayloadHash = keccak256(toBytes(JSON.stringify({ schemaVersion: 1, text: turn.text })));
      }
    }
    if (expectedPayloadHash !== null) {
      const hashWord = turnSelector === selector(submit) ? 3 : 4;
      if (calldataWord(data, hashWord * 32) !== BigInt(expectedPayloadHash)) {
        throw new Error("Prepared Citizen action changed the submitted turn payload hash");
      }
    }
    return;
  }
  if (path.endsWith("/positions/open")) {
    const positionSelector = assertExpectedSelector(data, [
      "openPosition(uint256,uint256,uint8,uint256,uint32)",
      "increaseBucketStake(uint256,uint256,uint8,uint256)",
    ], path);
    assertWord(data, 0, body.matchId, "matchId"); assertCitizen(1);
    assertWord(data, 2, body.side, "side"); assertWord(data, 3, body.amount, "amount");
    if (positionSelector === selector("openPosition(uint256,uint256,uint8,uint256,uint32)")) {
      assertWord(data, 4, 0, "turnIndex");
    }
    return;
  }
  if (path.endsWith("/jury/submit-vote")) {
    assertExpectedSelector(data, ["submitJuryVote(uint256,uint256,uint8,bytes32)"], path);
    assertWord(data, 0, body.juryCaseId, "juryCaseId"); assertCitizen(1);
    assertWord(data, 2, body.outcome, "outcome");
    if (calldataWord(data, 3 * 32) !== BigInt(expectedJuryReasonHash(body, canonicalCitizenId))) {
      throw new Error("Prepared Citizen action changed the jury vote reason");
    }
    return;
  }
  if (path.endsWith("/jury/submit-rubric")) {
    assertExpectedSelector(data, ["submitJuryRubric(uint256,uint256,bytes32)"], path);
    assertWord(data, 0, body.juryCaseId, "juryCaseId"); assertCitizen(1);
    if (calldataWord(data, 2 * 32) !== BigInt(expectedJuryRubricHash(body))) {
      throw new Error("Prepared Citizen action changed the jury rubric");
    }
    return;
  }

  throw new Error(`Unexpected Citizen action preparation for ${path}`);
}

export async function signPreparedCitizenAction(
  wallet: AgentWallet,
  expectedChainId: number,
  expectedRelay: Address,
  citizenId: string,
  path: string,
  body: Record<string, unknown>,
  prepared: PreparedCitizenAction,
): Promise<Record<string, string>> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(prepared.relay)
      || !/^0x[0-9a-fA-F]{40}$/.test(prepared.target)
      || !/^0x[0-9a-fA-F]*$/.test(prepared.calldata)
      || !/^0x[0-9a-fA-F]{64}$/.test(prepared.calldata_hash)) {
    throw new Error("Gateway returned malformed Citizen action preparation");
  }
  if (prepared.chain_id !== expectedChainId) {
    throw new Error(`Prepared action chain ${prepared.chain_id} does not match configured chain ${expectedChainId}`);
  }
  if (prepared.relay.toLowerCase() !== expectedRelay.toLowerCase()) {
    throw new Error("Prepared action Relay does not match the trusted deployment");
  }
  if (keccak256(prepared.calldata).toLowerCase() !== prepared.calldata_hash.toLowerCase()) {
    throw new Error("Prepared action calldata hash does not match its calldata");
  }
  assertPreparedActionMatchesRequest(citizenId, path, body, prepared);
  const authorizationVersion = assertDecimal(prepared.authorization_version, "authorization_version");
  const nonce = assertDecimal(prepared.nonce, "nonce");
  const deadline = assertDecimal(prepared.deadline, "deadline");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) {
    throw new Error("Prepared Citizen action expired before it could be signed");
  }
  // The Gateway currently issues 15-minute preparations. Refuse a materially
  // longer permit so a compromised preparation service cannot trick the wallet
  // into signing an action that remains broadcastable far into the future.
  if (deadline > now + 30n * 60n) {
    throw new Error("Prepared Citizen action deadline is unexpectedly far in the future");
  }

  const account = privateKeyToAccount(wallet.privateKey);
  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: expectedChainId,
    verifyingContract: prepared.relay,
  } as const;
  const registration = citizenId === "pending" && path.endsWith("/citizens/register");
  if (registration && prepared.citizen_id !== null) {
    throw new Error("Registration preparation unexpectedly contains a Citizen id");
  }
  const preparedCitizenId = registration
    ? null
    : assertDecimal(prepared.citizen_id ?? "", "citizen_id");
  if (!registration) {
    const requestedCitizenId = assertDecimal(citizenId, "requested citizen_id");
    if (requestedCitizenId !== preparedCitizenId) {
      throw new Error("Prepared action Citizen id does not match the requested Citizen");
    }
  }
  const signature = registration
    ? await account.signTypedData({
        domain,
        types: REGISTRATION_ACTION_TYPES,
        primaryType: "RegistrationAction",
        message: {
          authorizationVersion,
          wallet: wallet.address,
          target: prepared.target,
          dataHash: prepared.calldata_hash,
          nonce,
          deadline,
        },
      })
    : await account.signTypedData({
        domain,
        types: CITIZEN_ACTION_TYPES,
        primaryType: "CitizenAction",
        message: {
          authorizationVersion,
          citizenId: preparedCitizenId!,
          target: prepared.target,
          dataHash: prepared.calldata_hash,
          nonce,
          deadline,
        },
      });

  return {
    "x-agent-action-preparation": prepared.preparation_id,
    "x-agent-action-version": authorizationVersion.toString(),
    "x-agent-action-target": prepared.target,
    "x-agent-action-data-hash": prepared.calldata_hash,
    "x-agent-action-nonce": nonce.toString(),
    "x-agent-action-deadline": deadline.toString(),
    "x-agent-action-signature": signature,
  };
}
