import { readFileSync } from "node:fs";

/** Reject duplicate root keys before JSON.parse applies its last-key-wins behavior. */
function assertNoDuplicateRootKeys(json: string): void {
  let i = 0;
  const ws = () => { while (/\s/u.test(json[i] ?? "")) i += 1; };
  const readString = (): string => {
    const start = i;
    i += 1; // opening quote
    let escaped = false;
    while (i < json.length) {
      const ch = json[i++]!;
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') return JSON.parse(json.slice(start, i)) as string;
    }
    throw new Error("unterminated JSON string");
  };
  const skipValue = () => {
    ws();
    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (i < json.length) {
      const ch = json[i];
      if (inString) {
        i += 1;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; i += 1; continue; }
      if (ch === "{" || ch === "[") { depth += 1; i += 1; continue; }
      if (ch === "}" || ch === "]") {
        if (depth === 0) break;
        depth -= 1;
        i += 1;
        continue;
      }
      if (ch === "," && depth === 0) break;
      i += 1;
    }
    if (start === i) throw new Error("missing JSON value");
  };

  ws();
  if (json[i] !== "{") return;
  i += 1;
  const keys = new Set<string>();
  while (true) {
    ws();
    if (json[i] === "}") return;
    if (json[i] !== '"') return;
    const key = readString();
    if (keys.has(key)) throw new Error(`duplicate board value key: ${key}`);
    keys.add(key);
    ws();
    if (json[i] !== ":") return;
    i += 1;
    skipValue();
    ws();
    if (json[i] === "}") return;
    if (json[i] !== ",") return;
    i += 1;
  }
}

/** Read the human-only board value → emoji map sent to the Gateway. */
export function readBoardSymbolMapFile(filePath: string): Record<string, string> {
  let parsed: unknown;
  try {
    const raw = readFileSync(filePath, "utf8");
    assertNoDuplicateRootKeys(raw);
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`file must contain valid UTF-8 JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON must be an object mapping board values to emoji");
  }
  return parsed as Record<string, string>;
}
