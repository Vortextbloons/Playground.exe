import { createPiece, pickColor, SHAPE_BY_ID } from './shapes';
import * as placement from './placement';
import { movePoints } from './scoring';
import {
  BOARD_SIZE, COLOR_COUNT, TRAY_SIZE,
  type Board, type GameState, type MoveResult, type Piece, type Rng, type SavedGame, type Tray,
} from './types';

/**
 * Game orchestration: tray generation, moves, game-over detection and
 * save/restore. All pure functions; randomness arrives through `rng`.
 */

const MAX_TRAY_ATTEMPTS = 48;

export function createEmptyState(): GameState {
  return { board: placement.createBoard(), tray: [null, null, null], score: 0, combo: 0, moves: 0, status: 'idle' };
}

function shapeOf(piece: Piece) {
  return SHAPE_BY_ID.get(piece.shapeId);
}

/**
 * Generates a fresh set of three pieces. Retries until at least one piece can
 * be played on the current board, so a new set is never instantly dead — but
 * sets that merely look hard are still allowed through.
 */
export function generateTray(board: Board, rng: Rng): Tray {
  let fallback: Tray = [null, null, null];
  for (let attempt = 0; attempt < MAX_TRAY_ATTEMPTS; attempt++) {
    // Once the easy attempts run out, anchor the set with a single square so
    // it can never be dead while any cell remains free.
    const first = attempt >= MAX_TRAY_ATTEMPTS / 2
      ? Object.freeze({ shapeId: 'dot', color: pickColor(rng) })
      : createPiece(rng);
    const second = createPiece(rng, first.color);
    const third = createPiece(rng, second.color);
    const pieces = [first, second, third];
    fallback = pieces;
    // Three identical shapes read as a bug; reroll.
    if (pieces.every(piece => piece.shapeId === first.shapeId)) continue;
    const playable = pieces.some(piece => {
      const shape = shapeOf(piece);
      return shape ? placement.hasAnyPlacement(board, shape) : false;
    });
    if (playable) return pieces;
  }
  return fallback;
}

export function startGame(rng: Rng): GameState {
  const board = placement.createBoard();
  return { board, tray: generateTray(board, rng), score: 0, combo: 0, moves: 0, status: 'playing' };
}

/** True while at least one piece in the tray still has a legal placement. */
export function hasMovesLeft(state: GameState): boolean {
  return state.tray.some(piece => {
    if (!piece) return false;
    const shape = shapeOf(piece);
    return shape ? placement.hasAnyPlacement(state.board, shape) : false;
  });
}

/**
 * Applies a move without mutating the input state. Returns null when the move
 * is illegal (wrong phase, empty slot or imprecise anchor), so callers can
 * treat null as "nothing happened".
 */
export function applyMove(state: GameState, index: number, row: number, col: number, rng: Rng): MoveResult | null {
  if (state.status !== 'playing') return null;
  const piece = state.tray[index];
  if (!piece) return null;
  const shape = shapeOf(piece);
  if (!shape || !placement.canPlace(state.board, shape, row, col)) return null;

  const boardAfterPlace = placement.place(state.board, shape, row, col, piece.color);
  const clear = placement.lineClear(boardAfterPlace);
  const lines = clear.rows.length + clear.cols.length;
  const board = lines > 0 ? placement.clearCells(boardAfterPlace, clear.cells) : boardAfterPlace;

  const combo = lines > 0 ? state.combo + 1 : 0;
  const points = movePoints(shape.size, lines, combo);
  const score = state.score + points.placement + points.clear;

  const tray = state.tray.slice();
  tray[index] = null;
  let nextTray: Tray = tray;
  let refilled = false;
  if (tray.every(slot => slot === null)) {
    nextTray = generateTray(board, rng);
    refilled = true;
  }

  const gameOver = !hasMovesLeft({ board, tray: nextTray, score, combo, moves: state.moves + 1, status: 'playing' });
  const next: GameState = {
    board,
    tray: nextTray,
    score,
    combo,
    moves: state.moves + 1,
    status: gameOver ? 'gameover' : 'playing',
  };

  return {
    next,
    placedCells: placement.placementCells(shape, row, col),
    boardAfterPlace,
    clear,
    points,
    combo,
    refilled,
    gameOver,
  };
}

// ---------------------------------------------------------------------------
// Persistence

export function serialize(state: GameState): SavedGame {
  return {
    version: 1,
    board: state.board.map(row => row.slice()),
    tray: state.tray.map(piece => (piece ? { shapeId: piece.shapeId, color: piece.color } : null)),
    score: state.score,
    combo: state.combo,
    moves: state.moves,
  };
}

const isIndex = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

const isBoardNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= COLOR_COUNT;

/** Validates untrusted saved data; returns null when anything is off. */
export function deserialize(data: unknown): GameState | null {
  if (!data || typeof data !== 'object') return null;
  const saved = data as Partial<SavedGame>;
  if (saved.version !== 1 || !Array.isArray(saved.board) || saved.board.length !== BOARD_SIZE) return null;
  const board: Board = [];
  for (const row of saved.board) {
    if (!Array.isArray(row) || row.length !== BOARD_SIZE || !row.every(isBoardNumber)) return null;
    board.push(row.slice());
  }
  if (!Array.isArray(saved.tray) || saved.tray.length !== TRAY_SIZE) return null;
  const tray: Tray = [];
  for (const slot of saved.tray) {
    if (slot === null) { tray.push(null); continue; }
    if (typeof slot !== 'object' || !slot) return null;
    const { shapeId, color } = slot as { shapeId?: unknown; color?: unknown };
    if (typeof shapeId !== 'string' || !SHAPE_BY_ID.has(shapeId)) return null;
    if (!isIndex(color, COLOR_COUNT) || color === 0) return null;
    tray.push({ shapeId, color });
  }
  if (typeof saved.score !== 'number' || !Number.isFinite(saved.score) || saved.score < 0) return null;
  if (!isIndex(saved.combo, Number.MAX_SAFE_INTEGER)) return null;
  if (!isIndex(saved.moves, Number.MAX_SAFE_INTEGER)) return null;
  return { board, tray, score: Math.floor(saved.score), combo: saved.combo, moves: saved.moves, status: 'playing' };
}
