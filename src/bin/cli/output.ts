export function log(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

export function result(data: unknown): void {
  process.stdout.write(safeStringify(data) + "\n");
}

export function fatal(msg: string, code = 1): never {
  process.stderr.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(code);
}

export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
