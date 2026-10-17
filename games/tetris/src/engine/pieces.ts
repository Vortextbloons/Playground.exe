import type { PieceKind, Pos, Rng } from './types';

const BASE: Record<PieceKind, readonly Pos[]> = {
  I: [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }],
  O: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
  T: [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
  S: [{ row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
  Z: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
  J: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
  L: [{ row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }],
};

export const BOX: Record<PieceKind, number> = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 };

export const COLOR: Record<PieceKind, number> = { I: 3, O: 4, T: 1, S: 2, Z: 5, J: 7, L: 6 };

export const KINDS: readonly PieceKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const SPAWN_COL: Record<PieceKind, number> = { I: 3, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

function rotateOnce(cells: readonly Pos[], size: number): Pos[] {
  return cells.map(cell => ({ row: cell.col, col: size - 1 - cell.row }));
}

export function cellsFor(kind: PieceKind, rot: number): Pos[] {
  let cells = BASE[kind].map(cell => ({ ...cell }));
  const turns = ((rot % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) cells = rotateOnce(cells, BOX[kind]);
  return cells;
}

const KICKS: readonly Pos[] = [
  { row: 0, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: -1, col: 0 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
  { row: 1, col: 0 },
  { row: -1, col: -1 },
  { row: -1, col: 1 },
];

export function kickOffsets(): readonly Pos[] {
  return KICKS;
}

export function shuffledBag(rng: Rng): PieceKind[] {
  const bag = [...KINDS];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  return bag;
}

export function takeFromQueue(queue: PieceKind[], rng: Rng): { kind: PieceKind; queue: PieceKind[] } {
  let rest = queue.slice();
  if (rest.length < 7) rest = rest.concat(shuffledBag(rng));
  const [kind, ...tail] = rest;
  return { kind: kind!, queue: tail };
}
