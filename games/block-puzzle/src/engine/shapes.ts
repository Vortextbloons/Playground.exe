import { COLOR_COUNT, type Piece, type Pos, type Rng, type Shape } from './types';

/** Parses a '#'-glyph pattern into a normalized shape. */
function defineShape(id: string, weight: number, pattern: readonly string[]): Shape {
  const cells: Pos[] = [];
  let width = 0;
  pattern.forEach((line, row) => {
    width = Math.max(width, line.length);
    line.split('').forEach((glyph, col) => {
      if (glyph === '#') cells.push({ row, col });
    });
  });
  return Object.freeze({ id, cells: Object.freeze(cells), width, height: pattern.length, size: cells.length, weight });
}

/**
 * Reusable shape library. Weights are tuned so lines, squares and small
 * L/T pieces fill most trays while 5-long lines and 3×3 squares stay rare.
 */
export const SHAPES: readonly Shape[] = Object.freeze([
  // Single square and blocky squares.
  defineShape('dot', 3, ['#']),
  defineShape('sq2', 9, ['##', '##']),
  defineShape('sq3', 1, ['###', '###', '###']),

  // Horizontal and vertical lines.
  defineShape('h2', 9, ['##']),
  defineShape('h3', 8, ['###']),
  defineShape('h4', 5, ['####']),
  defineShape('h5', 3, ['#####']),
  defineShape('v2', 9, ['#', '#']),
  defineShape('v3', 8, ['#', '#', '#']),
  defineShape('v4', 5, ['#', '#', '#', '#']),
  defineShape('v5', 3, ['#', '#', '#', '#', '#']),

  // Rectangles.
  defineShape('recth', 2, ['###', '###']),
  defineShape('rectv', 2, ['##', '##', '##']),

  // Small 3-cell L pieces (all four orientations).
  defineShape('l2a', 4, ['#.', '##']),
  defineShape('l2b', 4, ['##', '#.']),
  defineShape('l2c', 4, ['##', '.#']),
  defineShape('l2d', 4, ['.#', '##']),

  // 4-cell L / J pieces, tall and wide.
  defineShape('l3a', 3, ['#.', '#.', '##']),
  defineShape('l3b', 3, ['##', '#.', '#.']),
  defineShape('l3c', 3, ['##', '.#', '.#']),
  defineShape('l3d', 3, ['.#', '.#', '##']),
  defineShape('l3e', 2, ['###', '#..']),
  defineShape('l3f', 2, ['###', '..#']),
  defineShape('l3g', 2, ['#..', '###']),
  defineShape('l3h', 2, ['..#', '###']),

  // T pieces.
  defineShape('t4a', 3, ['###', '.#.']),
  defineShape('t4b', 3, ['.#.', '###']),
  defineShape('t4c', 2, ['#.', '##', '#.']),
  defineShape('t4d', 2, ['.#', '##', '.#']),

  // S / Z pieces.
  defineShape('s4a', 2, ['##.', '.##']),
  defineShape('z4a', 2, ['.##', '##.']),
  defineShape('s4b', 2, ['#.', '##', '.#']),
  defineShape('z4b', 2, ['.#', '##', '#.']),

  // Chunky 5-cell T pieces — rare, and the meanest shapes in the set.
  defineShape('t5a', 1, ['###', '.#.', '.#.']),
  defineShape('t5b', 1, ['#.', '###', '#.']),
]);

export const SHAPE_BY_ID: ReadonlyMap<string, Shape> = new Map(SHAPES.map(shape => [shape.id, shape]));

const TOTAL_WEIGHT = SHAPES.reduce((sum, shape) => sum + shape.weight, 0);

export function pickShape(rng: Rng): Shape {
  let roll = rng() * TOTAL_WEIGHT;
  for (const shape of SHAPES) {
    roll -= shape.weight;
    if (roll < 0) return shape;
  }
  return SHAPES[SHAPES.length - 1]!;
}

export function pickColor(rng: Rng, avoid = 0): number {
  let color = 1 + Math.floor(rng() * COLOR_COUNT);
  for (let attempt = 0; attempt < 3 && color === avoid; attempt++) color = 1 + Math.floor(rng() * COLOR_COUNT);
  return color;
}

export function createPiece(rng: Rng, avoidColor = 0): Piece {
  return Object.freeze({ shapeId: pickShape(rng).id, color: pickColor(rng, avoidColor) });
}
