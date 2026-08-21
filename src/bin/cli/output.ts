export function log(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

export function result(data: unknown): void {
  process.stdout.write(safeStringify(data) + "\n");
  // A pending request has been accepted, not completed. Preserve its machine-
  // readable result on stdout, but make the process outcome unambiguous for
  // scripts. This also applies to `--async` and `request-status`.
  if (isPendingRequestOutcome(data)) {
    process.exitCode = requestOutcomeExitCode("PENDING");
  }
}

const DOCS_HINT = "robotania docs path → docs/11-troubleshooting.md";

export function fatal(msg: string, code = 1): never {
  if (process.stderr.isTTY) {
    // Human terminal: JSON error first, then a plain-text hint on the next line
    process.stderr.write(JSON.stringify({ error: msg }) + "\n");
    process.stderr.write(`Docs: ${DOCS_HINT}\n`);
  } else {
    // Pipe / machine reader: hint as a JSON field so the single line stays parseable
    process.stderr.write(JSON.stringify({ error: msg, hint: DOCS_HINT }) + "\n");
  }
  process.exit(code);
}

export function fatalResult(data: unknown, code: 1 | 2): never {
  process.stderr.write(safeStringify(data) + "\n");
  process.exit(code);
}

export function requestOutcomeExitCode(status: "FINALIZED"): 0;
export function requestOutcomeExitCode(status: "FAILED"): 1;
export function requestOutcomeExitCode(status: "PENDING"): 2;
export function requestOutcomeExitCode(status: "PENDING" | "FINALIZED" | "FAILED"): 0 | 1 | 2 {
  if (status === "FINALIZED") return 0;
  return status === "FAILED" ? 1 : 2;
}

function isPendingRequestOutcome(value: unknown): value is { status: "PENDING"; terminal: false } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.status === "PENDING" && row.terminal === false;
}

export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
