import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Bridge } from "../../src/bridge/bridge.js";
import type { AgentAdapter } from "../../src/bridge/adapter.js";
import type { WakeMeta } from "../../src/bridge/types.js";

function mockAdapter(): { wake: ReturnType<typeof vi.fn>; adapter: AgentAdapter } {
  const wake = vi.fn().mockResolvedValue(undefined);
  return { wake, adapter: { wake } };
}

describe("Bridge", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("wakes on MATCH_LIVE with high urgency", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter });

    await bridge.handle({ type: "MATCH_LIVE", matchId: "7", state: "LIVE" });

    expect(wake).toHaveBeenCalledOnce();
    const meta: WakeMeta = wake.mock.calls[0][1];
    expect(meta.trigger).toBe("MATCH_LIVE");
    expect(meta.urgency).toBe("high");
    expect(meta.matchId).toBe("7");
    expect(meta.citizenId).toBe("42");
  });

  it("passes durable event identity to the adapter", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter });

    await bridge.handle({
      type: "MATCH_LIVE",
      matchId: "7",
      state: "LIVE",
      eventId: "evt_123",
      sequence: 12,
      revision: "match:7:live",
      createdAt: "2026-07-29T00:00:00.000Z",
      arenaMode: "VERIFIED",
    });

    const meta: WakeMeta = wake.mock.calls[0][1];
    expect(meta).toMatchObject({
      eventId: "evt_123",
      sequence: 12,
      revision: "match:7:live",
      createdAt: "2026-07-29T00:00:00.000Z",
      arenaMode: "VERIFIED",
    });
  });

  it("wakes on JURY_ASSIGNED with high urgency", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter });

    await bridge.handle({ type: "JURY_ASSIGNED", juryCaseId: "99" });

    const meta: WakeMeta = wake.mock.calls[0][1];
    expect(meta.urgency).toBe("high");
    expect(meta.juryCaseId).toBe("99");
  });

  it("wakes on TURN_SUBMITTED with medium urgency", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter });

    await bridge.handle({
      type: "TURN_SUBMITTED",
      matchId: "7",
      turnNumber: 3,
      actorCitizenId: "9",
    });

    const meta: WakeMeta = wake.mock.calls[0][1];
    expect(meta.urgency).toBe("medium");
    expect(meta.turnNumber).toBe(3);
    expect(meta.actorCitizenId).toBe("9");
  });

  it("does not wake on non-subscribed event", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter });

    await bridge.handle({ type: "GAME_STATE_CHANGE", topicId: "1" });

    expect(wake).not.toHaveBeenCalled();
  });

  it("deduplicates repeated MATCH_LIVE within window", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter, dedupeWindowMs: 5_000 });

    await bridge.handle({ type: "MATCH_LIVE", matchId: "7", state: "LIVE" });
    await bridge.handle({ type: "MATCH_LIVE", matchId: "7", state: "LIVE" });

    expect(wake).toHaveBeenCalledOnce();
  });

  it("allows MATCH_LIVE for different matches", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter, dedupeWindowMs: 5_000 });

    await bridge.handle({ type: "MATCH_LIVE", matchId: "7", state: "LIVE" });
    await bridge.handle({ type: "MATCH_LIVE", matchId: "8", state: "LIVE" });

    expect(wake).toHaveBeenCalledTimes(2);
  });

  it("wake text includes action line for TURN_SUBMITTED", async () => {
    const { wake, adapter } = mockAdapter();
    const bridge = new Bridge({ citizenId: "42", adapter });

    await bridge.handle({
      type: "TURN_SUBMITTED",
      matchId: "7",
      turnNumber: 2,
      actorCitizenId: "1",
    });

    const text: string = wake.mock.calls[0][0];
    expect(text).toContain("TURN_SUBMITTED");
    expect(text).toContain("your turn to act");
  });

  it("handle() throws on adapter error (caller decides how to handle)", async () => {
    const adapter: AgentAdapter = {
      wake: vi.fn().mockRejectedValue(new Error("adapter down")),
    };
    const bridge = new Bridge({ citizenId: "42", adapter });

    await expect(
      bridge.handle({ type: "MATCH_LIVE", matchId: "1", state: "LIVE" }),
    ).rejects.toThrow("adapter down");
  });

  it("does not deduplicate an event whose adapter delivery failed", async () => {
    const wake = vi
      .fn()
      .mockRejectedValueOnce(new Error("adapter down"))
      .mockResolvedValueOnce(undefined);
    const bridge = new Bridge({ citizenId: "42", adapter: { wake } });
    const event = { type: "MATCH_LIVE", matchId: "1", state: "LIVE" } as const;

    await expect(bridge.handle(event)).rejects.toThrow("adapter down");
    await bridge.handle(event);

    expect(wake).toHaveBeenCalledTimes(2);
  });

  it("attach() reconnects without checkpointing when adapter delivery fails", async () => {
    let resolveLogged!: () => void;
    const logged = new Promise<void>((r) => { resolveLogged = r; });
    const logger = vi.fn((msg: string) => {
      if (msg.includes("adapter down")) resolveLogged();
    });

    const adapter: AgentAdapter = {
      wake: vi.fn().mockRejectedValue(new Error("adapter down")),
    };
    const bridge = new Bridge({ citizenId: "42", adapter, logger });

    const { EventEmitter } = await import("node:events");
    const reconnect = vi.fn();
    const acknowledge = vi.fn();
    const session = Object.assign(new EventEmitter(), {
      reconnect,
      acknowledge,
    }) as unknown as Parameters<typeof bridge.attach>[0];
    bridge.attach(session);
    session.emit("message", {
      type: "MATCH_LIVE",
      matchId: "1",
      state: "LIVE",
      sequence: 12,
    });

    await logged;
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("adapter down"));
    expect(reconnect).toHaveBeenCalledOnce();
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
