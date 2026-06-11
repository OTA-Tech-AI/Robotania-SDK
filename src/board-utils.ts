/**
 * Board snapshot utilities for agents — structural conversion/rendering only.
 * Does not adjudicate move legality or game rules.
 */

export type BoardPiece = { r: number; c: number; v: number };

export type BoardSparseSnapshot = {
  rows: number;
  cols: number;
  pieces: BoardPiece[];
  underlay_pieces?: BoardPiece[];
};

export type BoardValidationResult =
  | { ok: true; value: BoardSparseSnapshot }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function parsePiecesArray(raw: unknown, field: string): { ok: true; pieces: BoardPiece[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `${field} must be an array` };
  const pieces: BoardPiece[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isPlainObject(item)) return { ok: false, error: `${field} entries must be objects` };
    const r = item.r;
    const c = item.c;
    const v = item.v;
    if (!isInt(r) || !isInt(c) || !isInt(v)) {
      return { ok: false, error: `${field} entries require integer r, c, v` };
    }
    const key = `${r},${c}`;
    if (seen.has(key)) return { ok: false, error: `${field} contains duplicate cell (${r}, ${c})` };
    seen.add(key);
    pieces.push({ r, c, v });
  }
  return { ok: true, pieces };
}

/** Structural validation for sparse board snapshots (no game-rule checks). */
export function validateBoardSnapshot(
  snapshot: unknown,
  opts: { maxRows?: number; maxCols?: number } = {},
): BoardValidationResult {
  const maxRows = opts.maxRows ?? 256;
  const maxCols = opts.maxCols ?? 256;
  if (!isPlainObject(snapshot)) return { ok: false, error: "snapshot must be an object" };

  const rows = snapshot.rows;
  const cols = snapshot.cols;
  if (!isInt(rows) || !isInt(cols)) return { ok: false, error: "rows and cols must be integers" };
  if (rows < 1 || cols < 1) return { ok: false, error: "rows and cols must be >= 1" };
  if (rows > maxRows) return { ok: false, error: `rows exceeds max (${maxRows})` };
  if (cols > maxCols) return { ok: false, error: `cols exceeds max (${maxCols})` };

  const piecesRes = parsePiecesArray(snapshot.pieces, "pieces");
  if (!piecesRes.ok) return piecesRes;

  const underlayRaw = snapshot.underlay_pieces;
  const underlayRes =
    underlayRaw === undefined
      ? { ok: true as const, pieces: [] as BoardPiece[] }
      : parsePiecesArray(underlayRaw, "underlay_pieces");
  if (!underlayRes.ok) return underlayRes;

  for (const p of piecesRes.pieces) {
    if (p.r < 0 || p.r >= rows || p.c < 0 || p.c >= cols) {
      return { ok: false, error: `pieces contains out-of-range cell (r=${p.r}, c=${p.c})` };
    }
  }
  for (const p of underlayRes.pieces) {
    if (p.r < 0 || p.r >= rows || p.c < 0 || p.c >= cols) {
      return { ok: false, error: `underlay_pieces contains out-of-range cell (r=${p.r}, c=${p.c})` };
    }
  }

  return {
    ok: true,
    value: {
      rows,
      cols,
      pieces: piecesRes.pieces,
      underlay_pieces: underlayRes.pieces.length > 0 ? underlayRes.pieces : undefined,
    },
  };
}

/** Build a dense matrix from a sparse snapshot (zeros for empty cells). */
export function sparseToMatrix(snapshot: BoardSparseSnapshot): number[][] {
  const matrix = Array.from({ length: snapshot.rows }, () =>
    Array.from({ length: snapshot.cols }, () => 0),
  );
  for (const p of snapshot.pieces) {
    matrix[p.r]![p.c] = p.v;
  }
  return matrix;
}

/** Convert a dense matrix to sparse `pieces` (non-zero cells only). */
export function matrixToSparse(
  rows: number,
  cols: number,
  matrix: number[][],
  underlayMatrix?: number[][] | null,
): BoardSparseSnapshot {
  const pieces: BoardPiece[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = matrix[r]?.[c] ?? 0;
      if (v !== 0) pieces.push({ r, c, v });
    }
  }
  const underlay_pieces: BoardPiece[] = [];
  if (underlayMatrix) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = underlayMatrix[r]?.[c] ?? 0;
        if (v !== 0) underlay_pieces.push({ r, c, v });
      }
    }
  }
  return {
    rows,
    cols,
    pieces,
    underlay_pieces: underlay_pieces.length > 0 ? underlay_pieces : undefined,
  };
}

const DEFAULT_VALUE_LABELS: Record<number, string> = {
  0: ".",
  1: "A",
  2: "B",
  9: "C",
};

/** Render a sparse snapshot as an ASCII grid for LLM prompts. */
export function renderBoardAscii(
  snapshot: BoardSparseSnapshot,
  valueLabels: Record<number, string> = DEFAULT_VALUE_LABELS,
): string {
  const matrix = sparseToMatrix(snapshot);
  const underlay = snapshot.underlay_pieces ?? [];
  const lines: string[] = [];
  for (let r = 0; r < snapshot.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < snapshot.cols; c++) {
      const play = matrix[r]![c]!;
      if (play !== 0) {
        cells.push(valueLabels[play] ?? String(play));
        continue;
      }
      const under = underlay.find((p) => p.r === r && p.c === c);
      cells.push(under ? (valueLabels[under.v] ?? String(under.v)) : (valueLabels[0] ?? "."));
    }
    lines.push(cells.join(" "));
  }
  return lines.join("\n");
}

export type BoardCellDiff = {
  r: number;
  c: number;
  before: number;
  after: number;
};

/** Observation-only diff between two sparse snapshots (no legality verdict). */
export function diffBoardSnapshots(
  before: BoardSparseSnapshot,
  after: BoardSparseSnapshot,
): BoardCellDiff[] {
  if (before.rows !== after.rows || before.cols !== after.cols) {
    throw new Error("diffBoardSnapshots requires matching rows and cols");
  }
  const beforeMatrix = sparseToMatrix(before);
  const afterMatrix = sparseToMatrix(after);
  const diffs: BoardCellDiff[] = [];
  for (let r = 0; r < before.rows; r++) {
    for (let c = 0; c < before.cols; c++) {
      const b = beforeMatrix[r]![c]!;
      const a = afterMatrix[r]![c]!;
      if (b !== a) diffs.push({ r, c, before: b, after: a });
    }
  }
  return diffs;
}
