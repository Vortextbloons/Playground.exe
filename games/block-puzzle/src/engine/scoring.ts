import type { MovePoints } from './types';

/**
 * Custom scoring:
 *  - +1 point per placed cell
 *  - line clears: 1 line 100, 2 lines 250, 3 lines 450, then +50 more per extra
 *    line of increment (4 → 700, 5 → 1000, …)
 *  - clearing on back-to-back moves raises a combo multiplier: ×1, ×1.5, ×2, …
 */

export const PLACEMENT_POINTS = 1;

export function lineClearPoints(lines: number): number {
  let points = 0;
  let step = 100;
  for (let i = 0; i < lines; i++) {
    points += step;
    step += 50;
  }
  return points;
}

export function comboMultiplier(combo: number): number {
  return combo <= 1 ? 1 : 1 + (combo - 1) * 0.5;
}

export function movePoints(cellCount: number, lines: number, comboAfter: number): MovePoints {
  const multiplier = lines > 0 ? comboMultiplier(comboAfter) : 1;
  return {
    placement: cellCount * PLACEMENT_POINTS,
    clear: lines > 0 ? Math.round(lineClearPoints(lines) * multiplier) : 0,
    lines,
    multiplier,
  };
}
