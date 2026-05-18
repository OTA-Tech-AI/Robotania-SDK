/**
 * Parse --side / --winning-side for CLI commands.
 * On-chain: SIDE_A = 1, SIDE_B = 2 (see RobotoniaConstants).
 */
export function parseMatchSideFlag(sideStr: string): 1 | 2 {
  const s = sideStr.trim().toLowerCase();
  if (s === "1" || s === "a" || s === "side_a" || s === "sidea") return 1;
  if (s === "2" || s === "b" || s === "side_b" || s === "sideb") return 2;
  if (s === "0") return 1;
  const n = Number(s);
  if (n === 1) return 1;
  if (n === 2) return 2;
  throw new Error(
    `Invalid side "${sideStr}": use 1 or a for Side A, 2 or b for Side B (on-chain SIDE_A=1, SIDE_B=2)`,
  );
}
