import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_COUNT,
  INITIAL_TOP,
  LEVEL_COUNT,
  isCollapsed,
  isRemovable,
  onTop,
  towerLayout,
  towerTop,
  type TowerBlock,
} from '../games/tower-tumble/src/layout';
import {
  applyGrip,
  beginGrip,
  createTower,
  destroyTower,
  initRapier,
  readBlocks,
  releaseGrip,
  stepTower,
  type Tower,
} from '../games/tower-tumble/src/physics';

await initRapier();

function advance(tower: Tower, steps: number, before?: () => void): void {
  const speeds = new Float32Array(BLOCK_COUNT);
  for (let step = 0; step < steps; step++) {
    before?.();
    stepTower(tower, speeds);
  }
}

function centerOf(tower: Tower, index: number) {
  return tower.bodies[index]!.translation();
}

test('tower layout is seeded, deterministic, and alternating', () => {
  const first = towerLayout(7);
  const second = towerLayout(7);
  const other = towerLayout(8);
  assert.equal(first.length, BLOCK_COUNT);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.map(block => block.x), other.map(block => block.x));
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const blocks = first.filter(block => block.level === level);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.axis, level % 2 === 0 ? 'x' : 'z');
  }
  assert.equal(first[0]!.y, 0.075);
});

test('an untouched tower settles once, then stays still', () => {
  const tower = createTower(11);
  const before = readBlocks(tower, []);
  advance(tower, 360);
  const settled = readBlocks(tower, []);
  const anchor = settled.map(block => ({ ...block }));
  let sag = 0;
  for (let index = 0; index < BLOCK_COUNT; index++) {
    sag = Math.max(sag, Math.hypot(before[index]!.x - settled[index]!.x, before[index]!.y - settled[index]!.y, before[index]!.z - settled[index]!.z));
  }
  assert.ok(sag < 0.008, `tower drifted ${sag.toFixed(4)}m while settling`);
  advance(tower, 360);
  const later = readBlocks(tower, []);
  let drift = 0;
  for (let index = 0; index < BLOCK_COUNT; index++) {
    drift = Math.max(drift, Math.hypot(anchor[index]!.x - later[index]!.x, anchor[index]!.y - later[index]!.y, anchor[index]!.z - later[index]!.z));
  }
  assert.ok(drift < 0.0005, `settled tower crept ${drift.toFixed(5)}m in six more seconds`);
  assert.equal(isCollapsed(later), false);
  assert.ok(towerTop(later) > INITIAL_TOP - 0.02);
  destroyTower(tower);
});

test('only blocks below the highest complete level can be removed', () => {
  const blocks: TowerBlock[] = towerLayout(3).map(placement => ({
    index: placement.index,
    level: placement.level,
    moved: false,
    x: placement.x,
    y: placement.y,
    z: placement.z,
  }));
  assert.equal(isRemovable(blocks, 51), false);
  assert.equal(isRemovable(blocks, 40), true);
  for (const block of blocks.filter(candidate => candidate.level === 17)) block.moved = true;
  assert.equal(isRemovable(blocks, 48), false);
  assert.equal(isRemovable(blocks, 40), true);
});

test('a top block can be pulled free, carried, and dropped on the tower', () => {
  const tower = createTower(5);
  advance(tower, 120);
  const index = 51;
  const before = centerOf(tower, index);
  const pullAxis = tower.placements[index]!.axis === 'x' ? 'z' : 'x';
  const grip = beginGrip(tower, index);
  const speeds = new Float32Array(BLOCK_COUNT);
  let guard = 0;
  while (grip.phase === 'extract' && guard++ < 400) {
    grip.input.distance = Math.min(0.62, grip.input.distance + 0.012);
    applyGrip(tower, grip, towerTop(readBlocks(tower, [])), 0);
    stepTower(tower, speeds);
  }
  assert.equal(grip.phase, 'carry', 'the block should be clear of the tower');
  const pulled = centerOf(tower, index);
  assert.ok(Math.abs(pulled[pullAxis] - before[pullAxis]) > 0.28, `the block should leave its level (${pullAxis} ${before[pullAxis].toFixed(3)} -> ${pulled[pullAxis].toFixed(3)})`);
  grip.input.x = pulled.x;
  grip.input.z = pulled.z;
  advance(tower, 60, () => applyGrip(tower, grip, towerTop(readBlocks(tower, []), index), 0));
  const previousTop = towerTop(readBlocks(tower, []), index);
  grip.input.x = 0.2;
  grip.input.z = -0.15;
  advance(tower, 180, () => applyGrip(tower, grip, previousTop, 0));
  releaseGrip(tower, grip);
  advance(tower, 300);
  const blocks = readBlocks(tower, []);
  const placed = blocks[index]!;
  assert.equal(isCollapsed(blocks), false, 'dropping one block must not collapse the tower');
  assert.equal(onTop(placed, previousTop), true, `block settled at y=${placed.y.toFixed(3)} vs top ${previousTop.toFixed(3)}`);
  destroyTower(tower);
});

test('a mid-tower side block can be worked free without toppling the tower', () => {
  const tower = createTower(5);
  advance(tower, 120);
  const index = 8 * 3;
  const origin = readBlocks(tower, []).map(block => ({ x: block.x, y: block.y, z: block.z }));
  const grip = beginGrip(tower, index);
  const speeds = new Float32Array(BLOCK_COUNT);
  let steps = 0;
  while (grip.phase === 'extract' && steps < 600) {
    grip.input.distance = Math.min(0.62, grip.input.distance + 0.012);
    applyGrip(tower, grip, towerTop(readBlocks(tower, []), index), 0);
    stepTower(tower, speeds);
    steps++;
  }
  assert.equal(grip.phase, 'carry', 'a level 8 side block should come free');
  assert.ok(steps < 300, `extraction took ${(steps / 60).toFixed(1)}s`);
  const blocks = readBlocks(tower, []);
  assert.equal(isCollapsed(blocks), false);
  let disturb = 0;
  blocks.forEach((block, position) => {
    if (position === index) return;
    disturb = Math.max(disturb, Math.hypot(block.x - origin[position]!.x, block.y - origin[position]!.y, block.z - origin[position]!.z));
  });
  assert.ok(disturb < 0.05, `tower shifted ${(disturb * 1000).toFixed(0)}mm while pulling`);
  destroyTower(tower);
});

test('collapse is detected from physics when the tower is pushed over', () => {
  const tower = createTower(9);
  advance(tower, 60);
  for (const body of tower.bodies) body.applyImpulse({ x: 2.6, y: 0, z: 0 }, true);
  advance(tower, 720);
  const blocks = readBlocks(tower, []);
  assert.equal(isCollapsed(blocks), true);
  assert.ok(towerTop(blocks) < INITIAL_TOP * 0.62);
  destroyTower(tower);
});
