import { describe, expect, it } from "vitest";
import {
  diffBoardSnapshots,
  matrixToSparse,
  renderBoardAscii,
  sparseToMatrix,
  validateBoardSnapshot,
} from "../src/board-utils.js";

const INITIAL = {
  rows: 5,
  cols: 5,
  pieces: [
    { r: 2, c: 0, v: 1 },
    { r: 2, c: 4, v: 2 },
  ],
  underlay_pieces: [{ r: 2, c: 2, v: 9 }],
};

describe("validateBoardSnapshot", () => {
  it("accepts valid sparse snapshots", () => {
    expect(validateBoardSnapshot(INITIAL).ok).toBe(true);
  });

  it("rejects empty object", () => {
    expect(validateBoardSnapshot({}).ok).toBe(false);
  });
});

describe("sparseToMatrix / matrixToSparse", () => {
  it("round-trips non-zero cells", () => {
    const matrix = sparseToMatrix(INITIAL);
    expect(matrix[2]![0]).toBe(1);
    const sparse = matrixToSparse(5, 5, matrix, sparseToMatrix({ ...INITIAL, pieces: [], underlay_pieces: INITIAL.underlay_pieces }));
    expect(sparse.pieces).toEqual(INITIAL.pieces);
  });
});

describe("renderBoardAscii", () => {
  it("renders center claim layout", () => {
    const ascii = renderBoardAscii(INITIAL);
    expect(ascii.split("\n")[2]).toBe("A . C . B");
  });
});

describe("diffBoardSnapshots", () => {
  it("lists changed cells only", () => {
    const after = {
      ...INITIAL,
      pieces: [
        { r: 2, c: 1, v: 1 },
        { r: 2, c: 4, v: 2 },
      ],
    };
    expect(diffBoardSnapshots(INITIAL, after)).toEqual([
      { r: 2, c: 0, before: 1, after: 0 },
      { r: 2, c: 1, before: 0, after: 1 },
    ]);
  });
});
