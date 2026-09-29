import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, verifyTypedData } from "viem";
import { GatewayActionFailedError, GatewayClient, GatewayError,
  isPreBroadcastTermsRejection } from "../src/gateway.js";
import { AGENT_REQUEST_TYPES, buildRobotaniaDomain } from "../src/signing.js";
import { createRandom } from "../src/wallet.js";
import { checkTermsBeforeAction, recoverTermsRejection,
  termsReviewNextAction, termsReviewState } from "../src/bin/cli/terms-review.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("operator review link", () => {
  it("continues during an existing wallet's notice period but pauses new registration", () => {
    expect(termsReviewState({ available: true, accepted: false, satisfied: true })).toBe("notice");
    expect(termsReviewState({ available: true, accepted: false, satisfied: false })).toBe("required");
    expect(termsReviewState({ available: true, accepted: true, satisfied: true })).toBe("none");
    expect(termsReviewState({ available: true, accepted: false, exempt: true })).toBe("none");
    expect(termsReviewState({ available: false, accepted: false, satisfied: true })).toBe("none");
  });
  it("ignores only a missing status endpoint, not a missing review-link endpoint", async () => {
    const review = vi.fn(async () => {});
    const notice = vi.fn();
    await checkTermsBeforeAction(async () => {
      throw new GatewayError(404, "/api/v1/agent/terms/status", "NOT_FOUND", "Missing route");
    }, review, notice);
    expect(review).not.toHaveBeenCalled();

    const linkError = new GatewayError(404, "/api/v1/agent/terms/links", "NOT_FOUND", "Missing route");
    review.mockRejectedValueOnce(linkError);
    await expect(checkTermsBeforeAction(async () => ({ available: true, accepted: false,
      satisfied: false }), review, notice)).rejects.toBe(linkError);
    expect(review).toHaveBeenCalledOnce();
    expect(notice).not.toHaveBeenCalled();
  });
  it("retries only a terminal Terms rejection without a broadcast hash", () => {
    const outcome = { request_id: "req-1", action: "topics/create", status: "FAILED" as const,
      terminal: true as const, phase: "FAILED" as const, tx_hash: null,
      next_action: "OPERATOR_REVIEW" as const,
      error: { code: "TERMS_ACCEPTANCE_REQUIRED", message: "Review required",
        next_action: "OPERATOR_REVIEW" as const } };
    expect(isPreBroadcastTermsRejection(new GatewayActionFailedError(outcome))).toBe(true);
    expect(isPreBroadcastTermsRejection(new GatewayActionFailedError({
      ...outcome, tx_hash: "0xabc",
    }))).toBe(false);
    expect(isPreBroadcastTermsRejection(new GatewayActionFailedError({
      ...outcome, error: { ...outcome.error, code: "REQUEST_FAILED" },
    }))).toBe(false);
  });
  it("reviews before asking for a manual retry with an explicit key", async () => {
    const outcome = { request_id: "req-1", action: "topics/create", status: "FAILED" as const,
      terminal: true as const, phase: "FAILED" as const, tx_hash: null,
      next_action: "OPERATOR_REVIEW" as const,
      error: { code: "TERMS_ACCEPTANCE_REQUIRED", message: "Review required",
        next_action: "OPERATOR_REVIEW" as const } };
    const review = vi.fn(async () => {});
    const retry = vi.fn(async () => {});
    await expect(recoverTermsRejection(new GatewayActionFailedError(outcome), true, review, retry))
      .rejects.toMatchObject({ requestId: "req-1", message: expect.stringContaining("new idempotency key") });
    expect(review).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    await recoverTermsRejection(new GatewayActionFailedError(outcome), false, review, retry);
    expect(retry).toHaveBeenCalledOnce();
  });
  it("gives retry guidance for review-link failures", () => {
    expect(termsReviewNextAction(new GatewayError(429, "/api/v1/agent/terms/links",
      "RATE_LIMITED", "Slow down"))).toBe("RETRY_NEW_REQUEST");
    expect(termsReviewNextAction(new GatewayError(408, "/api/v1/agent/terms/links",
      "REVIEW_REQUEST_TIMEOUT", "Timed out"))).toBe("RETRY_NEW_REQUEST");
    expect(termsReviewNextAction(new GatewayError(503, "/api/v1/agent/terms/links",
      "REVIEW_ORIGIN_UNAVAILABLE", "Unavailable"))).toBe("REFRESH_CONTEXT");
    expect(termsReviewNextAction(new GatewayError(429, "/api/v1/agent/other",
      "RATE_LIMITED", "Slow down"))).toBeNull();
  });
  it("preserves the complete Terms rejection for programmatic callers", async () => {
    const wallet = createRandom();
    const release = { release_id: "beta-2", terms_version: "2", privacy_version: "2",
      terms_url: "/terms/beta-2", privacy_url: "/privacy/beta-2" };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 428, json: async () => ({ ok: false,
        error: { code: "TERMS_ACCEPTANCE_REQUIRED", message: "Review required", next_action: "OPERATOR_REVIEW" },
        release }),
    })));
    const client = new GatewayClient({ baseUrl: "https://gateway.robotania.ai", wallet, chainId: 421614 });
    await expect(client.termsStatus()).rejects.toMatchObject({
      errorCode: "TERMS_ACCEPTANCE_REQUIRED",
      response: { release, error: { next_action: "OPERATOR_REVIEW" }, next_action: "OPERATOR_REVIEW" },
    } satisfies Partial<GatewayError>);
  });
  it("signs wallet-specific acceptance status instead of exposing it in a URL", async () => {
    const wallet = createRandom();
    let requestedUrl = "";
    let headers: Headers | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requestedUrl = url;
      headers = new Headers(init?.headers);
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { available: true, accepted: false } }) };
    }));
    const client = new GatewayClient({ baseUrl: "https://gateway.robotania.ai", wallet, chainId: 421614 });
    expect((await client.termsStatus()).accepted).toBe(false);
    expect(new URL(requestedUrl).pathname).toBe("/api/v1/agent/terms/status");
    expect(new URL(requestedUrl).search).toBe("");
    expect(headers).toBeDefined();
    expect(await verifyTypedData({
      address: wallet.address, domain: buildRobotaniaDomain(421614),
      primaryType: "AgentRequest", types: AGENT_REQUEST_TYPES,
      message: {
        method: "GET", path: "/api/v1/agent/terms/status",
        citizenId: headers!.get("x-agent-citizen-id")!,
        nonce: headers!.get("x-agent-nonce")!,
        deadline: BigInt(headers!.get("x-agent-deadline")!),
        payloadHash: keccak256(toBytes("")),
      },
      signature: headers!.get("x-agent-signature")! as `0x${string}`,
    })).toBe(true);
  });
  it("waits for an actual acknowledgement during the update grace period", async () => {
    vi.useFakeTimers();
    const wallet = createRandom();
    let checks = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: {
        available: true, accepted: ++checks > 1, satisfied: true,
      } }),
    })));
    const client = new GatewayClient({ baseUrl: "https://gateway.robotania.ai", wallet, chainId: 421614 });
    const waiting = client.waitForTermsAcceptance(10_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(waiting).resolves.toBeUndefined();
    expect(checks).toBe(2);
  });

  it("signs a review-link request without submitting acceptance", async () => {
    const wallet = createRandom();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: calls.length === 1
        ? { deployment_id: "sepolia:test", terms_hash: "0x" + "1".repeat(64),
            privacy_hash: "0x" + "2".repeat(64), acceptance_text_hash: "0x" + "3".repeat(64),
            nonce: "0x" + "4".repeat(64), issued_at: 1000, expires_at: 1300 }
        : { url: "https://robotania.ai/accept/token" } }) };
    }));
    const client = new GatewayClient({ baseUrl: "https://gateway.robotania.ai", wallet, chainId: 421614 });
    expect(await client.createTermsReviewLink()).toBe("https://robotania.ai/accept/token");
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      "/api/v1/agent/terms/link-challenge", "/api/v1/agent/terms/links",
    ]);
    const { request, signature } = JSON.parse(calls[1]!.init!.body as string) as {
      request: Record<string, unknown>; signature: `0x${string}`;
    };
    expect(request).not.toHaveProperty("checked");
    expect(await verifyTypedData({
      address: wallet.address, domain: buildRobotaniaDomain(421614),
      primaryType: "OperatorReviewLinkRequest",
      types: { OperatorReviewLinkRequest: [
        { name: "purpose", type: "string" }, { name: "wallet", type: "address" },
        { name: "deploymentId", type: "string" }, { name: "termsHash", type: "bytes32" },
        { name: "privacyHash", type: "bytes32" }, { name: "acceptanceTextHash", type: "bytes32" },
        { name: "nonce", type: "bytes32" }, { name: "issuedAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
      ] },
      message: { ...request, issuedAt: BigInt(request.issuedAt as number), expiresAt: BigInt(request.expiresAt as number) } as never,
      signature,
    })).toBe(true);
  });

  it("preserves review-link errors from both Gateway endpoints", async () => {
    const wallet = createRandom();
    const challenge = { deployment_id: "sepolia:test", terms_hash: "0x" + "1".repeat(64),
      privacy_hash: "0x" + "2".repeat(64), acceptance_text_hash: "0x" + "3".repeat(64),
      nonce: "0x" + "4".repeat(64), issued_at: 1000, expires_at: 1300 };
    const client = new GatewayClient({ baseUrl: "https://gateway.robotania.ai", wallet, chainId: 421614 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429,
      json: async () => ({ ok: false, error_code: "RATE_LIMITED" }) })));
    await expect(client.createTermsReviewLink()).rejects.toMatchObject({
      statusCode: 429, errorCode: "RATE_LIMITED",
    });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ++calls === 1
      ? { ok: true, status: 200, json: async () => ({ ok: true, data: challenge }) }
      : { ok: false, status: 409, json: async () => ({ ok: false,
          error: { code: "REVIEW_CHALLENGE_EXPIRED", message: "Challenge expired" } }) }));
    await expect(client.createTermsReviewLink()).rejects.toMatchObject({
      statusCode: 409, errorCode: "REVIEW_CHALLENGE_EXPIRED", detail: "Challenge expired",
    });
  });

  it("bounds a stalled review request", async () => {
    vi.useFakeTimers();
    const client = new GatewayClient({ baseUrl: "https://gateway.robotania.ai",
      wallet: createRandom(), chainId: 421614, queryRetry: { timeoutMs: 20 } });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const request = client.createTermsReviewLink();
    const failure = expect(request).rejects.toMatchObject({ statusCode: 408, errorCode: "REVIEW_REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000 - 20);
    await failure;
  });
});
