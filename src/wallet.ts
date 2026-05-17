/**
 * Wallet utilities — create, load, and persist agent wallets.
 *
 * Usage:
 *   const wallet = createRandom();           // brand-new throwaway wallet
 *   const wallet = loadFromEnv();            // ROBOTANIA_PRIVATE_KEY env var
 *   const wallet = loadFromFile(".wallet");  // JSON keyfile on disk
 *   await saveToFile(wallet, ".wallet");     // persist for next run
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface AgentWallet {
  /** 0x-prefixed 32-byte private key */
  privateKey: `0x${string}`;
  /** Derived checksummed address */
  address: `0x${string}`;
}

/** Create a brand-new random wallet. */
export function createRandom(): AgentWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

/**
 * Load wallet from ROBOTANIA_PRIVATE_KEY environment variable.
 * Throws a descriptive error if the variable is missing or malformed.
 */
export function loadFromEnv(envVar = "ROBOTANIA_PRIVATE_KEY"): AgentWallet {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(
      `${envVar} is not set. ` +
      `Set it to a 0x-prefixed 32-byte hex private key, ` +
      `or call createRandom() to generate one and then saveToFile().`,
    );
  }
  return fromPrivateKey(raw);
}

/**
 * Load wallet from a JSON keyfile previously written by saveToFile().
 * Returns null if the file does not exist (so you can fall back to createRandom()).
 */
export function loadFromFile(path: string): AgentWallet | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { privateKey?: string };
    if (!raw.privateKey) throw new Error("missing privateKey field");
    return fromPrivateKey(raw.privateKey);
  } catch (err) {
    throw new Error(`Failed to load wallet from ${path}: ${(err as Error).message}`);
  }
}

/**
 * Persist wallet to a JSON keyfile.
 * Keep this file out of source control (.gitignore it).
 */
export function saveToFile(wallet: AgentWallet, path: string): void {
  writeFileSync(path, JSON.stringify({ privateKey: wallet.privateKey, address: wallet.address }, null, 2), "utf8");
}

/**
 * Load or create: tries the keyfile first; creates and saves a new wallet when missing.
 * Ideal for first-run init scripts.
 */
export function loadOrCreate(path: string): { wallet: AgentWallet; isNew: boolean } {
  const existing = loadFromFile(path);
  if (existing) return { wallet: existing, isNew: false };
  const wallet = createRandom();
  saveToFile(wallet, path);
  return { wallet, isNew: true };
}

function fromPrivateKey(raw: string): AgentWallet {
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`Invalid private key format. Expected 0x + 64 hex chars, got: ${key.slice(0, 10)}...`);
  }
  const privateKey = key as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}
