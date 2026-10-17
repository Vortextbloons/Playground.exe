import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, EMPTY, ROWS, type Board, type Rng } from '../games/tetris/src/engine/types.ts';
import { cellsFor, COLOR, KINDS, shuffledBag, takeFromQueue } from '../games/tetris/src/engine/pieces.ts';
import {
  clearLines, collides, createBoard, deserialize, drawSpawn, dropRow,
  gravityInterval, levelFor, lockPiece, scoreForLines, serialize,
  spawnFor, tryMove, tryRotate,
} from '../games/tetris/src/engine/game.ts';

const rngFrom = (seed: number): Rng => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const key = (cells: { row: number; col: number }[]) =>
  cells.map(cell => `${cell.row},${cell.col}`).sort().join('|');

test('rotating four times returns every piece to its spawn shape', () => {
  for (const kind of KINDS) {
    const start = key(cellsFor(kind, 0));
    let cells = cellsFor(kind, 0);
    for (let i = 1; i <= 4; i++) cells = cellsFor(kind, i);
    assert.equal(key(cells), start, `${kind} completes a full turn`);
  }
});

test('counter-clockwise is the inverse of clockwise', () => {
  for (const kind of KINDS) {
    assert.equal(key(cellsFor(kind, 3)), key(cellsFor(kind, -1)), `${kind} ccw matches rot 3`);
  }
});

test('wall kick lets a blocked rotation fit', () => {
  const board = createBoard();
  const active = { kind: 'I' as const, rot: 1, row: 0, col: 7 };
  assert.equal(collides(board, 'I', 2, 0, 7), true, 'horizontal spin overflows the right wall');
  const kicked = tryRotate(board, active, 1);
  assert.ok(kicked, 'kick finds room');
  assert.equal(kicked.rot, 2);
  assert.equal(collides(board, 'I', kicked.rot, kicked.row, kicked.col), false);
});

test('movement is blocked by walls, floor and settled blocks', () => {
  const board = createBoard();
  const left = spawnFor('O');
  const edge = { ...left, col: 0 };
  assert.equal(tryMove(board, edge, 0, -1), null, 'left wall blocks');
  const floor = { ...left, row: ROWS - 2 };
  assert.equal(tryMove(board, floor, 1, 0), null, 'floor blocks');
  board[1]![5] = 2;
  assert.equal(tryMove(board, spawnFor('O'), 1, 1), null, 'settled block blocks');
});

test('clearing full rows collapses the rows above', () => {
  const board = createBoard();
  for (let c = 0; c < COLS; c++) board[ROWS - 1]![c] = 4;
  for (let c = 0; c < COLS; c++) board[ROWS - 2]![c] = 4;
  board[ROWS - 3]![0] = 2;
  const result = clearLines(board);
  assert.equal(result.cleared, 2);
  assert.deepEqual(result.rows, [ROWS - 2, ROWS - 1]);
  assert.equal(result.board[ROWS - 1]![0], 2, 'rows above fall down');
  assert.equal(result.board[ROWS - 1]!.filter(cell => cell !== EMPTY).length, 1);
});

test('scoring rewards four-line clears and higher levels', () => {
  assert.equal(scoreForLines(1, 0), 100);
  assert.equal(scoreForLines(4, 0), 800);
  assert.equal(scoreForLines(4, 2), 2400);
  assert.equal(levelFor(9), 0);
  assert.equal(levelFor(10), 1);
  assert.ok(gravityInterval(5) < gravityInterval(0), 'gravity speeds up');
});

test('seven-bag deals every piece before repeating', () => {
  const rng = rngFrom(3);
  const bag = shuffledBag(rng);
  assert.deepEqual([...bag].sort(), [...KINDS].sort());
  const first = takeFromQueue([], rng);
  assert.ok(KINDS.includes(first.kind));
  assert.ok(first.queue.length >= 6, 'queue refills from a fresh bag');
});

test('spawn on a full board reports game over', () => {
  const board = createBoard().map(line => line.map(() => 1));
  const result = drawSpawn(board, [], rngFrom(9));
  assert.equal(result.gameOver, true);
  const empty = drawSpawn(createBoard(), [], rngFrom(9));
  assert.equal(empty.gameOver, false);
});

test('locking writes piece colors and the ghost lands on the stack', () => {
  const board = createBoard();
  const active = { kind: 'O' as const, rot: 0, row: ROWS - 2, col: 4 };
  const locked = lockPiece(board, active);
  assert.equal(locked.board[ROWS - 1]![4], COLOR.O);
  assert.equal(locked.lockedOut, false);
  assert.equal(board[ROWS - 1]![4], EMPTY, 'source board untouched');
  const falling = spawnFor('I');
  assert.equal(dropRow(board, falling) > falling.row, true);
  const restRow = dropRow(locked.board, { kind: 'O' as const, rot: 0, row: 0, col: 4 });
  assert.equal(restRow, ROWS - 4, 'ghost rests on the locked piece');
});

test('save data round-trips and rejects corrupt saves', () => {
  const board = createBoard();
  board[ROWS - 1]![0] = 1;
  const saved = serialize(board, spawnFor('T'), ['I', 'O'], 300, 4, 0);
  const restored = deserialize(JSON.parse(JSON.stringify(saved)));
  assert.ok(restored);
  assert.equal(restored.score, 300);
  assert.equal(restored.lines, 4);
  assert.equal(restored.board[ROWS - 1]![0], 1);
  assert.equal(deserialize(null), null);
  assert.equal(deserialize({ ...saved, board: [[1]] }), null);
  assert.equal(deserialize({ ...saved, queue: ['X'] }), null);
});
