import { describe, expect, it, vi } from "vitest";
import { parseAgentWsEvent } from "../src/agent-ws-events.js";
import { legalNoticeText } from "../src/legal-notices.js";
import { EventFilter } from "../src/bridge/event-filter.js";
import { Bridge } from "../src/bridge/bridge.js";
import { termsReviewState } from "../src/bin/cli/terms-review.js";
import { GatewayClient, type TermsRelease } from "../src/gateway.js";
import { createRandom } from "../src/wallet.js";
import { StayOnlineSession } from "../src/stay-online-session.js";
import { EventEmitter } from "node:events";
const release: TermsRelease = { release_id: "D", deployment_id: "test", terms_version: "D", privacy_version: "C",
  terms_hash: `0x${"a".repeat(64)}`, privacy_hash: `0x${"b".repeat(64)}`, acceptance_text: "Agree",
  acceptance_text_hash: `0x${"c".repeat(64)}`, promotion_choice_enabled: false, change_summary: "Spelling correction",
  published_at: "2026-10-06T00:00:00Z", existing_required_at: "2026-10-06T00:00:00Z",
  effective_at: "2026-10-06T00:00:00Z", terms_url: "https://example.test/terms/D", privacy_url: "https://example.test/privacy/D",
  update_class: "NOTICE_ONLY", requires_acceptance: false };
describe("operator legal notices", () => {
  it("parses public updates and delivers them through game-only subscriptions", async () => {
    const event = parseAgentWsEvent({ type: "TERMS_UPDATED", release })!;
    expect(event.type).toBe("TERMS_UPDATED");
    expect(new EventFilter(["MATCH_LIVE"]).shouldProcess(event)).toBe(true);
    const wake = vi.fn().mockResolvedValue(undefined);
    const bridge = new Bridge({ citizenId: "12", adapter: { wake }, subscriptions: ["MATCH_LIVE"] });
    await bridge.handle(event);
    expect(wake.mock.calls[0]![0]).toContain("Notice only");
    expect(wake.mock.calls[0]![0]).not.toContain("/accept/");
  });
  it("recovers C's requirement even though D itself is notice-only, without accepting", async () => {
    const event = parseAgentWsEvent({ type: "TERMS_STATUS", status: { available: true, accepted: false,
      satisfied: true, acceptance_satisfied: false, operator_action_required: true, release,
      required_update: { release_id: "C", change_summary: "Material change C", effective_at: "2026-10-07T00:00:00Z",
        terms_url: "https://example.test/terms/C", privacy_url: "https://example.test/privacy/C" } } })!;
    expect(legalNoticeText(event)).toContain("Material change C");
    expect(legalNoticeText(event)).toContain("current D");
    expect(legalNoticeText(event)).toContain("Outstanding update: C");
    expect(legalNoticeText(event)).toContain("Review deadline: 2026-10-07T00:00:00Z");
    expect(legalNoticeText(event)).toContain("robotania terms link");
    expect(legalNoticeText(event)).toContain("Never open the review link");
    expect(legalNoticeText(event)).toContain("check the acceptance box or submit confirmation for them");
    const wake = vi.fn().mockResolvedValue(undefined);
    await new Bridge({ citizenId: "12", adapter: { wake }, subscriptions: [] }).handle(event);
    expect(wake).toHaveBeenCalledOnce();
  });
  it("does not launch renewal solely because the latest minor version lacks its own acceptance", () => {
    expect(termsReviewState({ available: true, accepted: false, satisfied: true, operator_action_required: false })).toBe("none");
    expect(termsReviewState({ available: true, accepted: false, satisfied: true, operator_action_required: true })).toBe("notice");
    expect(parseAgentWsEvent({ type: "TERMS_UPDATED", release: {} })).toBeNull();
    expect(parseAgentWsEvent({ type: "TERMS_UPDATED", release: { ...release, requires_acceptance: true } })).toBeNull();
  });
  it("distinguishes a broadcast classification from the wallet's required action", () => {
    const broadcast = legalNoticeText({ type: "TERMS_UPDATED", release: {
      ...release, update_class: "REQUIRES_ACCEPTANCE", requires_acceptance: true } });
    expect(broadcast).toContain("Run robotania terms status");
    expect(broadcast).toContain("If operator_action_required is true");
    const satisfied = legalNoticeText({ type: "TERMS_STATUS", status: { available: true,
      accepted: false, acceptance_satisfied: true, operator_action_required: false, release } });
    expect(satisfied).toContain("no operator confirmation is outstanding");
    expect(satisfied).not.toContain("robotania terms link");
  });
  it("formats older metadata without an undefined date or an automatic request", () => {
    const legacy = { ...release, effective_at: undefined, update_class: undefined, requires_acceptance: undefined };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const notice = legalNoticeText({ type: "TERMS_UPDATED", release: legacy });
      expect(notice).toContain(`Update effective: ${legacy.existing_required_at}`);
      expect(notice).toContain("robotania terms status");
      expect(notice).not.toContain("undefined");
      expect(legalNoticeText({ type: "TERMS_STATUS", status: { available: true, accepted: true, release: legacy } }))
        .toContain("no operator confirmation is outstanding");
      expect(legalNoticeText({ type: "TERMS_STATUS", status: { available: false, accepted: false, release: legacy } })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("suppresses identical reconnect status beyond the game-event window and delivers every state transition", async () => {
    vi.useFakeTimers();
    const wake = vi.fn().mockResolvedValue(undefined);
    const bridge = new Bridge({ citizenId: "12", adapter: { wake }, subscriptions: [] });
    const pending = { type: "TERMS_STATUS" as const, status: { available: true, accepted: false,
      satisfied: true, acceptance_satisfied: false, operator_action_required: true, release,
      required_update: { release_id: "C", change_summary: "Material C", effective_at: "2026-10-07T00:00:00Z" } } };
    try {
      await bridge.handle(pending);
      await vi.advanceTimersByTimeAsync(60_000);
      await bridge.handle({ ...pending, status: { ...pending.status } });
      expect(wake).toHaveBeenCalledOnce();
      // Same release at its deadline: permission changes without a publication.
      await bridge.handle({ ...pending, status: { ...pending.status, satisfied: false } });
      const confirmed = { ...pending, status: { ...pending.status, acceptance_satisfied: true,
        operator_action_required: false, required_update: null } };
      await bridge.handle(confirmed);
      await bridge.handle(pending);
      expect(wake).toHaveBeenCalledTimes(4);
      await bridge.handle({ ...pending, status: { ...pending.status,
        release: { ...release, release_id: "E" } } });
      expect(wake).toHaveBeenCalledTimes(5);
    } finally { vi.useRealTimers(); }
  });
  it("retries a failed status wake and resets recovery after the release becomes unavailable", async () => {
    const wake = vi.fn().mockRejectedValueOnce(new Error("adapter unavailable")).mockResolvedValue(undefined);
    const bridge = new Bridge({ citizenId: "12", adapter: { wake }, subscriptions: [] });
    const event = { type: "TERMS_STATUS" as const, status: { available: true, accepted: false,
      operator_action_required: true, release } };
    await expect(bridge.handle(event)).rejects.toThrow("adapter unavailable");
    await bridge.handle(event);
    await bridge.handle(event);
    expect(wake).toHaveBeenCalledTimes(2);
    await bridge.handle({ type: "TERMS_STATUS", status: { available: false, accepted: false, operator_action_required: false } });
    await bridge.handle(event);
    expect(wake).toHaveBeenCalledTimes(3);
  });
  it("required scope completes when a minor revision follows human confirmation before the next poll", async () => {
    vi.useFakeTimers();
    const gateway = new GatewayClient({ baseUrl: "https://example.test", chainId: 421614, wallet: createRandom() });
    const checks = vi.spyOn(gateway, "termsStatus")
      .mockResolvedValueOnce({ available: true, accepted: false, satisfied: false, acceptance_satisfied: false })
      .mockResolvedValue({ available: true, accepted: false, satisfied: true,
        acceptance_satisfied: true, operator_action_required: false, release });
    const link = vi.spyOn(gateway, "createTermsReviewLink");
    try {
      const waiting = gateway.waitForTermsAcceptance(10_000, "required");
      await vi.advanceTimersByTimeAsync(4_000);
      await waiting;
      expect(checks).toHaveBeenCalledTimes(2);
      expect(link).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("presents current state before cursor expiry without checkpointing or accepting", async () => {
    const gateway = new GatewayClient({ baseUrl: "https://example.test", chainId: 421614, wallet: createRandom() });
    vi.spyOn(gateway, "getWsAuthToken").mockResolvedValue({ token: "test", expiresAt: new Date().toISOString() });
    vi.spyOn(gateway, "heartbeat").mockResolvedValue({ received: true });
    class Socket extends EventEmitter { readyState=1; send=vi.fn(); close=()=>this.emit("close",1000,Buffer.alloc(0)); }
    const socket = new Socket(); const save = vi.fn(); const observed: string[] = [];
    const session = new StayOnlineSession({ gateway, citizenId: "12", cursorStore: { load: async () => 1, save },
      createWebSocket: () => { queueMicrotask(() => socket.emit("open")); return socket; } });
    session.on("legalNotice", () => observed.push("legal")); session.on("cursorExpired", () => observed.push("expired"));
    try {
      await session.start();
      socket.emit("message", JSON.stringify({ type: "TERMS_STATUS", status: { available: true, accepted: false, operator_action_required: true, release } }));
      socket.emit("message", JSON.stringify({ type: "EVENT_CURSOR_EXPIRED", afterSequence:1,retentionFloorSequence:10,watermarkSequence:20 }));
      expect(observed).toEqual(["legal", "expired"]); expect(save).not.toHaveBeenCalled();
    } finally { await session.stop(); }
  });
  it("waits for compatible real acceptance and never treats notice allowance as completion", async () => {
    vi.useFakeTimers();
    const gateway = new GatewayClient({ baseUrl: "https://example.test", chainId: 421614, wallet: createRandom() });
    const status = vi.spyOn(gateway, "termsStatus").mockResolvedValue({ available:true,accepted:false,satisfied:true,acceptance_satisfied:true });
    try {
      await gateway.waitForTermsAcceptance(20, "required");
      status.mockResolvedValue({ available:true,accepted:false,satisfied:true,acceptance_satisfied:false });
      const waiting = expect(gateway.waitForTermsAcceptance(20, "required")).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(3_000); await waiting;
    } finally { vi.useRealTimers(); }
  });
  it("backs off human waiting with a bounded poll delay and no link creation", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const gateway = new GatewayClient({ baseUrl: "https://example.test", chainId:421614, wallet:createRandom() });
    const checks: number[] = [];
    vi.spyOn(gateway,"termsStatus").mockImplementation(async () => {
      checks.push(Date.now()); return { available:true,accepted:checks.length>8,satisfied:true,acceptance_satisfied:false };
    });
    const link = vi.spyOn(gateway,"createTermsReviewLink");
    try {
      const waiting = gateway.waitForTermsAcceptance(150_000,"required");
      await vi.advanceTimersByTimeAsync(150_000); await waiting;
      const delays = checks.slice(1).map((time,n)=>time-checks[n]!);
      expect(delays.every(delay=>delay>0 && delay<=30_000)).toBe(true);
      expect(delays.slice(-2)).toEqual([30_000,30_000]); expect(link).not.toHaveBeenCalled();
    } finally { random.mockRestore(); vi.useRealTimers(); }
  });
});
