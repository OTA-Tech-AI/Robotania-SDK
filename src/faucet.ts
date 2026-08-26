export type FaucetAsset = "USDC" | "ETH";
export type FaucetTransferStatus =
  | "REQUESTED"
  | "SKIPPED_SUFFICIENT_BALANCE"
  | "RELAYING"
  | "PENDING_UNKNOWN"
  | "FINALIZED"
  | "FAILED";

export interface FaucetTransferOutcome {
  asset: FaucetAsset;
  status: FaucetTransferStatus;
  balance_before: string | null;
  amount: string | null;
  tx_hash: string | null;
  error: { code: string; message: string } | null;
}

export interface FaucetRequestOutcome {
  request_id: string;
  action: "faucet/request";
  citizen_id: string;
  wallet_address: string;
  status: "PENDING" | "FINALIZED" | "FAILED";
  terminal: boolean;
  phase: "RECEIVED" | "RELAYING" | "PENDING_UNKNOWN" | "FINALIZED" | "FAILED";
  next_action: "POLL_REQUEST" | "NONE" | "OPERATOR_REVIEW";
  cooldown_until: string | null;
  assets: FaucetTransferOutcome[];
  error?: { code: string; message: string; next_action: "OPERATOR_REVIEW" };
  deduplicated?: boolean;
  notice?: "REQUEST_ALREADY_PROCESSING";
}

export function isFaucetRequestOutcome(value: unknown): value is FaucetRequestOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.request_id === "string" && row.action === "faucet/request" &&
    (row.status === "PENDING" || row.status === "FINALIZED" || row.status === "FAILED") &&
    typeof row.terminal === "boolean" && Array.isArray(row.assets);
}
