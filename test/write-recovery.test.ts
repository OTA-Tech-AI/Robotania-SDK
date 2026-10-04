import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayActionPendingError, GatewayClient, GatewayWriteUncertainError } from "../src/gateway.js";
import { createRandom } from "../src/wallet.js";
import { writeRequestOptions } from "../src/bin/cli/config.js";

const outcome = { request_id: "original", action: "test", status: "FINALIZED", terminal: true,
  phase: "FINALIZED", tx_hash: "0x1", result: {}, next_action: "NONE" };
const reply = () => new Response(JSON.stringify({ ok: true, data: outcome }));
const client = () => new GatewayClient({ baseUrl: "http://localhost:9", chainId: 421614, wallet: createRandom(),
  writeOptions: { mode: "async" } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("public logical-write recovery", () => {
  const writes: Array<[string, Record<string, unknown>]> = [
    ["registerCitizen", {}], ["setCitizenAvatar", { clearAvatar: true }],
    ["cancelGame", { topicId: "1" }], ["joinGameWaitlist", { topicId: "1", citizenId: "1" }],
    ["depositGameWaitlist", { topicId: "1", citizenId: "1", amount: 1n }], ["activateGame", { topicId: "1" }],
    ["createGame", { params: {} }], ["setGameDisplay", { topicId: "1", clearHumanDescription: true }],
    ["createPracticeArena", { topicType: "board_duel", ruleTemplate: {} }],
    ["joinPracticeArena", { practiceArenaId: "P1" }], ["cancelPracticeArena", { practiceArenaId: "P1" }],
    ["setPracticeGameDisplay", { practiceArenaId: "P1", clearHumanDescription: true }],
    ["submitPracticeTurn", { practiceMatchId: "pm1", payloadContent: {} }],
    ["acknowledgePracticeStep", { practiceBoardStepId: "ps1" }],
    ["challengePracticeStep", { practiceBoardStepId: "ps1", challengeReasonText: "reason" }],
    ["rulePracticeChallenge", { practiceBoardChallengeId: "pc1", ruling: "UPHOLD" }],
    ["predictPracticeWinner", { practiceMatchId: "pm1", side: 1 }],
    ["submitPracticeJuryVote", { practiceJuryCaseId: "pj1", outcomeSide: 1, reasonText: "reason" }],
    ...["stakesWithdrawCollateral", "stakesWithdrawOperational", "stakesCollateralToOperational", "stakesOperationalToCollateral"]
      .map(name => [name, { citizenId: "1", amount: 1n }] as [string, Record<string, unknown>]),
    ["submitTurn", { matchId: "1", citizenId: "1", payloadContent: {} }],
    ["boardStepAck", { stepId: "1" }], ["boardStepChallenge", { stepId: "1", challengeReasonText: "reason" }],
    ["boardChallengeRuling", { challengeId: "1", ruling: "UPHOLD" }], ["boardCompleteMatch", { matchId: "1", stepId: "1" }],
    ["openPosition", { matchId: "1", citizenId: "1", side: 1, amount: 1n }], ["claimPosition", { matchId: "1" }],
    ["creditAgent", { matchId: "1", citizenId: "1" }], ["claimFor", { matchId: "1", citizenId: "1" }],
    ["expireObligation", { matchId: "1", citizenId: "1" }],
    ["submitJuryVote", { juryCaseId: "1", jurorCitizenId: "1", outcome: 1, reasonText: "reason" }],
    ["submitJuryRubric", { juryCaseId: "1", jurorCitizenId: "1", rubric: {} }],
  ];
  it.each(writes)("%s preserves an explicitly persisted key", async (name, params) => {
    const fetchMock = vi.fn(async () => reply()); vi.stubGlobal("fetch", fetchMock);
    const sdk = client() as unknown as Record<string, (params: unknown, options: { idempotencyKey: string }) => Promise<unknown>>;
    await sdk[name]!(params, { idempotencyKey: "persisted-key" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).idempotencyKey).toBe("persisted-key");
  });
  it("exposes a generated key on transport loss and re-signs recovery instead of replaying authentication", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(reply()); vi.stubGlobal("fetch", fetchMock);
    const sdk = client();
    const error = await sdk.stakesCollateralToOperational({ citizenId: "1", amount: "1" }).catch(error => error);
    expect(error).toBeInstanceOf(GatewayWriteUncertainError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No hidden write retry.
    const key = error.idempotencyKey;
    expect(key).toBeTruthy();
    await sdk.stakesCollateralToOperational({ citizenId: "1", amount: "1" }, { idempotencyKey: key });
    const requests = fetchMock.mock.calls.map(([, init]) => init!);
    expect(requests[1]!.body).toBe(requests[0]!.body);
    const headers = requests.map(init => init.headers as Record<string, string>);
    expect(headers[1]!['x-agent-nonce']).not.toBe(headers[0]!['x-agent-nonce']);
    expect(headers[1]!['x-agent-signature']).not.toBe(headers[0]!['x-agent-signature']);
  });
  it.each(["", "bad key", "x".repeat(129), "你好", null])("rejects invalid keys before transmission: %s", async key => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(client().registerCitizen({}, { idempotencyKey: key as string })).rejects.toThrow("idempotencyKey");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves existing body keys and rejects conflicting option keys", async () => {
    const fetchMock = vi.fn(async () => reply()); vi.stubGlobal("fetch", fetchMock);
    const sdk = client();
    await sdk.joinPracticeArena({ practiceArenaId: "P1", idempotencyKey: " legacy " }, { idempotencyKey: "legacy" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).idempotencyKey).toBe("legacy");
    await expect(sdk.joinPracticeArena({ practiceArenaId: "P1", idempotencyKey: "legacy" },
      { idempotencyKey: "different" })).rejects.toThrow("must match");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("times out a lost initial response once and retains its logical key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
    })); vi.stubGlobal("fetch", fetchMock);
    await expect(client().registerCitizen({}, { idempotencyKey: "timeout-key", requestTimeoutMs: 20 }))
      .rejects.toMatchObject({ uncertain: true, idempotencyKey: "timeout-key" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps the deadline through a stalled response body after 202 headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => ({
      ok: true, status: 202, statusText: "Accepted",
      json: () => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
      }),
    } as unknown as Response)); vi.stubGlobal("fetch", fetchMock);
    await expect(client().registerCitizen({}, { idempotencyKey: "body-key", requestTimeoutMs: 20 }))
      .rejects.toMatchObject({ uncertain: true, idempotencyKey: "body-key", errorCode: "INVALID_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["not json", JSON.stringify({ ok: true }), JSON.stringify({ ok: true, data: { status: "PENDING" } })])(
    "treats an untrustworthy successful response as unknown: %s", async body => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 202 })));
      await expect(client().registerCitizen({}, { idempotencyKey: "invalid-reply" }))
        .rejects.toMatchObject({ uncertain: true, idempotencyKey: "invalid-reply" });
    });
  it("keeps a known pending request ID when finality polling fails", async () => {
    const pending = { ...outcome, status: "PENDING", terminal: false, phase: "PENDING_UNKNOWN", next_action: "POLL_REQUEST", tx_hash: null };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: pending })))
      .mockRejectedValue(new Error("status unavailable")); vi.stubGlobal("fetch", fetchMock);
    const sdk = new GatewayClient({ baseUrl: "http://localhost:9", chainId: 421614, wallet: createRandom(),
      queryRetry: { maxAttempts: 1 }, writeOptions: { timeoutMs: 1 } });
    const error = await sdk.registerCitizen({}, { idempotencyKey: "known-key" }).catch(error => error);
    expect(error).toBeInstanceOf(GatewayActionPendingError); expect(error.requestId).toBe("original");
    expect(error).not.toBeInstanceOf(GatewayWriteUncertainError);
  });
  it("does not reuse a generated key between intentionally new writes", async () => {
    const fetchMock = vi.fn(async () => reply()); vi.stubGlobal("fetch", fetchMock);
    const sdk = client(); await sdk.registerCitizen({}); await sdk.registerCitizen({});
    const keys = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });
  it.each([[429, "RATE_LIMITED"], [503, "GATEWAY_CAPACITY_BUSY"]])("preserves explicit %i admission rejection: %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false,
      error: { code, message: "Rejected before acceptance" } }), { status: Number(status) })));
    const error = await client().registerCitizen({}, { idempotencyKey: "rejected-key" }).catch(error => error);
    expect(error).toMatchObject({ statusCode: status, errorCode: code, idempotencyKey: "rejected-key" });
    expect(error).not.toBeInstanceOf(GatewayWriteUncertainError);
  });
  it("reads a per-command key for real and Practice CLI writes", () => {
    expect(writeRequestOptions(["--idempotency-key", "saved", "--citizen-id", "1"])).toEqual({ idempotencyKey: "saved" });
    expect(writeRequestOptions([])).toEqual({});
    expect(() => writeRequestOptions(["--idempotency-key"])).toThrow("requires a value");
  });
});
