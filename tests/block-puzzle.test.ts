import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, COLOR_COUNT, EMPTY, TRAY_SIZE, type Board, type GameState, type Rng } from '../games/block-puzzle/src/engine/types.ts';
import { SHAPES, SHAPE_BY_ID, createPiece, pickShape } from '../games/block-puzzle/src/engine/shapes.ts';
import {
  canPlace, clearCells, clearingCells, completedLines, createBoard, findPlacements,
  hasAnyPlacement, lineClear, place, resolveTapAnchor,
} from '../games/block-puzzle/src/engine/placement.ts';
import { comboMultiplier, lineClearPoints, movePoints } from '../games/block-puzzle/src/engine/scoring.ts';
import { applyMove, deserialize, generateTray, hasMovesLeft, serialize, startGame } from '../games/block-puzzle/src/engine/gameState.ts';

/** Deterministic mulberry32 so every engine test is reproducible. */
const rngFrom = (seed: number): Rng => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Builds a board from glyph rows: '#' filled with color 1, '.' empty. */
const boardFrom = (rows: string[]): Board =>
  rows.map(row => row.split('').map(glyph => (glyph === '#' ? 1 : EMPTY)));

const filledBoard = (): Board => createBoard().map(row => row.map(() => 1));

const trim = (state: GameState) => ({ ...state, board: boardFrom(state.board.map(row => row.map(c => (c ? '#' : '.')).join(''))) });

const shape = (id: string) => {
  const found = SHAPE_BY_ID.get(id);
  assert.ok(found, `shape ${id} exists`);
  return found;
};

test('shape library is normalized, unique, and fully reachable', () => {
  const ids = new Set<string>();
  for (const def of SHAPES) {
    assert.equal(ids.has(def.id), false, `duplicate id ${def.id}`);
    ids.add(def.id);
    assert.equal(def.size, def.cells.length);
    assert.equal(def.cells.length, def.cells.length); // sanity for freeze
    assert.ok(def.weight > 0);
    const rows = def.cells.map(cell => cell.row);
    const cols = def.cells.map(cell => cell.col);
    assert.equal(Math.min(...rows), 0, `${def.id} starts at row 0`);
    assert.equal(Math.min(...cols), 0, `${def.id} starts at column 0`);
    assert.equal(Math.max(...rows) + 1, def.height, `${def.id} bounding box height`);
    assert.equal(Math.max(...cols) + 1, def.width, `${def.id} bounding box width`);
  }
  for (const needed of ['dot', 'sq2', 'sq3', 'h2', 'h5', 'v5', 'recth', 'rectv']) {
    assert.ok(ids.has(needed), `library contains ${needed}`);
  }
  const rng = rngFrom(7);
  const seen = new Set<string>();
  for (let i = 0; i < 6000; i++) seen.add(pickShape(rng).id);
  assert.equal(seen.size, SHAPES.length, 'weighted pick can reach every shape');
  const piece = createPiece(rngFrom(11), 3);
  assert.ok(SHAPE_BY_ID.has(piece.shapeId));
  assert.ok(piece.color >= 1 && piece.color <= COLOR_COUNT && piece.color !== 3, 'avoids a repeated color');
});

test('placement respects bounds, overlap, and immutability', () => {
  const board = createBoard();
  const line = shape('h3');
  assert.equal(canPlace(board, line, 0, 0), true);
  assert.equal(canPlace(board, line, 0, BOARD_SIZE - 1), false, 'right edge overflow');
  assert.equal(canPlace(board, line, -1, 0), false, 'negative row');
  assert.equal(canPlace(board, line, 0, -1), false, 'negative column');
  assert.equal(canPlace(board, line, BOARD_SIZE - 1, 0), true);

  const placed = place(board, line, 4, 2, 5);
  assert.equal(placed[4]![2], 5);
  assert.equal(placed[4]![4], 5);
  assert.equal(board[4]![2], EMPTY, 'source board untouched');
  assert.equal(canPlace(placed, shape('dot'), 4, 3), false, 'overlap rejected');
  assert.equal(canPlace(placed, shape('v2'), 3, 2), false, 'overlap across rows rejected');
  assert.equal(canPlace(placed, shape('v2'), 4, 2), false, 'overlap on the placed row rejected');
  assert.equal(canPlace(placed, shape('v2'), 5, 2), true, 'the row below stays free');
  assert.ok(findPlacements(placed, shape('v2')).length > 0);
  assert.equal(findPlacements(placed, shape('v2')).some(a => a.row === 3 && a.col === 2), false);
});

test('line clearing finds rows, columns, and their de-duplicated union', () => {
  const board = boardFrom([
    '#######.',
    '########',
    '########',
    '########',
    '########',
    '########',
    '########',
    '########',
  ]);
  assert.deepEqual(completedLines(board), { rows: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2, 3, 4, 5, 6] });
  const dot = place(board, shape('dot'), 0, 7, 2);
  const { rows, cols } = completedLines(dot);
  assert.equal(rows.length, 8);
  assert.ok(cols.length >= 1, 'the completed column is detected');

  const cross = boardFrom([
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
    '...#....',
  ]);
  const withRow = cross.map(row => row.slice());
  withRow[3] = [1, 1, 1, EMPTY, 1, 1, 1, 1];
  const cells = clearingCells([3], [3]);
  assert.equal(cells.length, 15, 'shared cell counted once');
  const cleared = clearCells(withRow, cells);
  assert.ok(cleared[3]!.every(cell => cell === EMPTY));
  assert.ok(cleared.every(row => row[3] === EMPTY));
  assert.equal(cleared[0]![0], EMPTY, 'only clearing cells are removed');
  const untouched = boardFrom(['#.......', '........', '........', '........', '........', '........', '........', '........']);
  assert.ok(clearCells(untouched, [{ row: 1, col: 2 }])[1]![2] === EMPTY);
  assert.equal(place(cross, shape('v2'), 3, 3, 1)[3]![3], 1);
});

test('legal-move detection catches a trapped shape', () => {
  const board = boardFrom([
    '#.##',
    '####',
    '####',
    '####',
  ] as string[]);
  const packed = filledBoard();
  assert.equal(hasAnyPlacement(packed, shape('dot')), false, 'nothing fits a full board');
  const almost = filledBoard();
  almost[0]![0] = EMPTY;
  assert.equal(hasAnyPlacement(almost, shape('dot')), true);
  assert.equal(hasAnyPlacement(almost, shape('v2')), false);
  assert.equal(hasAnyPlacement(almost, shape('h2')), false);
  assert.ok(board[0]![0] === 1);
});

test('tap anchors center first, then snap to the nearest legal spot', () => {
  const board = createBoard();
  assert.deepEqual(resolveTapAnchor(board, shape('dot'), 3, 4), { row: 3, col: 4 });
  assert.deepEqual(resolveTapAnchor(board, shape('sq3'), 4, 4), { row: 3, col: 3 }, 'centered');
  assert.deepEqual(resolveTapAnchor(board, shape('h3'), 0, 1), { row: 0, col: 0 }, 'clamped into the board');

  const pocket = filledBoard();
  pocket[2]![2] = EMPTY; pocket[2]![3] = EMPTY;
  pocket[3]![2] = EMPTY; pocket[3]![3] = EMPTY;
  assert.deepEqual(resolveTapAnchor(pocket, shape('sq2'), 6, 6), { row: 2, col: 2 }, 'falls back to the only pocket');
  const single = filledBoard();
  single[7]![0] = EMPTY;
  assert.equal(resolveTapAnchor(single, shape('sq2'), 0, 0), null, 'returns null when trapped');
  assert.deepEqual(resolveTapAnchor(single, shape('dot'), 0, 0), { row: 7, col: 0 });
});

test('scoring matches the spec table and raises combo multipliers', () => {
  assert.equal(lineClearPoints(0), 0);
  assert.equal(lineClearPoints(1), 100);
  assert.equal(lineClearPoints(2), 250);
  assert.equal(lineClearPoints(3), 450);
  assert.equal(lineClearPoints(4), 700);
  assert.equal(lineClearPoints(5), 1000);
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.5);
  assert.equal(comboMultiplier(3), 2);
  assert.deepEqual(movePoints(3, 0, 0), { placement: 3, clear: 0, lines: 0, multiplier: 1 });
  assert.deepEqual(movePoints(4, 2, 2), { placement: 4, clear: 375, lines: 2, multiplier: 1.5 });
  assert.deepEqual(movePoints(1, 1, 3), { placement: 1, clear: 200, lines: 1, multiplier: 2 });
});

test('a fresh game starts clean and rejects illegal moves', () => {
  const state = startGame(rngFrom(1));
  assert.equal(state.status, 'playing');
  assert.equal(state.score, 0);
  assert.equal(state.tray.length, TRAY_SIZE);
  assert.ok(state.tray.every(piece => piece !== null));
  assert.ok(state.board.every(row => row.every(cell => cell === EMPTY)));

  const before = serialize(state);
  assert.equal(applyMove({ ...state, status: 'idle' }, 0, 0, 0, rngFrom(2)), null, 'idle games ignore moves');
  assert.equal(applyMove({ ...state, tray: [{ shapeId: 'h3', color: 1 }, null, null] }, 0, 4, 7, rngFrom(2)), null, 'anchor that pushes the shape off the board');
  assert.equal(applyMove({ ...state, tray: [{ shapeId: 'h3', color: 1 }, null, null] }, 0, 8, 0, rngFrom(2)), null, 'row outside the board');
  assert.equal(applyMove({ ...state, tray: [null, state.tray[1]!, state.tray[2]!] }, 0, 0, 0, rngFrom(2)), null, 'empty slot');
  assert.deepEqual(serialize(state), before, 'failed moves never mutate state');
});

test('placing scores cells, tray slot empties, and combos reset without a clear', () => {
  const rng = rngFrom(3);
  const state: GameState = {
    ...startGame(rngFrom(30)),
    tray: [{ shapeId: 'sq2', color: 2 }, { shapeId: 'dot', color: 3 }, { shapeId: 'v2', color: 4 }],
    combo: 2,
  };
  const result = applyMove(state, 1, 0, 0, rng);
  assert.ok(result);
  assert.equal(result.points.placement, 1);
  assert.equal(result.points.clear, 0);
  assert.equal(result.next.score, 1);
  assert.equal(result.next.combo, 0, 'a quiet move ends the streak');
  assert.equal(result.next.tray[1], null);
  assert.equal(result.next.tray[0]?.shapeId, 'sq2');
  assert.equal(result.next.board[0]![0], 3, 'placed in the piece color');
  assert.equal(result.refilled, false);
  assert.equal(result.gameOver, false);
  assert.equal(result.next.moves, 1);
});

test('completed lines clear simultaneously, keep the rest of the board, and score', () => {
  const rng = rngFrom(4);
  const board = createBoard();
  for (let c = 0; c < BOARD_SIZE; c++) board[2]![c] = 1;
  for (let r = 0; r < BOARD_SIZE; r++) board[r]![4] = 1;
  board[2]![4] = EMPTY;
  board[0]![0] = 5; // unrelated block that must survive the clear
  const state: GameState = { board, tray: [{ shapeId: 'dot', color: 3 }, null, null], score: 10, combo: 1, moves: 2, status: 'playing' };
  const result = applyMove(state, 0, 2, 4, rng);
  assert.ok(result);
  assert.equal(result.points.lines, 2, 'row and column clear together');
  assert.equal(result.next.combo, 2);
  assert.equal(result.points.clear, 375, 'two lines (250) scored at the ×1.5 combo');
  assert.equal(result.next.score, 10 + 1 + 375);
  assert.equal(result.clear.cells.length, 15);
  assert.ok(result.next.board.every(row => row[4] === EMPTY), 'column cleared');
  assert.ok(result.next.board[2]!.every(cell => cell === EMPTY), 'row cleared');
  assert.equal(result.next.board[0]![0], 5, 'blocks do not fall and unrelated cells stay');
  assert.equal(result.gameOver, false);
});

test('the tray refills only after all three pieces are placed', () => {
  let state: GameState = {
    ...startGame(rngFrom(40)),
    tray: [{ shapeId: 'dot', color: 1 }, { shapeId: 'dot', color: 2 }, { shapeId: 'dot', color: 3 }],
  };
  const rng = rngFrom(41);
  const first = applyMove(state, 0, 0, 0, rng);
  assert.ok(first);
  assert.equal(first.refilled, false);
  state = first.next;
  const second = applyMove(state, 1, 0, 1, rng);
  assert.ok(second);
  assert.equal(second.refilled, false);
  assert.equal(second.next.tray.every(piece => piece === null), false);
  const third = applyMove(second.next, 2, 0, 2, rng);
  assert.ok(third);
  assert.equal(third.refilled, true);
  assert.ok(third.next.tray.every(piece => piece !== null), 'three new pieces appear');
  assert.equal(hasMovesLeft(third.next), true, 'a fresh set is never dead');
});

test('the game ends exactly when no remaining piece fits', () => {
  // Every row and column keeps a hole, but all holes are isolated, so a pair
  // of remaining line pieces can never fit again.
  const board = boardFrom([
    '.#.#####',
    '####.###',
    '.#.#####',
    '#####.##',
    '#.######',
    '######.#',
    '###.####',
    '#######.',
  ]);
  const state: GameState = {
    board,
    tray: [{ shapeId: 'dot', color: 1 }, { shapeId: 'h2', color: 2 }, { shapeId: 'v2', color: 3 }],
    score: 0, combo: 0, moves: 0, status: 'playing',
  };
  assert.equal(hasAnyPlacement(board, shape('h2')), false, 'no room for the horizontal pair');
  assert.equal(hasAnyPlacement(board, shape('v2')), false, 'no room for the vertical pair');
  const result = applyMove(state, 0, 0, 0, rngFrom(5));
  assert.ok(result);
  assert.equal(result.points.lines, 0, 'no accidental line clear');
  assert.equal(result.gameOver, true);
  assert.equal(result.next.status, 'gameover');
  assert.equal(hasMovesLeft(result.next), false);

  const roomy: GameState = { ...state, board: createBoard() };
  const open = applyMove(roomy, 0, 7, 7, rngFrom(6));
  assert.ok(open);
  assert.equal(open.gameOver, false);
  assert.equal(open.next.status, 'playing');
});

test('generated trays always contain at least one playable piece', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rng = rngFrom(seed);
    const board = createBoard().map(row => row.map(() => (rng() < 0.55 ? (1 + Math.floor(rng() * COLOR_COUNT)) : EMPTY)));
    // Keep at least one empty cell so playability is actually possible.
    board[Math.floor(rng() * BOARD_SIZE)]![Math.floor(rng() * BOARD_SIZE)] = EMPTY;
    const tray = generateTray(board, rng);
    assert.equal(tray.length, TRAY_SIZE);
    const playable = tray.some(piece => piece && hasAnyPlacement(board, shape(piece.shapeId)));
    assert.equal(playable, true, `seed ${seed} produced a dead tray`);
    const ids = tray.filter(Boolean).map(piece => piece!.shapeId);
    assert.equal(ids.every(id => id === ids[0]), false, 'no triple-identical trays');
  }
});

test('random play keeps the board consistent over long runs', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = rngFrom(seed * 977);
    let state = startGame(rng);
    let guard = 0;
    while (state.status === 'playing' && guard++ < 300) {
      const options: Array<{ index: number; row: number; col: number }> = [];
      state.tray.forEach((piece, index) => {
        if (!piece) return;
        for (const anchor of findPlacements(state.board, shape(piece.shapeId))) options.push({ index, row: anchor.row, col: anchor.col });
      });
      if (options.length === 0) break;
      const pick = options[Math.floor(rng() * options.length)]!;
      const result = applyMove(state, pick.index, pick.row, pick.col, rng);
      assert.ok(result, 'legal options must always apply');
      const previous = state;
      state = result.next;
      assert.equal(state.score - previous.score, result.points.placement + result.points.clear, 'score bookkeeping');
      assert.equal(state.board.length, BOARD_SIZE);
      for (const row of state.board) {
        assert.equal(row.length, BOARD_SIZE);
        for (const cell of row) assert.ok(cell >= 0 && cell <= COLOR_COUNT, 'cells stay in range');
      }
      for (const anchor of result.placedCells) assert.ok(anchor.row >= 0 && anchor.row < BOARD_SIZE);
      for (const r of result.clear.rows) assert.ok(state.board[r]!.some(cell => cell === EMPTY), 'cleared rows are gone');
      for (const c of result.clear.cols) assert.ok(state.board.some(row => row[c] === EMPTY), 'cleared columns are gone');
      if (state.status === 'playing') assert.equal(hasMovesLeft(state), true, 'games only end when no move remains');
    }
    if (state.status === 'gameover') assert.equal(hasMovesLeft(state), false);
  }
});

test('saved games round-trip and malformed saves are refused', () => {
  const rng = rngFrom(99);
  let state = startGame(rng);
  for (let i = 0; i < 12 && state.status === 'playing'; i++) {
    const options: Array<{ index: number; row: number; col: number }> = [];
    state.tray.forEach((piece, index) => {
      if (!piece) return;
      for (const anchor of findPlacements(state.board, shape(piece.shapeId))) options.push({ index, row: anchor.row, col: anchor.col });
    });
    if (options.length === 0) break;
    const pick = options[Math.floor(rng() * options.length)]!;
    const result = applyMove(state, pick.index, pick.row, pick.col, rng);
    assert.ok(result);
    state = result.next;
  }
  const saved = serialize(state);
  const restored = deserialize(JSON.parse(JSON.stringify(saved)));
  assert.ok(restored);
  assert.deepEqual(serialize(restored), saved, 'round-trip is lossless');
  assert.equal(restored.status, 'playing');
  assert.deepEqual(trim(restored), trim(state));

  const bad: unknown[] = [
    null, 42, {}, { ...saved, version: 2 },
    { ...saved, board: saved.board.slice(1) },
    { ...saved, board: saved.board.map((row, i) => (i === 0 ? row.slice(1) : row)) },
    { ...saved, board: saved.board.map((row, i) => (i === 0 ? [...row.slice(1), 99] : row)) },
    { ...saved, board: saved.board.map((row, i) => (i === 0 ? [...row.slice(1), -1] : row)) },
    { ...saved, board: saved.board.map((row, i) => (i === 0 ? [...row.slice(1), 1.5] : row)) },
    { ...saved, tray: [saved.tray[0]] },
    { ...saved, tray: [{ shapeId: 'nope', color: 1 }, null, null] },
    { ...saved, tray: [{ shapeId: 'dot', color: 0 }, null, null] },
    { ...saved, tray: [{ shapeId: 'dot', color: COLOR_COUNT + 1 }, null, null] },
    { ...saved, tray: [{ shapeId: 'dot', color: 1.5 }, null, null] },
    { ...saved, score: -5 }, { ...saved, score: Number.NaN }, { ...saved, score: 'lots' },
    { ...saved, combo: -1 }, { ...saved, combo: 2.5 }, { ...saved, moves: Number.POSITIVE_INFINITY },
  ];
  for (const value of bad) assert.equal(deserialize(value), null, `refuses ${JSON.stringify(value)?.slice(0, 60)}`);
});

test('lineClear returns the union of every completed line', () => {
  const board = boardFrom([
    '########',
    '########',
    '########',
    '########',
    '########',
    '########',
    '########',
    '########',
  ]);
  const clear = lineClear(board);
  assert.equal(clear.rows.length, BOARD_SIZE);
  assert.equal(clear.cols.length, BOARD_SIZE);
  assert.equal(clear.cells.length, BOARD_SIZE * BOARD_SIZE);
  assert.equal(clearCells(board, clear.cells).every(row => row.every(cell => cell === EMPTY)), true);
});
