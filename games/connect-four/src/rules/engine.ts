/**
 * Pure Connect Four rules. Every function is deterministic, returns brand-new
 * state, and throws on illegal moves. The solo UI, the AI and the multiplayer
 * server adapter all run through this module — the rules live here only.
 */

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

export type Player = 0 | 1;
export type Cell = Player | null;
export type Axis = readonly Cell[];
export type Phase = 'playing' | 'won' | 'draw';

export type GameState = {
  /** Row-major, top row first: index = row * COLS + col. */
  board: Cell[];
  turn: Player;
  phase: Phase;
  winner: Player | null;
  winningCells: number[];
  lastMove: number | null;
};

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export const other = (player: Player): Player => (player === 0 ? 1 : 0);
export const cellIndex = (row: number, col: number): number => row * COLS + col;
export const rowOf = (index: number): number => Math.floor(index / COLS);
export const colOf = (index: number): number => index % COLS;

export function newGame(): GameState {
  return {
    board: Array<Cell>(CELLS).fill(null),
    turn: 0,
    phase: 'playing',
    winner: null,
    winningCells: [],
    lastMove: null,
  };
}

/** Lowest empty row in a column, or -1 when that column is full. */
export function landingRow(board: Axis, col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[cellIndex(row, col)] === null) return row;
  }
  return -1;
}

export function validColumns(board: Axis): number[] {
  const columns: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if (landingRow(board, col) !== -1) columns.push(col);
  }
  return columns;
}

/** The run of four or more through `index` for `player`, or [] when it is not a win. */
export function winningLine(board: Axis, index: number, player: Player): number[] {
  const row = rowOf(index);
  const col = colOf(index);
  for (const [dr, dc] of DIRECTIONS) {
    const line = [index];
    for (const sign of [-1, 1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[cellIndex(r, c)] === player) {
        if (sign < 0) line.unshift(cellIndex(r, c));
        else line.push(cellIndex(r, c));
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return [];
}

/** True when `player` dropping into `col` would complete a line. */
export function wouldWin(board: Axis, col: number, player: Player): boolean {
  const row = landingRow(board, col);
  if (row === -1) return false;
  const index = cellIndex(row, col);
  const filled = [...board];
  filled[index] = player;
  return winningLine(filled, index, player).length > 0;
}

export function applyDrop(state: GameState, col: number): GameState {
  if (state.phase !== 'playing') throw new Error('This game is already over.');
  if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error(`Choose a column from 0 to ${COLS - 1}.`);
  const row = landingRow(state.board, col);
  if (row === -1) throw new Error('That column is full.');

  const next = structuredClone(state);
  const index = cellIndex(row, col);
  next.board[index] = next.turn;
  next.lastMove = index;

  const line = winningLine(next.board, index, next.turn);
  if (line.length) {
    next.phase = 'won';
    next.winner = next.turn;
    next.winningCells = line;
  } else if (validColumns(next.board).length === 0) {
    next.phase = 'draw';
  } else {
    next.turn = other(next.turn);
  }
  return next;
}
