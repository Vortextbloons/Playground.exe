import { validMoves, wouldWin, other, type Cell, type GameState, type Player } from './rules/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

const EASY_SMART = 0.25;
const MOVE_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7] as const;

export function chooseMove(state: GameState, difficulty: Difficulty, rng: () => number): number {
  const moves = validMoves(state.board);
  if (moves.length === 0) throw new Error('There are no moves left.');

  if (difficulty === 'easy') {
    if (rng() < EASY_SMART) {
      const tactical = tacticalMove(state.board, state.turn);
      if (tactical !== null) return tactical;
    }
    return moves[Math.floor(rng() * moves.length)]!;
  }

  if (difficulty === 'medium') {
    const tactical = tacticalMove(state.board, state.turn);
    if (tactical !== null) return tactical;
    return moves[Math.floor(rng() * moves.length)]!;
  }

  return hardMove(state.board, state.turn);
}

function tacticalMove(board: readonly Cell[], player: Player): number | null {
  const moves = validMoves(board);
  const wins = moves.filter(index => wouldWin(board, index, player));
  if (wins.length) return wins[Math.floor(Math.random() * wins.length)]!;
  const blocks = moves.filter(index => wouldWin(board, index, other(player)));
  if (blocks.length) return blocks[Math.floor(Math.random() * blocks.length)]!;
  return null;
}

function hardMove(board: readonly Cell[], player: Player): number {
  let best = -Infinity;
  let bestMove = -1;
  for (const index of MOVE_ORDER) {
    if (!validMoves(board).includes(index)) continue;
    const filled = [...board];
    filled[index] = player;
    const score = winningLineScore(filled, index, player)
      ? 10
      : -negamax(filled, other(player), 1);
    if (score > best) {
      best = score;
      bestMove = index;
    }
  }
  if (bestMove === -1) throw new Error('There are no moves left.');
  return bestMove;
}

function winningLineScore(board: readonly Cell[], index: number, player: Player): boolean {
  // inline check via engine import avoided; recompute minimal
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  return LINES.some(line => line.includes(index) && line.every(cell => board[cell] === player));
}

function negamax(board: Cell[], player: Player, depth: number): number {
  const moves = validMoves(board);
  if (moves.length === 0) return 0;

  let best = -Infinity;
  for (const index of MOVE_ORDER) {
    if (!moves.includes(index)) continue;
    const filled = [...board];
    filled[index] = player;
    let score: number;
    if (winningLineScore(filled, index, player)) {
      score = 10 - depth;
    } else {
      score = -negamax(filled, other(player), depth + 1);
    }
    if (score > best) best = score;
  }
  return best;
}