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

    await client.listTopics();
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
});
