export const ROWS = 3;
export const COLS = 3;
export const CELLS = ROWS * COLS;

export type Player = 0 | 1;
export type Cell = Player | null;
export type Phase = 'playing' | 'won' | 'draw';

export type GameState = {
  board: Cell[];
  turn: Player;
  phase: Phase;
  winner: Player | null;
  winningCells: number[];
  lastMove: number | null;
};

const LINES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const other = (player: Player): Player => (player === 0 ? 1 : 0);

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

export function validMoves(board: readonly Cell[]): number[] {
  const moves: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === null) moves.push(i);
  return moves;
}

/** The winning line through `index` for `player`, or [] when it is not a win. */
export function winningLine(board: readonly Cell[], index: number, player: Player): number[] {
  for (const line of LINES) {
    if (!line.includes(index)) continue;
    if (line.every(cell => board[cell] === player)) return [...line];
  }
  return [];
}

export function wouldWin(board: readonly Cell[], index: number, player: Player): boolean {
  if (board[index] !== null) return false;
  const filled = [...board];
  filled[index] = player;
  return winningLine(filled, index, player).length > 0;
}

export function applyMove(state: GameState, index: number): GameState {
  if (state.phase !== 'playing') throw new Error('This game is already over.');
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) throw new Error('Choose a cell index from 0 to 8.');
  if (state.board[index] !== null) throw new Error('That cell is already taken.');

  const next = structuredClone(state);
  next.board[index] = next.turn;
  next.lastMove = index;

  const line = winningLine(next.board, index, next.turn);
  if (line.length) {
    next.phase = 'won';
    next.winner = next.turn;
    next.winningCells = line;
  } else if (validMoves(next.board).length === 0) {
    next.phase = 'draw';
  } else {
    next.turn = other(next.turn);
  }
  return next;
}