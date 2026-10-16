import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELLS,
  COLS,
  ROWS,
  applyDrop,
  cellIndex,
  landingRow,
  newGame,
  validColumns,
  winningLine,
  wouldWin,
  type Cell,
  type GameState,
  type Player,
} from '../games/connect-four/src/rules/engine.ts';
import { chooseMove, type Difficulty } from '../games/connect-four/src/ai/ai.ts';
import { mulberry32 } from '../games/connect-four/src/rules/rng.ts';
import definition from '../games/connect-four/src/multiplayer.ts';
import type { Json, MultiplayerMode } from '../packages/game-kit/src/multiplayer/protocol.ts';

/** Builds a board from top-to-bottom rows: 'r' red, 'y' yellow, '.' empty. */
function fromRows(rows: string[], turn: Player = 0): GameState {
  const board: Cell[] = [];
  for (const row of rows) {
    for (const symbol of row) board.push(symbol === 'r' ? 0 : symbol === 'y' ? 1 : null);
  }
  assert.equal(board.length, CELLS);
  return { board, turn, phase: 'playing', winner: null, winningCells: [], lastMove: null };
}

function play(cols: readonly number[], start = newGame()): GameState {
  return cols.reduce((state, col) => applyDrop(state, col), start);
}

function acceptsEveryColumn(state: GameState, difficulty: Difficulty, label: string): void {
  const columns = validColumns(state.board);
  const col = chooseMove(state, difficulty, mulberry32(12345));
  assert.ok(columns.includes(col), `${label}: ${difficulty} picked ${col}, open columns are ${columns.join(',')}`);
}

// ------------------------------------------------------------------ the board

test('a new game is an empty board with red to move', () => {
  const state = newGame();
  assert.equal(state.board.length, CELLS);
  assert.ok(state.board.every(cell => cell === null));
  assert.equal(state.turn, 0);
  assert.equal(state.phase, 'playing');
  assert.equal(state.winner, null);
  assert.equal(state.lastMove, null);
});

test('discs land in the lowest empty row and stack upwards', () => {
  const once = applyDrop(newGame(), 3);
  assert.equal(once.board[cellIndex(ROWS - 1, 3)], 0);
  assert.equal(once.lastMove, cellIndex(ROWS - 1, 3));
  assert.equal(once.turn, 1);

  const twice = play([3, 3]);
  assert.equal(twice.board[cellIndex(ROWS - 2, 3)], 1);
  assert.equal(landingRow(twice.board, 3), ROWS - 3);
});

test('illegal drops are rejected', () => {
  const state = newGame();
  assert.throws(() => applyDrop(state, -1), /column/i);
  assert.throws(() => applyDrop(state, COLS), /column/i);
  assert.throws(() => applyDrop(state, 1.5), /column/i);

  const full = play([0, 0, 0, 0, 0, 0]);
  assert.throws(() => applyDrop(full, 0), /full/i);
});

test('a move after the game ends is rejected', () => {
  const won = play([0, 0, 1, 1, 2, 2, 3]);
  assert.equal(won.phase, 'won');
  assert.throws(() => applyDrop(won, 6), /over/i);
});

// ------------------------------------------------------------------- winning

test('four in a row wins horizontally', () => {
  const state = play([0, 0, 1, 1, 2, 2, 3]);
  assert.equal(state.phase, 'won');
  assert.equal(state.winner, 0);
  assert.deepEqual(state.winningCells, [cellIndex(5, 0), cellIndex(5, 1), cellIndex(5, 2), cellIndex(5, 3)]);
});

test('four in a row wins vertically', () => {
  const state = play([0, 1, 0, 1, 0, 1, 0]);
  assert.equal(state.phase, 'won');
  assert.equal(state.winner, 0);
  assert.deepEqual(state.winningCells, [cellIndex(2, 0), cellIndex(3, 0), cellIndex(4, 0), cellIndex(5, 0)]);
});

test('the winning run is found on both diagonals', () => {
  const ascending = fromRows([
    '.......',
    '.......',
    '...r...',
    '..r....',
    '.r.....',
    'r......',
  ]);
  assert.deepEqual(winningLine(ascending.board, cellIndex(5, 0), 0), [cellIndex(2, 3), cellIndex(3, 2), cellIndex(4, 1), cellIndex(5, 0)]);

  const descending = fromRows([
    '.......',
    '.......',
    '..r....',
    '...r...',
    '....r..',
    '.....r.',
  ]);
  assert.deepEqual(winningLine(descending.board, cellIndex(3, 3), 0), [cellIndex(2, 2), cellIndex(3, 3), cellIndex(4, 4), cellIndex(5, 5)]);
});

test('a run longer than four is reported in full', () => {
  const state = fromRows([
    '.......',
    '.......',
    '.......',
    '.......',
    'rrrrrrr',
    '.......',
  ]);
  assert.equal(winningLine(state.board, cellIndex(4, 3), 0).length, 7);
});

test('a full board without a run is a draw', () => {
  const board: Cell[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) board.push(((row + 2 * col) % 4 < 2 ? 0 : 1) as Player);
  }
  for (let index = 0; index < CELLS; index++) {
    const cell = board[index] ?? null;
    if (cell !== null) assert.equal(winningLine(board, index, cell).length, 0, `unexpected run at ${index}`);
  }
  const hole = cellIndex(0, 3);
  const turn = board[hole]!;
  board[hole] = null;
  const state: GameState = { board, turn, phase: 'playing', winner: null, winningCells: [], lastMove: null };
  const next = applyDrop(state, 3);
  assert.equal(next.phase, 'draw');
  assert.equal(next.winner, null);
  assert.equal(validColumns(next.board).length, 0);
});

test('wouldWin sees a threat the player could complete', () => {
  const state = fromRows([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    'rrr....',
  ], 0);
  assert.equal(wouldWin(state.board, 3, 0), true);
  assert.equal(wouldWin(state.board, 2, 0), false);
  assert.equal(wouldWin(state.board, 3, 1), false);
});

// ------------------------------------------------------------------ the AI

test('every difficulty always answers with an open column', () => {
  const rng = mulberry32(7);
  for (let match = 0; match < 25; match++) {
    let state = newGame();
    while (state.phase === 'playing') {
      acceptsEveryColumn(state, 'easy', `match ${match}`);
      acceptsEveryColumn(state, 'medium', `match ${match}`);
      const columns = validColumns(state.board);
      state = applyDrop(state, columns[Math.floor(rng() * columns.length)]!);
    }
  }
});

test('hard always answers with an open column too', () => {
  const rng = mulberry32(11);
  let checks = 0;
  for (let match = 0; match < 8 && checks < 24; match++) {
    let state = newGame();
    let ply = 0;
    while (state.phase === 'playing') {
      if (ply % 3 === 0 && checks < 24) {
        acceptsEveryColumn(state, 'hard', `match ${match} ply ${ply}`);
        checks++;
      }
      const columns = validColumns(state.board);
      state = applyDrop(state, columns[Math.floor(rng() * columns.length)]!);
      ply++;
    }
  }
  assert.equal(checks, 24);
});

test('medium and hard take an immediate win', () => {
  const state = fromRows([
    '.......',
    '.......',
    '.......',
    '......y',
    '......y',
    '......y',
  ], 1);
  assert.equal(chooseMove(state, 'medium', mulberry32(1)), 6);
  assert.equal(chooseMove(state, 'hard', mulberry32(1)), 6);
});

test('hard takes the win when a win and a block are both available', () => {
  const state = fromRows([
    '.......',
    '.......',
    '.......',
    '......y',
    '......y',
    'rrr...y',
  ], 0);
  assert.equal(chooseMove(state, 'hard', mulberry32(2)), 3);
});

test('medium and hard block an immediate loss', () => {
  const state = fromRows([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    'rrr....',
  ], 1);
  assert.equal(chooseMove(state, 'medium', mulberry32(3)), 3);
  assert.equal(chooseMove(state, 'hard', mulberry32(3)), 3);
});

test('easy is usually random and only sometimes tactical', () => {
  const state = fromRows([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    'yyy....',
  ], 0);
  let blocks = 0;
  for (let seed = 0; seed < 200; seed++) {
    if (chooseMove(state, 'easy', mulberry32(seed)) === 3) blocks++;
  }
  assert.ok(blocks > 40, `easy blocked ${blocks}/200 times, expected more than a purely random baseline`);
  assert.ok(blocks < 140, `easy blocked ${blocks}/200 times, expected to stay mostly random`);
});

test('hard is deterministic for the same position', () => {
  const state = play([3, 3, 4, 2, 5]);
  assert.equal(chooseMove(state, 'hard', mulberry32(1)), chooseMove(state, 'hard', mulberry32(99)));
});

// ------------------------------------------------------------ party adapter

const MODE: MultiplayerMode = { id: 'duel', label: 'Duel', minPlayers: 2, maxPlayers: 2, preset: 'turn-based', spectators: true };
const A = 'player-a';
const B = 'player-b';

function context(playerId: string, seed = 0) {
  return { playerId, playerIds: [A, B], mode: MODE, now: 0, seed };
}

function start(seed = 0): { state: Json; red: string; yellow: string } {
  const { state } = definition.setup(context(A, seed));
  const players = (state as { players: [string, string] }).players;
  return { state, red: players[0], yellow: players[1] };
}

test('setup seats two players and assigns colours from the match seed', () => {
  const zero = start(0);
  assert.deepEqual([zero.red, zero.yellow], [A, B]);
  const one = start(1);
  assert.deepEqual([one.red, one.yellow], [B, A]);
  assert.throws(() => definition.setup({ playerId: A, playerIds: [A, A], mode: MODE, now: 0, seed: 0 }), /two players/i);
});

test('the server rejects out-of-turn, spectator and malformed drops', () => {
  const { state, red, yellow } = start(0);
  assert.throws(() => definition.action(state, 'drop', 3, context(yellow)), /turn/i);
  assert.throws(() => definition.action(state, 'drop', 3, context('nobody')), /two players/i);
  assert.throws(() => definition.action(state, 'drop', 7, context(red)), /column/i);
  assert.throws(() => definition.action(state, 'drop', 1.5, context(red)), /column/i);
  assert.throws(() => definition.action(state, 'drop', 'three' as unknown as never, context(red)), /column/i);
  assert.throws(() => definition.action(state, 'nudge', 3, context(red)), /unknown/i);
});

test('accepted drops advance the turn and the board', () => {
  const { state, red, yellow } = start(0);
  const first = definition.action(state, 'drop', 3, context(red));
  const board = (first.state as { game: GameState }).game.board;
  assert.equal(board[cellIndex(ROWS - 1, 3)], 0);
  assert.equal((first.state as { game: GameState }).game.turn, 1);
  assert.equal(first.finished, false);

  const second = definition.action(first.state, 'drop', 3, context(yellow));
  assert.equal((second.state as { game: GameState }).game.board[cellIndex(ROWS - 2, 3)], 1);
  assert.equal((second.state as { game: GameState }).game.turn, 0);
});

test('the server stops the match on a win', () => {
  const { state, red, yellow } = start(0);
  let current: Json = state;
  const moves: [string, number][] = [[red, 0], [yellow, 0], [red, 1], [yellow, 1], [red, 2], [yellow, 2]];
  for (const [id, col] of moves) current = definition.action(current, 'drop', col, context(id)).state;
  const win = definition.action(current, 'drop', 3, context(red));
  assert.equal(win.finished, true);
  assert.equal(win.phase, 'finished');
  const game = (win.state as { game: GameState }).game;
  assert.equal(game.phase, 'won');
  assert.equal(game.winner, 0);
  assert.throws(() => definition.action(win.state, 'drop', 4, context(yellow)), /over/i);
});

test('the survivor wins when a player leaves for good', () => {
  const { state } = start(0);
  const held = definition.playersChanged!(state, { ...context(''), playerIds: [A, B] });
  assert.equal(held.finished, undefined);

  const forfeit = definition.playersChanged!(state, { ...context(''), playerIds: [A] });
  assert.equal(forfeit.finished, true);
  assert.equal((forfeit.state as { game: GameState }).game.winner, 0, 'the red seat survives');

  const abandoned = definition.playersChanged!(state, { ...context(''), playerIds: [] });
  assert.equal(abandoned.finished, true);
  assert.equal((abandoned.state as { game: GameState }).game.winner, null);
});

test('the spectator view is the public board', () => {
  const { state, red } = start(0);
  const next = definition.action(state, 'drop', 4, context(red)).state;
  const view = definition.view(next) as { game: GameState; players: string[] };
  assert.equal(view.game.board.length, CELLS);
  assert.equal(view.game.board[cellIndex(ROWS - 1, 4)], 0);
  assert.deepEqual(view.players, [A, B]);
});
