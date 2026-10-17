import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PerspectiveCamera } from 'three';
import { createControls } from '../games/tower-tumble/src/controls';
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

test('mouse and touch gestures release grabs cleanly and keep camera gestures separate', () => {
  const captured = new Set<number>();
  const element = Object.assign(new EventTarget(), {
    clientHeight: 500,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
    setPointerCapture: (id: number) => { captured.add(id); },
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => { captured.delete(id); },
  });
  let grabs = 0;
  let releases = 0;
  let drags = 0;
  let rotations = 0;
  const zooms: number[] = [];
  const controls = createControls(element as unknown as HTMLElement, new PerspectiveCamera(), {
    pick: () => 8, canGrab: () => true,
    beginGrab(_index, ray) { assert.ok(Number.isFinite(ray.direction.x)); grabs++; },
    drag() { drags++; }, release() { releases++; }, hover() {},
    orbit: { rotate() { rotations++; }, zoom(value) { zooms.push(value); } },
  });
  const emit = (type: string, values: Record<string, number> = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, clientX: 400, clientY: 250, ...values });
    element.dispatchEvent(event);
    return event;
  };
  try {
    assert.equal(emit('pointerdown', { button: 1 }).defaultPrevented, true);
    emit('pointermove', { clientX: 420 });
    assert.equal(grabs, 0, 'middle drag must orbit without grabbing');
    assert.equal(rotations, 1);
    emit('pointerup');
    emit('pointerdown');
    emit('pointerdown', { pointerId: 2, clientX: 500 });
    assert.equal(releases, 1, 'a second finger must release the block');
    emit('pointermove', { pointerId: 2, clientX: 520 });
    emit('pointerup', { pointerId: 2 });
    emit('pointermove', { clientX: 430 });
    assert.equal(drags, 0, 'the remaining finger must orbit after a pinch');
    emit('pointerup');
    emit('pointerdown');
    emit('lostpointercapture');
    emit('pointerup');
    assert.equal(releases, 2, 'lost capture must release exactly once');
    emit('wheel', { deltaY: 3, deltaMode: 1 });
    assert.equal(zooms.at(-1), 48);
    emit('wheel', { deltaY: -1000, deltaMode: 0 });
    assert.equal(zooms.at(-1), -100);
  } finally {
    controls.destroy();
  }
});

test('pulling a block starts at the pointer position without jumping on first movement', () => {
  const source = readFileSync(new URL('../games/tower-tumble/src/main.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const functions = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ['beginGrab', 'updateDrag', 'pullPoint'].includes(node.name?.text ?? '')).map(node => node.getText(file)).join('\n');
  const grip = { phase: 'extract', pullX: 1, pullZ: 0, originX: 0, originZ: 0, input: { distance: 0 } };
  const context = {
    tower: {}, grip: null, phase: 'idle', mode: 'solo', pullOffset: 0,
    carryReady: false, carryOffset: {}, lastCarryPoint: null,
    beginGrip: () => grip,
    ray: { origin: { x: 0.4, y: 1, z: 2 }, direction: { x: 0, y: 0, z: -1 } },
  };
  runInNewContext(ts.transpile(`${functions}\nbeginGrab(0, ray); updateDrag(ray);`), context);
  assert.equal(grip.input.distance, 0);
  context.ray.origin.x += 0.2;
  runInNewContext('updateDrag(ray)', context);
  assert.ok(Math.abs(grip.input.distance - 0.2) < 1e-9);
});

test('a multiplayer snapshot received during loading is applied at startup and control follows the turn', async () => {
  const source = readFileSync(new URL('../games/tower-tumble/src/main.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const initializeGame = file.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'game'))!;
  const functions = file.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(file)).join('\n');
  let hooks: { initialize(): Promise<void>; start(): void; pause(): void };
  let applied = 0;
  let rendered = 0;
  const windowListeners = new Map<string, () => void>();
  const state = { phase: 'playing', turn: 'me', blocks: [], moved: [], placed: 3, timerEnabled: false };
  const hud = { party: { append() {} }, setQuality() {}, onRestart() {}, addControl() {}, onQuality() {}, setStats() {}, toast() {}, setRestartVisible() {}, hideResult() {} };
  const scene = { camera: {}, orbit: {}, setQuality() {}, resize() {}, syncPoses() {}, showGuide() {}, update() {}, render() { rendered++; }, renderer: { setAnimationLoop() {} } };
  const context = {
    tower: null, scene: null, hud: null, controls: null, seed: 1, quality: {}, qualityName: 'high',
    mode: 'solo', phase: 'idle', snapshots: [], accumulator: 0, grip: null, drop: null, moved: [], placed: 0,
    last: 0, lastSync: 0, timeoutSent: false, lastState: null, lastStats: '', resultsShown: false,
    metadata: { id: 'tower-tumble' }, container: { addEventListener() {} }, canvas: {},
    partyControls: {}, timerButton: { addEventListener() {}, hidden: true, textContent: '' },
    session: { current: { playerId: 'me', isPlayer: true, match: { status: 'playing', state }, party: { players: [{ id: 'me', nickname: 'Me' }] } } },
    createGame(_id: string, lifecycle: typeof hooks) { hooks = lifecycle; return { storage: { get: () => 'high' } }; },
    async initRapier() {}, createTower: () => ({}), createScene: () => scene, createHud: () => hud,
    createControls: () => ({}), QUALITY_LEVELS: { high: {} },
    performance: { now: () => 0 }, window: { addEventListener(type: string, listener: () => void) { windowListeners.set(type, listener); } },
    readPoses: () => [], decodePoses: () => [], TURN_MS: 90000,
    applyEncoded() { applied++; },
  };
  runInNewContext(ts.transpile(`${functions}\n${initializeGame.getText(file)}\nhandleState(session.current.match.state, true, true);`), context);
  await hooks!.initialize();
  hooks!.start();
  hooks!.pause();
  assert.ok(rendered > 0, 'switching to a background tab must show the tower even when paused before its first animation frame');
  const beforeResize = rendered;
  windowListeners.get('resize')!();
  assert.equal(rendered, beforeResize + 1, 'fullscreen resizing must redraw the canvas even while the animation loop is paused');
  assert.equal(applied, 1, 'loading must not discard the initial multiplayer tower snapshot');
  assert.equal(context.mode, 'authority');
  assert.equal(context.placed, 3);
  state.turn = 'other';
  runInNewContext('handleState(session.current.match.state, true, true)', context);
  assert.equal(context.mode, 'replay', 'the previous player must stop controlling the tower');
  state.turn = 'me';
  runInNewContext('handleState(session.current.match.state, true, true)', context);
  assert.equal(context.mode, 'authority');
  assert.equal(applied, 2, 'the next turn must start from the server tower');
});

test('the active multiplayer player renders changing tower poses each frame', () => {
  const source = readFileSync(new URL('../games/tower-tumble/src/main.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const tick = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'tick');
  assert.ok(tick);
  for (const mode of ['solo', 'authority', 'replay', 'falling']) {
    const poses = [{ x: 0, y: 1, z: 0 }];
    const rendered: unknown[] = [];
    const context = {
      mode, last: 0, lastState: null, tower: {}, snapshots: [],
      performance: { now: () => 100 },
      simulateFrame() { poses[0]!.y -= 0.1; },
      readPoses: () => poses.map(pose => ({ ...pose })),
      replayFrame() {}, streamAuthority() {}, updateStats() {},
      scene: { syncPoses(value: unknown) { rendered.push(value); }, update() {}, render() {} },
    };
    runInNewContext(ts.transpile(`${tick.getText(file)}\ntick(16); tick(32);`), context);
    assert.equal(rendered.length, 2, `${mode} must update the visible tower every frame`);
    if (mode !== 'replay') assert.notDeepEqual(rendered[0], rendered[1], `${mode} must display physics movement`);
  }
});

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
