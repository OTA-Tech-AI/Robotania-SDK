import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBoardSymbolMapFile } from "../src/bin/cli/board-symbol-map.js";

const dirs: string[] = [];

function writeMap(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "robotania-board-symbol-map-"));
  dirs.push(dir);
  const file = join(dir, "symbols.json");
  writeFileSync(file, contents, "utf8");
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("board symbol map CLI file reader", () => {
  it("reads a UTF-8 JSON object", () => {
    expect(readBoardSymbolMapFile(writeMap('{"-1":"🌲","2":"⚔️"}')))
      .toEqual({ "-1": "🌲", "2": "⚔️" });
  });

  it("rejects duplicate root keys before JSON parsing collapses them", () => {
    expect(() => readBoardSymbolMapFile(writeMap('{"1":"🏰","1":"⚔️"}')))
      .toThrow("duplicate board value key");
  });
});
