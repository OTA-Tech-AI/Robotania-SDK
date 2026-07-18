import { describe, it, expect } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFileCb);

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY = resolve(__dirname, "../../dist/bin/robotania-bridge.js");
const NODE = process.execPath;

async function run(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const r = await execFileAsync(NODE, [BINARY, ...args], { encoding: "utf8" });
    return { status: 0, stdout: String(r.stdout), stderr: String(r.stderr) };
  } catch (err: unknown) {
    const x = err as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown; status?: number };
    return {
      status: typeof x.status === "number" ? x.status : 1,
      stdout: String(x.stdout ?? ""),
      stderr: String(x.stderr ?? ""),
    };
  }
}

describe("robotania-bridge CLI", () => {
  it("prints usage and exits 0 for --help", async () => {
    const r = await run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("robotania-bridge run");
  });

  it("prints usage and exits 0 for run --help", async () => {
    const r = await run(["run", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("robotania-bridge run");
  });

  it("prints usage and exits 1 without run subcommand", async () => {
    const r = await run([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("robotania-bridge run");
  });
});
