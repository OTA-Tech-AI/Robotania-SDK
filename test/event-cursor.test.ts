import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileEventCursorStore } from "../src/event-cursor.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("FileEventCursorStore", () => {
  it("defaults missing or invalid cursor data to zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "robotania-cursor-"));
    created.push(root);
    const path = join(root, "nested", "events.json");
    const store = new FileEventCursorStore(path);

    expect(await store.load()).toBe(0);
    await writeFile(join(root, "invalid.json"), "{\"sequence\":-1}\n");
    expect(await new FileEventCursorStore(join(root, "invalid.json")).load()).toBe(0);
  });

  it("persists a portable JSON cursor and rejects invalid sequences", async () => {
    const root = await mkdtemp(join(tmpdir(), "robotania-cursor-"));
    created.push(root);
    const path = join(root, "nested", "events.json");
    const store = new FileEventCursorStore(path);

    await store.save(42);
    expect(await store.load()).toBe(42);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ sequence: 42 });
    await expect(store.save(-1)).rejects.toThrow(/non-negative safe integer/);
  });
});
