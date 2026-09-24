import { LOCAL_DEV_READ_API_URL } from "./defaults.js";

const discoveryCache = new Map<string, Promise<number>>();

function validChainId(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${source} must be a positive safe integer for Gateway signing.`);
  }
  return value;
}

/** Read a deliberate signing-network override without requiring the Read API. */
export function configuredSigningChainId(): number | undefined {
  const name = process.env.ROBOTANIA_CHAIN_ID !== undefined
    ? "ROBOTANIA_CHAIN_ID"
    : process.env.CHAIN_ID !== undefined
      ? "CHAIN_ID"
      : null;
  if (!name) return undefined;
  const raw = process.env[name]?.trim() ?? "";
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive safe integer for Gateway signing.`);
  }
  return validChainId(Number(raw), name);
}

/** Resolve the EIP-712 chain ID independently of contract-address discovery. */
export async function resolveSigningChainId(options: { readApiUrl?: string } = {}): Promise<number> {
  const configured = configuredSigningChainId();
  if (configured !== undefined) return configured;

  const base = (options.readApiUrl ?? process.env.ROBOTANIA_READ_API_URL ?? LOCAL_DEV_READ_API_URL).replace(/\/$/, "");
  if (!base) throw new Error("Set ROBOTANIA_READ_API_URL or ROBOTANIA_CHAIN_ID before a signed Gateway request.");
  let pending = discoveryCache.get(base);
  if (!pending) {
    pending = (async () => {
      let response: Response;
      try {
        response = await fetch(`${base}/api/v1/public/system/deployment`, {
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        throw new Error(`Could not discover the signing chain ID from the Read API: ${error instanceof Error ? error.message : String(error)}. Check ROBOTANIA_READ_API_URL or set ROBOTANIA_CHAIN_ID explicitly.`);
      }
      if (!response.ok) {
        throw new Error(`Could not discover the signing chain ID from the Read API (HTTP ${response.status}). Check ROBOTANIA_READ_API_URL or set ROBOTANIA_CHAIN_ID explicitly.`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("Read API deployment response is not valid JSON; cannot sign a Gateway request.");
      }
      const data = body && typeof body === "object" && "data" in body ? body.data : undefined;
      const chainId = data && typeof data === "object" && "chain_id" in data ? data.chain_id : undefined;
      return validChainId(chainId, "Read API deployment chain_id");
    })();
    discoveryCache.set(base, pending);
    void pending.catch(() => {
      if (discoveryCache.get(base) === pending) discoveryCache.delete(base);
    });
  }
  return pending;
}
