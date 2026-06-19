import { describe, it, expect, vi, afterEach } from "vitest";
import { ReadClient } from "../src/read.js";

describe("ReadClient public URL paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes requests with /api/v1/public", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: [],
          meta: { indexed_block_number: 1 },
        }),
      })) as unknown as typeof fetch,
    );

    await client.listGames();
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/topics",
      expect.any(Object),
    );

    await client.getCitizen("42");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/citizens/42",
      expect.any(Object),
    );
  });

  it("lookupCitizenByWallet uses /citizens/lookup?wallet_address=", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            citizen_id: "1",
            wallet_address: "0xabc",
            status: 1,
            display_name: null,
            metadata_uri: null,
          },
          meta: {},
        }),
      })) as unknown as typeof fetch,
    );

    await client.lookupCitizenByWallet("0xAbC");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/citizens/lookup?wallet_address=0xAbC",
      expect.any(Object),
    );
  });

  it("getMatchEconomyParams uses /games/{id}/economy/params", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            matchId: "7",
            topicType: "DEBATE",
            currentTurn: 3,
            plannedTurnCount: 10,
            tValid: 8,
            params: { timingWeightTailTurns: 2, alpha: 0.3, lambdaCrowding: 0.5, kMin: 1 },
            estimatedFinalTurnRange: { conservative: 3, typical: 5, cap: 10 },
            sides: { A: {}, B: {} },
          },
          meta: {},
        }),
      })) as unknown as typeof fetch,
    );

    const params = await client.getMatchEconomyParams("7");
    expect(params.tValid).toBe(8);
    expect(params.params.timingWeightTailTurns).toBe(2);
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/games/7/economy/params",
      expect.any(Object),
    );
  });

  it("getMatchEconomySnapshot uses /games/{id}/economy/snapshot", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            matchId: "7",
            topicType: "DEBATE",
            currentTurn: 2,
            plannedTurnCount: 10,
            finalized: false,
            sides: {
              A: { prizeRange: { minMultiplier: 1, maxMultiplier: 2 }, crowdHeat: 0.1, timeDragPct: 5, isEstimated: true },
              B: { prizeRange: { minMultiplier: 1, maxMultiplier: 2 }, crowdHeat: 0.1, timeDragPct: 5, isEstimated: true },
            },
          },
          meta: {},
        }),
      })) as unknown as typeof fetch,
    );

    await client.getMatchEconomySnapshot("7");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/games/7/economy/snapshot",
      expect.any(Object),
    );
  });

  it("quoteMatchEconomy POSTs to /games/{id}/economy/quote", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ side: "1", stake: "5000000" }));
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              matchId: "7",
              topicType: "DEBATE",
              side: "A",
              stake: "5000000",
              currentTurn: 2,
              estimated: true,
              timeWeightRange: { conservative: 0.9, typical: 0.85, cap: 0.8 },
              crowdingDiscountAfterOrder: 0.95,
              crowdHeatAfterOrder: 0.1,
              estimatedEffectiveStakeRange: { min: 4, typical: 4.2, max: 4.5 },
              estimatedPrizeRange: { minMultiplier: 1.1, maxMultiplier: 1.5 },
            },
            meta: {},
          }),
        };
      }) as unknown as typeof fetch,
    );

    const quote = await client.quoteMatchEconomy("7", { side: "1", stake: "5000000" });
    expect(quote.side).toBe("A");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/games/7/economy/quote",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getMatchPositionBoard uses /games/{id}/position-board", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            match_id: "7",
            raw_pool_a: "1000000",
            raw_pool_b: "2000000",
            total_raw_pool: "3000000",
            participant_count: 2,
            frozen: false,
            freeze_at: null,
          },
          meta: {},
        }),
      })) as unknown as typeof fetch,
    );

    const board = await client.getMatchPositionBoard("7");
    expect(board?.frozen).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/games/7/position-board",
      expect.any(Object),
    );
  });

  it("getMatch passes through position_window fields from match summary", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            match_id: "7",
            state: "LIVE",
            position_window_sec: 600,
            position_window_ends_at: "2026-06-18T12:00:00.000Z",
          },
          meta: {},
        }),
      })) as unknown as typeof fetch,
    );

    const match = await client.getMatch("7");
    expect(match.position_window_sec).toBe(600);
    expect(match.position_window_ends_at).toBe("2026-06-18T12:00:00.000Z");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/games/7",
      expect.any(Object),
    );
  });

  it("previewMatchEconomyCredit uses /games/{id}/economy/preview-credit", async () => {
    const client = new ReadClient({ baseUrl: "http://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            matchId: "7",
            citizenId: "42",
            status: "PENDING",
            payout: "1000000",
            source: "chain",
          },
          meta: {},
        }),
      })) as unknown as typeof fetch,
    );

    const preview = await client.previewMatchEconomyCredit("7", "42");
    expect(preview.payout).toBe("1000000");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/api/v1/public/games/7/economy/preview-credit?citizenId=42",
      expect.any(Object),
    );
  });
});
