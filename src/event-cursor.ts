import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface EventCursorStore {
  load(): Promise<number>;
  save(sequence: number): Promise<void>;
}

/** Cross-platform JSON cursor store with atomic replace. */
export class FileEventCursorStore implements EventCursorStore {
  constructor(private readonly path: string) {}

  async load(): Promise<number> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as { sequence?: unknown };
      const sequence = Number(value.sequence);
      return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
    } catch {
      return 0;
    }
  }

  async save(sequence: number): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error("event cursor must be a non-negative safe integer");
    }
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        `${JSON.stringify({ sequence, updatedAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
