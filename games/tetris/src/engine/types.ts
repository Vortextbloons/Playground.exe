export const COLS = 10;
export const ROWS = 20;
export const EMPTY = 0;

export type BoardCell = number;
export type Board = BoardCell[][];

export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface Pos {
  readonly row: number;
  readonly col: number;
}

export interface ActivePiece {
  readonly kind: PieceKind;
  readonly rot: number;
  readonly row: number;
  readonly col: number;
}

export type Rng = () => number;

export interface SavedGame {
  version: 1;
  board: number[][];
  active: ActivePiece;
  queue: PieceKind[];
  score: number;
  lines: number;
  level: number;
}
