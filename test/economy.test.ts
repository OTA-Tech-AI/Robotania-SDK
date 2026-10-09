import { afterEach, describe, it, expect, vi } from "vitest";
import {
  computeTValid,
  computeTimingWeight,
  calculateEffectiveStake,
  claimSettlement,
  mulDiv,
} from "../src/economy.js";
import { GatewayActionFailedError, GatewayClient, GatewayWriteUncertainError } from "../src/gateway.js";
import { createRandom } from "../src/wallet.js";
import type { RequestResult } from "../src/types.js";

const WAD = 1_000_000_000_000_000_000n;

describe("economy", () => {
  it("computeTValid = max(n - m, 2) when n > m", () => {
    expect(computeTValid(24, 2)).toBe(22);
    expect(computeTValid(10, 2)).toBe(8);
    expect(computeTValid(13, 2)).toBe(11);
  });

  it("computeTValid clamps when N <= m", () => {
    expect(computeTValid(2, 2)).toBe(2);
    expect(computeTValid(1, 3)).toBe(2);
  });

  it("computeTimingWeight is WAD at turn 1", () => {
    expect(computeTimingWeight(1, 10, 3000)).toBe(WAD);
  });

  it("computeTimingWeight decays toward turn T_valid", () => {
    const tValid = 10;
    const wFirst = computeTimingWeight(1, tValid, 3000);
    const wLast = computeTimingWeight(tValid, tValid, 3000);
    expect(wFirst).toBe(WAD);
    expect(wLast).toBeLessThan(wFirst);
    expect(wLast).toBe((WAD * 7n) / 10n);
  });

  it("calculateEffectiveStake applies weight and crowding", () => {
    const stake = 1_000_000n;
    const half = WAD / 2n;
    expect(calculateEffectiveStake(stake, WAD, WAD)).toBe(stake);
    expect(calculateEffectiveStake(stake, half, WAD)).toBe(stake / 2n);
    expect(calculateEffectiveStake(stake, WAD, half)).toBe(stake / 2n);
  });

  it("mulDiv handles zero denominator", () => {
    expect(mulDiv(100n, 200n, 0n)).toBe(0n);
  });
});

describe("claimSettlement", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const client = () => new GatewayClient({
    baseUrl: "http://localhost:9",
    chainId: 421614,
    wallet: createRandom(),
    writeOptions: { mode: "async" },
  });
  const outcomes: RequestResult[] = [
    { request_id: "claim-pending", action: "positions/claim", status: "PENDING", terminal: false,
      phase: "RECEIVED", tx_hash: null, next_action: "POLL_REQUEST" },
    { request_id: "claim-finalized", action: "positions/claim", status: "FINALIZED", terminal: true,
      phase: "FINALIZED", tx_hash: "0x1", result: {}, next_action: "NONE" },
  ];

  it.each(outcomes)("preserves a $status outcome and the saved operation key", async outcome => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: outcome })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(claimSettlement(client(), "7", {
      idempotencyKey: "saved-claim-key", requestTimeoutMs: 5_000,
    })).resolves.toEqual(outcome);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:9/api/v1/agent/positions/claim");
    expect(JSON.parse(String(init?.body))).toEqual({ matchId: "7", idempotencyKey: "saved-claim-key" });
  });

  it("preserves recovery information on response loss without retrying", async () => {
    const cause = new TypeError("response lost");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(cause);
    vi.stubGlobal("fetch", fetchMock);

    const error = await claimSettlement(client(), "7", { idempotencyKey: "saved-claim-key" })
      .catch(error => error);

    expect(error).toBeInstanceOf(GatewayWriteUncertainError);
    expect(error).toMatchObject({
      uncertain: true, idempotencyKey: "saved-claim-key", cause,
      path: "/api/v1/agent/positions/claim",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves a terminal failure instead of resolving as success", async () => {
    const outcome = { request_id: "claim-failed", action: "positions/claim", status: "FAILED", terminal: true,
      phase: "FAILED", tx_hash: null, next_action: "REFRESH_CONTEXT",
      error: { code: "CLAIM_UNAVAILABLE", message: "No claim is available.", next_action: "REFRESH_CONTEXT" } };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: outcome })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await claimSettlement(client(), "7").catch(error => error);

    expect(error).toBeInstanceOf(GatewayActionFailedError);
    expect(error.outcome).toEqual(outcome);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
