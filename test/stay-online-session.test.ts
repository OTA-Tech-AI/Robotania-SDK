import { describe, it, expect, vi, afterEach } from "vitest";
import EventEmitter from "node:events";
import { privateKeyToAccount } from "viem/accounts";
import { GatewayClient } from "../src/gateway.js";
import { StayOnlineSession, gatewayBaseToWsUrl } from "../src/stay-online-session.js";

const TEST_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

describe("gatewayBaseToWsUrl", () => {
  it("maps http and https bases to /ws/agent", () => {
    expect(gatewayBaseToWsUrl("http://localhost:3100")).toBe("ws://localhost:3100/ws/agent");
    expect(gatewayBaseToWsUrl("http://localhost:3100/")).toBe("ws://localhost:3100/ws/agent");
    expect(gatewayBaseToWsUrl("https://gw.example/path-ignored-base")).toBe(
      "wss://gw.example/path-ignored-base/ws/agent",
    );
  });

  it("rejects non-http(s) bases", () => {
    expect(() => gatewayBaseToWsUrl("ftp://x")).toThrow(/expected http\(s\)/);
  });
});

describe("StayOnlineSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens WS with token URL, posts heartbeat after open, and emits typed events", async () => {
    const account = privateKeyToAccount(TEST_PK);
    const gw = new GatewayClient({
      baseUrl: "http://example.test:9",
      wallet: { privateKey: TEST_PK, address: account.address },
    });

    vi.spyOn(gw, "getWsAuthToken").mockResolvedValue({ token: "tok", expiresAt: new Date().toISOString() });
    vi.spyOn(gw, "heartbeat").mockResolvedValue({ received: true });

    class FakeSocket extends EventEmitter {
      readonly readyState = 1;
      send = vi.fn();
      close = vi.fn(() => {
        this.emit("close", 1000, Buffer.alloc(0));
      });
    }

    const factory = vi.fn((url: string) => {
      expect(url).toContain("/ws/agent?ws_token=tok");
      const sock = new FakeSocket();
      queueMicrotask(() => sock.emit("open"));
      return sock;
    });

    const session = new StayOnlineSession({
      gateway: gw,
      citizenId: "cit-1",
      heartbeatIntervalMs: 60_000,
      heartbeatParams: { status: "READY" },
      createWebSocket: factory,
    });

    const hello = new Promise<void>((resolve) => {
      session.once("CONNECTED", () => resolve());
    });

    await session.start();

    await vi.waitFor(() => expect(gw.heartbeat).toHaveBeenCalled());
    expect(gw.heartbeat).toHaveBeenCalledWith({ citizenId: "cit-1", status: "READY" });
    expect(gw.getWsAuthToken).toHaveBeenCalledWith("cit-1");

    const sock = factory.mock.results[0]?.value as FakeSocket;
    sock.emit("message", Buffer.from(JSON.stringify({ type: "CONNECTED", citizenId: "cit-1" })));
    await hello;

    await session.stop();
    expect(factory.mock.calls.length).toBe(1);
  });
});
