// Copyright (c) 2026 OTA-Tech-AI
// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createClient } from "../src/client.js";
import { LOCAL_DEV_READ_API_URL } from "../src/defaults.js";

const privateKey = `0x${"11".repeat(32)}` as `0x${string}`;
const wallet = { privateKey, address: privateKeyToAccount(privateKey).address };
const options = { wallet, chainId: 421614, citizenActionRelay: "0x1111111111111111111111111111111111111111" as const };
const fileUrl = "https://read.file.example";
let directory: string;
let previousDirectory: string;

beforeEach(() => {
  previousDirectory = process.cwd();
  directory = mkdtempSync(join(tmpdir(), "robotania-client-config-"));
  writeFileSync(join(directory, ".env"), `ROBOTANIA_READ_API_URL=${fileUrl}\n`);
  process.chdir(directory);
  vi.stubEnv("ROBOTANIA_READ_API_URL", undefined);
  vi.stubEnv("ROBOTANIA_DEPLOYED_ADDRESSES_PATH", join(directory, "absent.json"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
});

afterEach(() => {
  process.chdir(previousDirectory);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe("createClient environment loading", () => {
  it.each([
    ["production", true, true],
    ["production", false, false],
    ["production", undefined, false],
    ["development", true, true],
    ["development", false, false],
    ["development", undefined, true],
  ] as const)("uses NODE_ENV=%s with loadEnv=%s", (environment, loadEnv, expected) => {
    vi.stubEnv("NODE_ENV", environment);
    const client = createClient({ ...options, ...(loadEnv === undefined ? {} : { loadEnv }) });
    expect(client.config.readApiUrl).toBe(expected ? fileUrl : LOCAL_DEV_READ_API_URL);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps an inherited environment value ahead of the env file", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ROBOTANIA_READ_API_URL", "https://read.inherited.example");
    const client = createClient({ ...options, loadEnv: true });
    expect(client.config.readApiUrl).toBe("https://read.inherited.example");
  });

  it("keeps an explicit URL ahead of environment and env-file values", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ROBOTANIA_READ_API_URL", "https://read.inherited.example");
    const client = createClient({ ...options, loadEnv: true, readApiUrl: "https://read.option.example" });
    expect(client.config.readApiUrl).toBe("https://read.option.example");
  });
});
