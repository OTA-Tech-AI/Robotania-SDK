import { describe, expect, it } from "vitest";
import { parseArgv } from "../src/bin/cli/config.js";
import { requestOutcomeExitCode, result } from "../src/bin/cli/output.js";

describe("CLI write options", () => {
  it("waits up to 120 seconds by default", () => {
    expect(parseArgv(["heartbeat"])).toMatchObject({
      args: ["heartbeat"],
      writeOptions: { mode: "wait", timeoutMs: 120_000 },
    });
  });

  it("removes global async and timeout flags from command arguments", () => {
    expect(parseArgv(["--async", "heartbeat", "--timeout-ms", "5000", "--citizen-id", "7"])).toMatchObject({
      args: ["heartbeat", "--citizen-id", "7"],
      writeOptions: { mode: "async", timeoutMs: 5_000 },
    });
  });

  it("rejects invalid timeouts", () => {
    expect(() => parseArgv(["heartbeat", "--timeout-ms", "0"])).toThrow("positive integer");
  });

  it("rejects a missing timeout value", () => {
    expect(() => parseArgv(["heartbeat", "--timeout-ms"])).toThrow("requires a value");
  });

  it("maps request outcomes to CLI exit 0, 1, and 2", () => {
    expect(requestOutcomeExitCode("FINALIZED")).toBe(0);
    expect(requestOutcomeExitCode("FAILED")).toBe(1);
    expect(requestOutcomeExitCode("PENDING")).toBe(2);
  });

  it("marks an async pending outcome with exit 2 instead of success", () => {
    const originalExitCode = process.exitCode;
    const write = process.stdout.write;
    process.exitCode = undefined;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      result({ request_id: "req-1", status: "PENDING", terminal: false });
      expect(process.exitCode).toBe(2);
    } finally {
      process.stdout.write = write;
      process.exitCode = originalExitCode;
    }
  });
});
