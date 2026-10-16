/**
 * Shared vocabulary for the block puzzle engine.
 * Pure data only — no Svelte, no DOM, no side effects.
 */

export const BOARD_SIZE = 8;
export const TRAY_SIZE = 3;
export const COLOR_COUNT = 7;

/** Board cells hold 0 when empty, otherwise a color id in 1..COLOR_COUNT. */
export const EMPTY = 0;
export type BoardCell = number;
export type Board = BoardCell[][];

export interface Pos {
  readonly row: number;
  readonly col: number;
}

export interface Shape {
  readonly id: string;
  /** Filled-cell offsets from the shape's top-left bounding box. */
  readonly cells: readonly Pos[];
  readonly width: number;
  readonly height: number;
  /** Number of filled cells. */
  readonly size: number;
  /** Relative generation weight; heavier shapes appear less often. */
  readonly weight: number;
}

export interface Piece {
  readonly shapeId: string;
  readonly color: number;
}

/** Three slots; each holds a piece until it is placed. */
export type Tray = (Piece | null)[];

export interface LineClear {
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  /** Every cell removed by this clear, de-duplicated across rows and columns. */
  readonly cells: readonly Pos[];
}

export interface MovePoints {
  /** +1 per placed cell. */
  readonly placement: number;
  /** Line points after the combo multiplier. */
  readonly clear: number;
  /** Rows plus columns cleared by this move. */
  readonly lines: number;
  /** Combo multiplier applied to the clear points. */
  readonly multiplier: number;
}

export type GameStatus = 'idle' | 'playing' | 'gameover';

export interface GameState {
  board: Board;
  tray: Tray;
  score: number;
  /** Consecutive line-clearing moves; 0 means no active combo. */
  combo: number;
  moves: number;
  status: GameStatus;
}

/** Everything the UI needs to animate a single move. */
export interface MoveResult {
  /** Settled state after clears, scoring and any tray refill. */
  next: GameState;
  placedCells: readonly Pos[];
  /** Placed cells present, completed lines still full — the mid-animation picture. */
  boardAfterPlace: Board;
  clear: LineClear;
  points: MovePoints;
  /** Combo after the move. */
  combo: number;
  /** The tray was empty and three new pieces were generated. */
  refilled: boolean;
  gameOver: boolean;
}

export interface SavedGame {
  version: 1;
  board: number[][];
  tray: ({ shapeId: string; color: number } | null)[];
  score: number;
  combo: number;
  moves: number;
}

/** Deterministic-friendly source of randomness in [0, 1). */
export type Rng = () => number;
