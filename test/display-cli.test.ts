import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ results: [] as unknown[] }));

vi.mock("../src/bin/cli/config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/bin/cli/config.js")>();
  return {
    ...original,
    loadConfig: () => ({
      chainAddresses: { chainId: 31337 },
      gatewayClient: {},
      readClient: {},
      wallet: {},
    } as unknown as ReturnType<typeof original.loadConfig>),
  };
});

vi.mock("../src/bin/cli/output.js", () => ({
  log: vi.fn(),
  result: (value: unknown) => { captured.results.push(value); },
  fatal: (message: string) => { throw new Error(message); },
}));

import { run as runCreateGame } from "../src/bin/cli/create-game.js";
import { runSetGameDisplay } from "../src/bin/cli/gateway-cmds.js";

const tempDirs: string[] = [];

function coverFile(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-display-cli-"));
  tempDirs.push(dir);
  const file = join(dir, "cover.webp");
  writeFileSync(file, bytes);
  return file;
}

beforeEach(() => {
  captured.results.length = 0;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("display metadata CLI payloads", () => {
  it("includes create human description and cover bytes outside params", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCreateGame([
      "--params", JSON.stringify({ settlerIds: ["7"] }),
      "--human-description", "Human pitch",
      "--cover-image-file", coverFile(bytes),
    ], true);
    stdout.mockRestore();

    const out = captured.results[0] as {
      message: { path: string };
      body: Record<string, unknown>;
    };
    expect(out.message.path).toBe("/api/v1/agent/topics/create");
    expect(out.body.humanDescription).toBe("Human pitch");
    expect(out.body.coverImageBase64).toBe(bytes.toString("base64"));
    expect((out.body.params as Record<string, unknown>).humanDescription).toBeUndefined();
    expect((out.body.params as Record<string, unknown>).coverImageBase64).toBeUndefined();
  });

  it("builds a partial set/clear dry-run payload", async () => {
    await runSetGameDisplay([
      "--topic-id", "42",
      "--human-description", "Replacement",
      "--clear-cover-image",
    ], true);

    const out = captured.results[0] as {
      message: { path: string };
      body: Record<string, unknown>;
    };
    expect(out.message.path).toBe("/api/v1/agent/topics/set-display");
    expect(out.body).toEqual({
      topicId: "42",
      humanDescription: "Replacement",
      clearCoverImage: true,
    });
  });

  it("rejects setting and clearing the same display field", async () => {
    await expect(runSetGameDisplay([
      "--topic-id", "42",
      "--human-description", "Replacement",
      "--clear-human-description",
    ], true)).rejects.toThrow("cannot be combined");
  });
});
