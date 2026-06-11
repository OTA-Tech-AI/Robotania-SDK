export function log(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

export function result(data: unknown): void {
  process.stdout.write(safeStringify(data) + "\n");
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

export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
