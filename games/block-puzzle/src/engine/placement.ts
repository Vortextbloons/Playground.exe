import { BOARD_SIZE, EMPTY, type Board, type LineClear, type Pos, type Shape } from './types';

/** Pure placement and line-clearing helpers. Every function returns new boards. */

export function createBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => new Array<number>(BOARD_SIZE).fill(EMPTY));
}

export function cloneBoard(board: Board): Board {
  return board.map(row => row.slice());
}

/** Absolute cells covered when `shape` is anchored with its bounding box at (row, col). */
export function placementCells(shape: Shape, row: number, col: number): Pos[] {
  return shape.cells.map(cell => ({ row: row + cell.row, col: col + cell.col }));
}

export function canPlace(board: Board, shape: Shape, row: number, col: number): boolean {
  for (const cell of shape.cells) {
    const r = row + cell.row;
    const c = col + cell.col;
    if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return false;
    if (board[r]![c] !== EMPTY) return false;
  }
  return true;
}

export function place(board: Board, shape: Shape, row: number, col: number, color: number): Board {
  const next = cloneBoard(board);
  for (const cell of shape.cells) next[row + cell.row]![col + cell.col] = color;
  return next;
}

/** Full rows and columns of the given board. */
export function completedLines(board: Board): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (board[r]!.every(cell => cell !== EMPTY)) rows.push(r);
  }
  for (let c = 0; c < BOARD_SIZE; c++) {
    let full = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (board[r]![c] === EMPTY) { full = false; break; }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/** De-duplicated cells removed by clearing the given rows and columns. */
export function clearingCells(rows: readonly number[], cols: readonly number[]): Pos[] {
  const seen = new Set<number>();
  const cells: Pos[] = [];
  const push = (row: number, col: number) => {
    const key = row * BOARD_SIZE + col;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ row, col });
  };
  for (const row of rows) for (let col = 0; col < BOARD_SIZE; col++) push(row, col);
  for (const col of cols) for (let row = 0; row < BOARD_SIZE; row++) push(row, col);
  return cells;
}

export function clearCells(board: Board, cells: readonly Pos[]): Board {
  const next = cloneBoard(board);
  for (const { row, col } of cells) next[row]![col] = EMPTY;
  return next;
}

/** Convenience: every row + column of the board that is currently full. */
export function lineClear(board: Board): LineClear {
  const { rows, cols } = completedLines(board);
  return { rows, cols, cells: clearingCells(rows, cols) };
}

/** True when `shape` fits anywhere on the board right now. */
export function hasAnyPlacement(board: Board, shape: Shape): boolean {
  for (let row = 0; row <= BOARD_SIZE - shape.height; row++) {
    for (let col = 0; col <= BOARD_SIZE - shape.width; col++) {
      if (canPlace(board, shape, row, col)) return true;
    }
  }
  return false;
}

/** All anchors where `shape` fits. */
export function findPlacements(board: Board, shape: Shape): Pos[] {
  const anchors: Pos[] = [];
  for (let row = 0; row <= BOARD_SIZE - shape.height; row++) {
    for (let col = 0; col <= BOARD_SIZE - shape.width; col++) {
      if (canPlace(board, shape, row, col)) anchors.push({ row, col });
    }
  }
  return anchors;
}

/**
 * Anchor choice for tap-to-place: prefer the piece centered on the tapped
 * cell, then fall back to the closest legal anchor so a tap still lands.
 */
export function resolveTapAnchor(board: Board, shape: Shape, row: number, col: number): Pos | null {
  const desiredRow = row - Math.floor((shape.height - 1) / 2);
  const desiredCol = col - Math.floor((shape.width - 1) / 2);
  let best: Pos | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= BOARD_SIZE - shape.height; r++) {
    for (let c = 0; c <= BOARD_SIZE - shape.width; c++) {
      if (!canPlace(board, shape, r, c)) continue;
      const dr = r - desiredRow;
      const dc = c - desiredCol;
      const distance = dr * dr + dc * dc - Math.max(dr, dc); // chessboard distance with a diagonal nudge
      if (distance < bestDistance) { bestDistance = distance; best = { row: r, col: c }; }
    }
  }
  return best;
}
