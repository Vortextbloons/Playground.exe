import { cellsFor, COLOR, kickOffsets, SPAWN_COL, takeFromQueue } from './pieces';
import { COLS, EMPTY, ROWS, type ActivePiece, type Board, type PieceKind, type Rng, type SavedGame } from './types';

export const LINE_POINTS = [0, 100, 300, 500, 800];
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;

export function gravityInterval(level: number): number {
  return Math.max(80, Math.round(800 * Math.pow(0.85, level)));
}

export function levelFor(lines: number): number {
  return Math.floor(lines / 10);
}

export function scoreForLines(cleared: number, level: number): number {
  return (LINE_POINTS[Math.min(cleared, 4)] ?? 0) * (level + 1);
}

export function createBoard(): Board {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(EMPTY));
}

export function collides(board: Board, kind: PieceKind, rot: number, row: number, col: number): boolean {
  for (const cell of cellsFor(kind, rot)) {
    const r = row + cell.row;
    const c = col + cell.col;
    if (c < 0 || c >= COLS || r >= ROWS) return true;
    if (r >= 0 && board[r]![c] !== EMPTY) return true;
  }
  return false;
}

export function spawnFor(kind: PieceKind): ActivePiece {
  return { kind, rot: 0, row: 0, col: SPAWN_COL[kind] };
}

export function tryMove(board: Board, active: ActivePiece, drow: number, dcol: number): ActivePiece | null {
  const next = { ...active, row: active.row + drow, col: active.col + dcol };
  return collides(board, next.kind, next.rot, next.row, next.col) ? null : next;
}

export function tryRotate(board: Board, active: ActivePiece, dir: 1 | -1): ActivePiece | null {
  const rot = (active.rot + dir + 4) % 4;
  for (const kick of kickOffsets()) {
    const row = active.row + kick.row;
    const col = active.col + kick.col;
    if (!collides(board, active.kind, rot, row, col)) return { ...active, rot, row, col };
  }
  return null;
}

export function dropRow(board: Board, active: ActivePiece): number {
  let row = active.row;
  while (!collides(board, active.kind, active.rot, row + 1, active.col)) row++;
  return row;
}

export function lockPiece(board: Board, active: ActivePiece): { board: Board; lockedOut: boolean } {
  const next = board.map(line => line.slice());
  let lockedOut = false;
  for (const cell of cellsFor(active.kind, active.rot)) {
    const r = active.row + cell.row;
    const c = active.col + cell.col;
    if (r < 0) { lockedOut = true; continue; }
    next[r]![c] = COLOR[active.kind];
  }
  return { board: next, lockedOut };
}

export function clearLines(board: Board): { board: Board; cleared: number; rows: number[] } {
  const rows: number[] = [];
  const kept = board.filter((line, index) => {
    if (line.some(cell => cell === EMPTY)) return true;
    rows.push(index);
    return false;
  });
  const cleared = ROWS - kept.length;
  const fresh = Array.from({ length: cleared }, () => new Array<number>(COLS).fill(EMPTY));
  return { board: [...fresh, ...kept], cleared, rows };
}

export interface SpawnResult {
  active: ActivePiece;
  queue: PieceKind[];
  gameOver: boolean;
}

export function drawSpawn(board: Board, queue: PieceKind[], rng: Rng): SpawnResult {
  const { kind, queue: rest } = takeFromQueue(queue, rng);
  const active = spawnFor(kind);
  return { active, queue: rest, gameOver: collides(board, kind, 0, active.row, active.col) };
}

export function serialize(board: Board, active: ActivePiece, queue: PieceKind[], score: number, lines: number, level: number): SavedGame {
  return { version: 1, board: board.map(line => line.slice()), active: { ...active }, queue: queue.slice(), score, lines, level };
}

const KINDS_SET = new Set<string>(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

const isKind = (value: unknown): value is PieceKind => typeof value === 'string' && KINDS_SET.has(value);

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

export function deserialize(data: unknown): { board: Board; active: ActivePiece; queue: PieceKind[]; score: number; lines: number; level: number } | null {
  if (!data || typeof data !== 'object') return null;
  const saved = data as Partial<SavedGame>;
  if (saved.version !== 1 || !Array.isArray(saved.board) || saved.board.length !== ROWS) return null;
  const board: Board = [];
  for (const line of saved.board) {
    if (!Array.isArray(line) || line.length !== COLS) return null;
    if (!line.every(cell => isInt(cell) && cell >= 0 && cell <= 7)) return null;
    board.push(line.slice());
  }
  const piece = saved.active;
  if (!piece || typeof piece !== 'object' || !isKind(piece.kind)) return null;
  if (!isInt(piece.rot) || piece.rot < 0 || piece.rot > 3) return null;
  if (!isInt(piece.row) || !isInt(piece.col)) return null;
  if (!Array.isArray(saved.queue) || !saved.queue.every(isKind)) return null;
  if (typeof saved.score !== 'number' || !Number.isFinite(saved.score) || saved.score < 0) return null;
  if (!isInt(saved.lines) || saved.lines < 0 || !isInt(saved.level) || saved.level < 0) return null;
  if (collides(board, piece.kind, piece.rot, piece.row, piece.col)) return null;
  return { board, active: { kind: piece.kind, rot: piece.rot, row: piece.row, col: piece.col }, queue: saved.queue.slice(), score: Math.floor(saved.score), lines: saved.lines, level: saved.level };
}
