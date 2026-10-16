/**
 * Solo opponent. Only ever reads the public board and always returns a legal
 * column. Easy and medium mix in randomness through the supplied rng; hard is a
 * deterministic alpha-beta search so play is reproducible and testable.
 */

import {
  COLS,
  ROWS,
  cellIndex,
  landingRow,
  other,
  validColumns,
  winningLine,
  wouldWin,
  type Axis,
  type Cell,
  type GameState,
  type Player,
} from '../rules/engine';
import type { Rng } from '../rules/rng';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Easy usually plays at random; sometimes it notices an obvious win or block. */
const EASY_SMART = 0.25;
const HARD_DEPTH = 6;
const WIN_SCORE = 1_000_000;
/** Centre-out ordering: prunes more branches and prefers strong columns on ties. */
const ORDER = [3, 2, 4, 1, 5, 0, 6] as const;

export function chooseMove(state: GameState, difficulty: Difficulty, rng: Rng): number {
  const columns = validColumns(state.board);
  if (columns.length === 0) throw new Error('There are no moves left.');
  if (difficulty === 'hard') return hardMove(state);
  if (difficulty === 'easy') {
    if (rng() < EASY_SMART) {
      const tactical = tacticalMove(state.board, state.turn, rng);
      if (tactical !== null) return tactical;
    }
    return pick(columns, rng);
  }
  return tacticalMove(state.board, state.turn, rng) ?? pick(columns, rng);
}

function pick(columns: readonly number[], rng: Rng): number {
  return columns[Math.floor(rng() * columns.length)]!;
}

/** Win now, otherwise block the opponent's next win, otherwise nothing. */
function tacticalMove(board: Axis, player: Player, rng: Rng): number | null {
  const columns = validColumns(board);
  const wins = columns.filter(col => wouldWin(board, col, player));
  if (wins.length) return pick(wins, rng);
  const blocks = columns.filter(col => wouldWin(board, col, other(player)));
  if (blocks.length) return pick(blocks, rng);
  return null;
}

function hardMove(state: GameState): number {
  const board = [...state.board];
  const player = state.turn;
  let best = -1;
  let bestScore = -Infinity;
  for (const col of ORDER) {
    const row = landingRow(board, col);
    if (row === -1) continue;
    const index = cellIndex(row, col);
    board[index] = player;
    const score = winningLine(board, index, player).length
      ? WIN_SCORE + HARD_DEPTH
      : -negamax(board, other(player), HARD_DEPTH - 1, -Infinity, Infinity);
    board[index] = null;
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  if (best === -1) throw new Error('There are no moves left.');
  return best;
}

/** Negamax with alpha-beta pruning; scores are from the side to move. */
function negamax(board: Cell[], player: Player, depth: number, alpha: number, beta: number): number {
  if (validColumns(board).length === 0) return 0;
  if (depth === 0) return evaluate(board, player);
  let best = -Infinity;
  for (const col of ORDER) {
    const row = landingRow(board, col);
    if (row === -1) continue;
    const index = cellIndex(row, col);
    board[index] = player;
    const score = winningLine(board, index, player).length
      ? WIN_SCORE + depth
      : -negamax(board, other(player), depth - 1, -beta, -alpha);
    board[index] = null;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Every straight run of four cells on the board. */
const WINDOWS: number[][] = (() => {
  const windows: number[][] = [];
  const run = (row: number, col: number, dr: number, dc: number): void => {
    windows.push(Array.from({ length: 4 }, (_, i) => cellIndex(row + dr * i, col + dc * i)));
  };
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS - 4; col++) run(row, col, 0, 1);
  }
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row <= ROWS - 4; row++) run(row, col, 1, 0);
  }
  for (let row = 0; row <= ROWS - 4; row++) {
    for (let col = 0; col <= COLS - 4; col++) {
      run(row, col, 1, 1);
      run(row + 3, col, -1, 1);
    }
  }
  return windows;
})();

/** Sums open windows: our discs gain, the opponent's discs cost a little more. */
function evaluate(board: Axis, player: Player): number {
  const them = other(player);
  let score = 0;
  for (const window of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const index of window) {
      const cell = board[index];
      if (cell === player) mine++;
      else if (cell === them) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 50;
    else if (mine === 2) score += 8;
    else if (mine === 1) score += 1;
    if (theirs === 3) score -= 55;
    else if (theirs === 2) score -= 9;
    else if (theirs === 1) score -= 1;
  }
  return score;
}
