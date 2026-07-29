import { flag, loadConfig, requireFlag } from "./config.js";
import { fatal, result } from "./output.js";
import { FileEventCursorStore } from "../../event-cursor.js";
import { resolve } from "node:path";

function citizen(args: string[]): string {
  return (
    flag(args, "--citizen-id") ??
    process.env.ROBOTANIA_CITIZEN_ID ??
    requireFlag(args, "--citizen-id", "citizen ID")
  );
}

export async function runRuntime(args: string[], isDryRun: boolean): Promise<void> {
  if (isDryRun) fatal("runtime queries are read-only; --dry-run is not needed");
  const command = args[0];
  const rest = args.slice(1);
  const citizenId = citizen(rest);

  if (command === "cursor-reset") {
    const rawFloor = flag(rest, "--retention-floor-sequence");
    const rawAfter = flag(rest, "--after-sequence");
    if ((rawFloor == null) === (rawAfter == null)) {
      fatal("provide exactly one of --retention-floor-sequence or --after-sequence");
    }
    const rawValue = rawFloor ?? rawAfter!;
    if (!/^\d+$/.test(rawValue)) fatal("cursor sequence must be a non-negative integer");
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) fatal("cursor sequence is too large");
    if (rawFloor != null && value < 1) {
      fatal("--retention-floor-sequence must be a positive integer");
    }
    const cursorFile = resolve(
      flag(rest, "--cursor-file") ??
        process.env.ROBOTANIA_EVENT_CURSOR_FILE ??
        `.robotania/event-cursor-${citizenId}.json`,
    );
    const resumeAfter = rawFloor != null ? value - 1 : value;
    await new FileEventCursorStore(cursorFile).save(resumeAfter);
    result({
      cursor_file: cursorFile,
      after_sequence: resumeAfter,
      note: "Restart stay-online after authoritative task/context reconciliation.",
    });
    return;
  }

  const cfg = loadConfig();
  if (command === "events") {
    const rawAfter = flag(rest, "--after-sequence") ?? "0";
    const rawLimit = flag(rest, "--limit") ?? "100";
    if (
      !/^\d+$/.test(rawAfter) ||
      !/^[1-9]\d*$/.test(rawLimit) ||
      !Number.isSafeInteger(Number(rawAfter)) ||
      !Number.isSafeInteger(Number(rawLimit))
    ) {
      fatal("--after-sequence must be non-negative; --limit must be a positive safe integer");
    }
    result(await cfg.gatewayClient.queryAgentEvents({
      citizenId,
      afterSequence: Number(rawAfter),
      limit: Number(rawLimit),
    }));
    return;
  }
  if (command === "tasks") {
    result(await cfg.gatewayClient.listAgentTasks(citizenId));
    return;
  }
  if (command === "context") {
    const taskId = requireFlag(rest, "--task-id", "task ID");
    result(await cfg.gatewayClient.getAgentTaskContext(citizenId, taskId));
    return;
  }
  fatal("Usage: robotania runtime events|tasks|context|cursor-reset [options]");
}
