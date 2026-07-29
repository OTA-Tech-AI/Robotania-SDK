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
      expect(url).toContain("&after=0");
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

  it("resumes from a stored cursor and does not skip an expired retention gap", async () => {
    const account = privateKeyToAccount(TEST_PK);
    const gw = new GatewayClient({
      baseUrl: "http://example.test:9",
      wallet: { privateKey: TEST_PK, address: account.address },
    });
    vi.spyOn(gw, "getWsAuthToken").mockResolvedValue({
      token: "tok",
      expiresAt: new Date().toISOString(),
    });
    vi.spyOn(gw, "heartbeat").mockResolvedValue({ received: true });
    const cursorStore = {
      load: vi.fn().mockResolvedValue(12),
      save: vi.fn().mockResolvedValue(undefined),
    };

    class FakeSocket extends EventEmitter {
      readonly readyState = 1;
      send = vi.fn();
      close = vi.fn(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    let socket!: FakeSocket;
    const factory = vi.fn((url: string) => {
      expect(url).toContain("&after=12");
      socket = new FakeSocket();
      queueMicrotask(() => socket.emit("open"));
      return socket;
    });
    const session = new StayOnlineSession({
      gateway: gw,
      citizenId: "cit-1",
      cursorStore,
      createWebSocket: factory,
    });
    const expired = vi.fn();
    session.on("cursorExpired", expired);

    await session.start();
    socket.emit("message", Buffer.from(JSON.stringify({
      type: "EVENT_CURSOR_EXPIRED",
      retentionFloorSequence: 20,
      watermarkSequence: 30,
    })));

    expect(expired).toHaveBeenCalledOnce();
    expect(session.isCursorBlocked()).toBe(true);
    expect(cursorStore.save).not.toHaveBeenCalled();
    await session.acceptRetentionFloor(20);
    expect(cursorStore.save).toHaveBeenCalledWith(19);
    expect(session.isCursorBlocked()).toBe(false);
    await session.stop();
  });

  it("pauses an ahead cursor until an explicit reset", async () => {
    const account = privateKeyToAccount(TEST_PK);
    const gw = new GatewayClient({
      baseUrl: "http://example.test:9",
      wallet: { privateKey: TEST_PK, address: account.address },
    });
    vi.spyOn(gw, "getWsAuthToken").mockResolvedValue({
      token: "tok",
      expiresAt: new Date().toISOString(),
    });
    vi.spyOn(gw, "heartbeat").mockResolvedValue({ received: true });
    const cursorStore = {
      load: vi.fn().mockResolvedValue(50),
      save: vi.fn().mockResolvedValue(undefined),
    };

    class FakeSocket extends EventEmitter {
      readonly readyState = 1;
      send = vi.fn();
      close = vi.fn(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    let socket!: FakeSocket;
    const session = new StayOnlineSession({
      gateway: gw,
      citizenId: "cit-1",
      cursorStore,
      createWebSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    });
    const ahead = vi.fn();
    session.on("cursorAhead", ahead);

    await session.start();
    socket.emit("message", Buffer.from(JSON.stringify({
      type: "EVENT_CURSOR_AHEAD",
      watermarkSequence: 12,
    })));

    expect(ahead).toHaveBeenCalledOnce();
    expect(session.isCursorBlocked()).toBe(true);
    await session.resetCursor(12);
    expect(cursorStore.save).toHaveBeenCalledWith(12);
    expect(session.isCursorBlocked()).toBe(false);
    await session.stop();
  });

  it("checkpoints a durable event after synchronous delivery", async () => {
    const account = privateKeyToAccount(TEST_PK);
    const gw = new GatewayClient({
      baseUrl: "http://example.test:9",
      wallet: { privateKey: TEST_PK, address: account.address },
    });
    vi.spyOn(gw, "getWsAuthToken").mockResolvedValue({
      token: "tok",
      expiresAt: new Date().toISOString(),
    });
    vi.spyOn(gw, "heartbeat").mockResolvedValue({ received: true });
    const cursorStore = {
      load: vi.fn().mockResolvedValue(0),
      save: vi.fn().mockResolvedValue(undefined),
    };

    class FakeSocket extends EventEmitter {
      readonly readyState = 1;
      send = vi.fn();
      close = vi.fn(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    let socket!: FakeSocket;
    const session = new StayOnlineSession({
      gateway: gw,
      citizenId: "cit-1",
      cursorStore,
      autoCheckpoint: true,
      createWebSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    });

    await session.start();
    socket.emit("message", Buffer.from(JSON.stringify({
      type: "MATCH_LIVE",
      matchId: "7",
      state: "LIVE",
      sequence: 18,
      eventId: "evt-18",
      arenaMode: "VERIFIED",
    })));
    await vi.waitFor(() => expect(cursorStore.save).toHaveBeenCalledWith(18));
    await session.stop();
  });

  it("replays from the last durable cursor when cursor storage fails", async () => {
    const account = privateKeyToAccount(TEST_PK);
    const gw = new GatewayClient({
      baseUrl: "http://example.test:9",
      wallet: { privateKey: TEST_PK, address: account.address },
    });
    vi.spyOn(gw, "getWsAuthToken").mockResolvedValue({
      token: "tok",
      expiresAt: new Date().toISOString(),
    });
    vi.spyOn(gw, "heartbeat").mockResolvedValue({ received: true });
    const cursorStore = {
      load: vi.fn().mockResolvedValue(0),
      save: vi.fn().mockRejectedValueOnce(new Error("disk unavailable")),
    };

    class FakeSocket extends EventEmitter {
      readonly readyState = 1;
      send = vi.fn();
      close = vi.fn(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    const urls: string[] = [];
    let socket!: FakeSocket;
    const session = new StayOnlineSession({
      gateway: gw,
      citizenId: "cit-1",
      cursorStore,
      createWebSocket: (url) => {
        urls.push(url);
        socket = new FakeSocket();
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    });
    const cursorError = vi.fn();
    session.on("cursorError", cursorError);

    await session.start();
    session.acknowledge(18);
    await vi.waitFor(() => expect(cursorError).toHaveBeenCalledOnce());
    await session.stop();
    await session.start();

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("&after=0");
    await session.stop();
  });

  it("disconnects without checkpointing when a synchronous event handler fails", async () => {
    const account = privateKeyToAccount(TEST_PK);
    const gw = new GatewayClient({
      baseUrl: "http://example.test:9",
      wallet: { privateKey: TEST_PK, address: account.address },
    });
    vi.spyOn(gw, "getWsAuthToken").mockResolvedValue({
      token: "tok",
      expiresAt: new Date().toISOString(),
    });
    vi.spyOn(gw, "heartbeat").mockResolvedValue({ received: true });
    const cursorStore = {
      load: vi.fn().mockResolvedValue(0),
      save: vi.fn().mockResolvedValue(undefined),
    };

    class FakeSocket extends EventEmitter {
      readonly readyState = 1;
      send = vi.fn();
      close = vi.fn(() => this.emit("close", 1000, Buffer.alloc(0)));
    }
    let socket!: FakeSocket;
    const session = new StayOnlineSession({
      gateway: gw,
      citizenId: "cit-1",
      cursorStore,
      reconnect: { initialDelayMs: 60_000, maxDelayMs: 60_000 },
      createWebSocket: () => {
        socket = new FakeSocket();
        queueMicrotask(() => socket.emit("open"));
        return socket;
      },
    });
    const handlerError = vi.fn();
    session.on("handlerError", handlerError);
    session.on("MATCH_LIVE", () => {
      throw new Error("handler failed");
    });

    await session.start();
    socket.emit("message", Buffer.from(JSON.stringify({
      type: "MATCH_LIVE",
      matchId: "7",
      state: "LIVE",
      sequence: 18,
      eventId: "evt-18",
      arenaMode: "VERIFIED",
    })));

    expect(handlerError).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(cursorStore.save).not.toHaveBeenCalled();
    await session.stop();
  });
});
