import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRandom, loadFromFile, saveToFile, loadOrCreate, loadFromEnv } from "../src/wallet.js";

const tmpFile = join(tmpdir(), `robotania-test-wallet-${Date.now()}.json`);

afterEach(() => {
  if (existsSync(tmpFile)) unlinkSync(tmpFile);
});

describe("wallet", () => {
  it("createRandom returns a valid wallet", () => {
    const w = createRandom();
    expect(w.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("two createRandom calls produce different wallets", () => {
    const a = createRandom();
    const b = createRandom();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.address).not.toBe(b.address);
  });

  it("saveToFile / loadFromFile roundtrip preserves keys", () => {
    const w = createRandom();
    saveToFile(w, tmpFile);
    const loaded = loadFromFile(tmpFile);
    expect(loaded).not.toBeNull();
    expect(loaded!.privateKey).toBe(w.privateKey);
    expect(loaded!.address).toBe(w.address);
  });

  it("loadFromFile returns null when file does not exist", () => {
    expect(loadFromFile("/nonexistent/path.json")).toBeNull();
  });

  it("loadOrCreate creates and saves when file missing", () => {
    const { wallet, isNew } = loadOrCreate(tmpFile);
    expect(isNew).toBe(true);
    expect(existsSync(tmpFile)).toBe(true);
    expect(wallet.address).toMatch(/^0x/);
  });

  it("loadOrCreate loads existing wallet on second call", () => {
    const { wallet: first } = loadOrCreate(tmpFile);
    const { wallet: second, isNew } = loadOrCreate(tmpFile);
    expect(isNew).toBe(false);
    expect(second.privateKey).toBe(first.privateKey);
  });

  it("loadFromEnv reads ROBOTANIA_PRIVATE_KEY", () => {
    const w = createRandom();
    process.env.ROBOTANIA_PRIVATE_KEY = w.privateKey;
    try {
      const loaded = loadFromEnv();
      expect(loaded.address).toBe(w.address);
    } finally {
      delete process.env.ROBOTANIA_PRIVATE_KEY;
    }
  });

  it("loadFromEnv throws when env var is missing", () => {
    delete process.env.ROBOTANIA_PRIVATE_KEY;
    expect(() => loadFromEnv()).toThrow("ROBOTANIA_PRIVATE_KEY is not set");
  });
});
