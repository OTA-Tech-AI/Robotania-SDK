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
    loadGatewayOnlyConfig: () => ({
      chainId: 31337,
      gatewayClient: {},
      wallet: {},
    } as unknown as ReturnType<typeof original.loadGatewayOnlyConfig>),
  };
});

vi.mock("../src/bin/cli/output.js", () => ({
  log: vi.fn(),
  result: (value: unknown) => { captured.results.push(value); },
  fatal: (message: string) => { throw new Error(message); },
}));

import { run as runCreateGame } from "../src/bin/cli/create-game.js";
import {
  runSetCitizenAvatar,
  runSetGameDisplay,
  runSubmitJuryRubric,
  runSubmitTurn,
} from "../src/bin/cli/gateway-cmds.js";
import { runCreatePractice, runJoinPractice, runPredictPractice } from "../src/bin/cli/practice.js";

const tempDirs: string[] = [];

function coverFile(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-display-cli-"));
  tempDirs.push(dir);
  const file = join(dir, "cover.webp");
  writeFileSync(file, bytes);
  return file;
}

function symbolMapFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-symbol-map-cli-"));
  tempDirs.push(dir);
  const file = join(dir, "symbols.json");
  writeFileSync(file, contents, "utf8");
  return file;
}

function paramsFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-create-params-"));
  tempDirs.push(dir);
  const file = join(dir, "game-params.json");
  writeFileSync(file, contents, "utf8");
  return file;
}

function jsonFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-json-cli-"));
  tempDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, contents, "utf8");
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
  it("reads create params from a UTF-8 file", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCreateGame([
      "--params-file", paramsFile(`\uFEFF${JSON.stringify({ settlerIds: ["7"], plannedTurnCount: 10 })}`),
    ], true);
    stdout.mockRestore();

    expect((captured.results[0] as { body: { params: Record<string, unknown> } }).body.params)
      .toMatchObject({ settlerIds: ["7"], plannedTurnCount: 10 });
  });

  it("rejects combining inline and file create params", async () => {
    await expect(runCreateGame([
      "--params", JSON.stringify({ settlerIds: ["7"] }),
      "--params-file", paramsFile(JSON.stringify({ settlerIds: ["7"] })),
    ], true)).rejects.toThrow("cannot be combined");
  });

  it("reads a turn payload from a UTF-8 file", async () => {
    await runSubmitTurn([
      "--match-id", "5",
      "--citizen-id", "2",
      "--payload-file", jsonFile("turn.json", `\uFEFF${JSON.stringify({ schemaVersion: 1, schemaKind: "board_turn_v1" })}`),
    ], true);

    expect((captured.results[0] as { body: Record<string, unknown> }).body.payloadContent)
      .toEqual({ schemaVersion: 1, schemaKind: "board_turn_v1" });
  });

  it("rejects combining inline and file turn payloads", async () => {
    await expect(runSubmitTurn([
      "--match-id", "5",
      "--citizen-id", "2",
      "--payload-content", JSON.stringify({ schemaVersion: 1, text: "turn" }),
      "--payload-file", jsonFile("turn.json", JSON.stringify({ schemaVersion: 1, text: "turn" })),
    ], true)).rejects.toThrow("cannot be combined");
  });

  it("reads a jury rubric from a UTF-8 file", async () => {
    await runSubmitJuryRubric([
      "--jury-case-id", "9",
      "--juror-citizen-id", "2",
      "--rubric-file", jsonFile("rubric.json", `\uFEFF${JSON.stringify({ summary: "A sufficiently detailed jury rationale for this outcome." })}`),
    ], true);

    expect((captured.results[0] as { body: Record<string, unknown> }).body.rubric)
      .toEqual({ summary: "A sufficiently detailed jury rationale for this outcome." });
  });

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

  it("reads a board symbol map into create and display dry-run payloads", async () => {
    const symbols = symbolMapFile('{"1":"🏰","2":"⚔️"}');
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCreateGame([
      "--params", JSON.stringify({ topicType: 1, settlerIds: ["7"] }),
      "--board-template-json", JSON.stringify({ board: { rows: 2, cols: 2, initial_state: [[0, 0], [0, 0]] } }),
      "--board-symbol-map-file", symbols,
    ], true);
    stdout.mockRestore();
    expect((captured.results[0] as { body: Record<string, unknown> }).body.boardSymbolMap)
      .toEqual({ "1": "🏰", "2": "⚔️" });

    captured.results.length = 0;
    await runSetGameDisplay([
      "--topic-id", "42",
      "--board-symbol-map-file", symbols,
    ], true);
    expect((captured.results[0] as { body: Record<string, unknown> }).body).toEqual({
      topicId: "42",
      boardSymbolMap: { "1": "🏰", "2": "⚔️" },
    });
  });

  it("rejects setting and clearing the same display field", async () => {
    await expect(runSetGameDisplay([
      "--topic-id", "42",
      "--human-description", "Replacement",
      "--clear-human-description",
    ], true)).rejects.toThrow("cannot be combined");
  });

  it("allows an avatar dry run without a configured citizen-id", async () => {
    const previousCitizenId = process.env.ROBOTANIA_CITIZEN_ID;
    delete process.env.ROBOTANIA_CITIZEN_ID;
    try {
      await runSetCitizenAvatar(["--clear-avatar"], true);
      const out = captured.results[0] as {
        message: { path: string; citizenId: string };
        body: Record<string, unknown>;
      };
      expect(out.message.path).toBe("/api/v1/agent/citizens/set-avatar");
      expect(out.message.citizenId).toBe("pending");
      expect(out.body).toEqual({ clearAvatar: true });
    } finally {
      if (previousCitizenId === undefined) delete process.env.ROBOTANIA_CITIZEN_ID;
      else process.env.ROBOTANIA_CITIZEN_ID = previousCitizenId;
    }
  });

  it("forwards Practice idempotency keys into the signed dry-run body", async () => {
    await runJoinPractice([
      "--practice-arena-id", "pa_1",
      "--idempotency-key", "join-pa_1-citizen_7",
    ], true);
    expect((captured.results[0] as { body: Record<string, unknown> }).body).toEqual({
      practiceArenaId: "pa_1",
      idempotencyKey: "join-pa_1-citizen_7",
    });

    captured.results.length = 0;
    await runPredictPractice([
      "--practice-match-id", "pm_1",
      "--side", "a",
      "--idempotency-key", "predict-pm_1-turn_2",
    ], true);
    expect((captured.results[0] as { body: Record<string, unknown> }).body).toMatchObject({
      practiceMatchId: "pm_1",
      side: 1,
      idempotencyKey: "predict-pm_1-turn_2",
    });
  });

  it("preserves the official-fill choice from a Practice params file", async () => {
    await runCreatePractice([
      "--params-file", paramsFile(JSON.stringify({
        topicType: "debate_text",
        title: "No automatic fill",
        description: "A concise agent briefing.",
        plannedTurnCount: 4,
        turnTimeoutSec: 60,
        allowOfficialCompetitorFill: false,
      })),
    ], true);

    expect((captured.results[0] as { body: Record<string, unknown> }).body)
      .toMatchObject({ allowOfficialCompetitorFill: false });
  });
});
