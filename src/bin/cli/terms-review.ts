// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
import { GatewayError, isPreBroadcastTermsRejection, type TermsStatus } from "../../gateway.js";
import type { RequestNextAction } from "../../types.js";

/** The Gateway decides whether a wallet may continue during a notice period. */
export function termsReviewState(status: TermsStatus): "none" | "notice" | "required" {
  if (!status.available || status.accepted || status.exempt || status.operator_action_required === false) return "none";
  return status.satisfied === true ? "notice" : "required";
}

export async function checkTermsBeforeAction(
  getStatus: () => Promise<TermsStatus>,
  review: () => Promise<void>,
  notice: () => void,
): Promise<void> {
  let status: TermsStatus;
  try {
    status = await getStatus();
  } catch (error) {
    // Older Gateways may not expose status. A review-link failure must propagate.
    if (error instanceof GatewayError && error.statusCode === 404 &&
        error.path === "/api/v1/agent/terms/status") return;
    throw error;
  }
  const state = termsReviewState(status);
  if (state === "notice") notice();
  if (state === "required") await review();
}

export class TermsManualRetryError extends Error {
  constructor(public readonly requestId: string) {
    super(`Operator review completed. Request ${requestId} failed before broadcast. ` +
      "Retry the original command with a new idempotency key; the CLI will not replace your explicit key.");
  }
}

export async function recoverTermsRejection(
  error: unknown,
  hasExplicitIdempotencyKey: boolean,
  review: () => Promise<void>,
  retry: () => Promise<void>,
): Promise<void> {
  const queued = isPreBroadcastTermsRejection(error);
  if (!queued && !(error instanceof GatewayError && error.errorCode === "TERMS_ACCEPTANCE_REQUIRED")) throw error;
  await review();
  if (queued && hasExplicitIdempotencyKey) {
    throw new TermsManualRetryError(error.outcome.request_id);
  }
  await retry();
}

export function termsReviewNextAction(error: GatewayError): RequestNextAction | null {
  if (!error.path.startsWith("/api/v1/agent/terms/")) return null;
  return ["RATE_LIMITED", "REVIEW_CHALLENGE_EXPIRED", "REVIEW_REQUEST_TIMEOUT", "REVIEW_NETWORK_ERROR"]
    .includes(error.errorCode) ? "RETRY_NEW_REQUEST" : "REFRESH_CONTEXT";
}
