import { LOCAL_DEV_READ_API_URL } from "./defaults.js";

type DiscoveredSigningConfig = { chainId: number; citizenActionRelay: unknown };
export type GatewaySigningConfig = { chainId: number; citizenActionRelay: `0x${string}` };
const discoveryCache = new Map<string, Promise<DiscoveredSigningConfig>>();

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

  return (await discoverSigningConfig(options)).chainId;
}

function validRelay(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error("Gateway signing requires a valid nonzero CitizenActionRelay address. Check the Read API signing deployment or ROBOTANIA_CITIZEN_ACTION_RELAY.");
  }
  return value as `0x${string}`;
}

/** Resolve both signing domains in one lightweight request, with explicit offline overrides. */
export async function resolveGatewaySigningConfig(options: { readApiUrl?: string } = {}): Promise<GatewaySigningConfig> {
  const configuredChain = configuredSigningChainId();
  const rawRelay = process.env.ROBOTANIA_CITIZEN_ACTION_RELAY;
  const configuredRelay = rawRelay === undefined ? undefined : validRelay(rawRelay.trim());
  if (configuredChain !== undefined && configuredRelay !== undefined) {
    return { chainId: configuredChain, citizenActionRelay: configuredRelay };
  }
  const discovered = await discoverSigningConfig(options);
  if (configuredChain !== undefined && configuredChain !== discovered.chainId) {
    throw new Error("Configured chain ID does not match the Read API signing deployment; configure both chain ID and Relay explicitly for an offline deployment.");
  }
  try {
    return {
      chainId: configuredChain ?? discovered.chainId,
      citizenActionRelay: configuredRelay ?? validRelay(discovered.citizenActionRelay),
    };
  } catch (error) {
    // Permit a retry after the server's signing manifest has been repaired.
    discoveryCache.delete(signingApiBase(options));
    throw error;
  }
}

function signingApiBase(options: { readApiUrl?: string }): string {
  return (options.readApiUrl ?? process.env.ROBOTANIA_READ_API_URL ?? LOCAL_DEV_READ_API_URL).replace(/\/$/, "");
}

async function discoverSigningConfig(options: { readApiUrl?: string }): Promise<DiscoveredSigningConfig> {
  const base = signingApiBase(options);
  if (!base) throw new Error("Set ROBOTANIA_READ_API_URL or ROBOTANIA_CHAIN_ID before a signed Gateway request.");
  let pending = discoveryCache.get(base);
  if (!pending) {
    pending = (async () => {
      let response: Response;
      try {
        response = await fetch(`${base}/api/v1/public/system/signing-chain`, {
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
        throw new Error("Read API signing-chain response is not valid JSON; cannot sign a Gateway request.");
      }
      const data = body && typeof body === "object" && "data" in body ? body.data : undefined;
      const chainId = data && typeof data === "object" && "chain_id" in data ? data.chain_id : undefined;
      const relay = data && typeof data === "object" && "citizen_action_relay" in data ? data.citizen_action_relay : undefined;
      return { chainId: validChainId(chainId, "Read API signing-chain chain_id"), citizenActionRelay: relay };
    })();
    discoveryCache.set(base, pending);
    void pending.catch(() => {
      if (discoveryCache.get(base) === pending) discoveryCache.delete(base);
    });
  }
  return pending;
}
