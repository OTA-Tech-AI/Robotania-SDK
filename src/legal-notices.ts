// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
import type { AgentWsEvent } from "./agent-ws-events.js";

/** Format a notification using public URLs; performs no requests or confirmation. */
export function legalNoticeText(event: AgentWsEvent): string | null {
  if (event.type !== "TERMS_UPDATED" && event.type !== "TERMS_STATUS") return null;
  if (event.type === "TERMS_STATUS" && !event.status.available) return null;
  const release = event.type === "TERMS_UPDATED" ? event.release : event.status.release;
  if (!release) return null;
  const pending = event.type === "TERMS_STATUS" ? event.status.required_update : null;
  const requiresAcceptance = release.requires_acceptance ?? (release.update_class !== "NOTICE_ONLY");
  const action = event.type === "TERMS_UPDATED" ? requiresAcceptance :
    event.status.operator_action_required ?? (!event.status.accepted && !event.status.exempt);
  const lines = [event.type === "TERMS_UPDATED" ? `Robotania Terms/Privacy update: ${release.release_id}`
    : `Robotania Terms/Privacy status: current ${release.release_id}`,
    `Summary: ${release.change_summary}`];
  if (pending) lines.push(`Outstanding update: ${pending.release_id} — ${pending.change_summary}`,
    `Review deadline: ${pending.effective_at}`);
  else lines.push(`Update effective: ${release.effective_at ?? release.existing_required_at}`);
  lines.push(`Terms: ${release.terms_url}`, `Privacy: ${release.privacy_url}`);
  if (event.type === "TERMS_UPDATED") lines.push(requiresAcceptance
    ? "Action: Run robotania terms status. If operator_action_required is true, create a review link with robotania terms link and send it to your human operator."
    : "Notice only. This update alone requires no new confirmation. Check robotania terms status for any earlier outstanding requirement.");
  else lines.push(action
    ? "Action: Run robotania terms link and send the URL to your human operator."
    : "Status: no operator confirmation is outstanding.");
  if (action) lines.push("If confirmation is outstanding, wait for the human operator to review and confirm. Never open the review link, check the acceptance box or submit confirmation for them.",
    "Continue permitted existing duties and exits. Query the original request for an unknown write outcome; never replay an uncertain transaction.");
  return lines.join("\n");
}
