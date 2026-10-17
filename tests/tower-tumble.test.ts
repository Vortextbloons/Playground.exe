import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
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

for (const pointerType of ['mouse', 'touch']) test(`${pointerType} gestures select safely, pause grabs, and keep camera gestures separate`, () => {
  const captured = new Set<number>();
  const element = Object.assign(new EventTarget(), {
    clientHeight: 500,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
    setPointerCapture: (id: number) => { captured.add(id); },
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => { captured.delete(id); },
  });
  let grabs = 0;
  let pauses = 0;
  let selections = 0;
  let resumes = 0;
  let picked: number | null = 8;
  let drags = 0;
  let rotations = 0;
  const zooms: number[] = [];
  const controls = createControls(element as unknown as HTMLElement, new PerspectiveCamera(), {
    pick: () => picked, canGrab: () => true,
    select() { selections++; }, resumeGrab() { resumes++; },
    beginGrab(_index, ray) { assert.ok(Number.isFinite(ray.direction.x)); grabs++; },
    drag() { drags++; }, pauseGrab() { pauses++; }, hover() {},
    orbit: { rotate() { rotations++; }, zoom(value) { zooms.push(value); } },
  });
  const emit = (type: string, values: Record<string, number> = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType, pointerId: 1, button: 0, clientX: 400, clientY: 250, ...values });
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
    emit('pointermove', { clientX: 407 });
    emit('pointerup');
    assert.equal(selections, 1);
    assert.equal(grabs, 0, 'a tap or tiny drag only selects');
    assert.equal(pauses, 0);
    emit('pointerdown');
    emit('pointermove', { clientX: 408 });
    assert.equal(grabs, 1, 'dragging eight pixels starts pulling');
    assert.equal(drags, 1);
    emit('pointerdown', { pointerId: 2, clientX: 500 });
    assert.equal(pauses, 1, 'a second finger pauses the gesture');
    emit('pointermove', { pointerId: 2, clientX: 520 });
    emit('pointerup', { pointerId: 2 });
    emit('pointermove', { clientX: 430 });
    assert.equal(drags, 1, 'the remaining finger must orbit after a pinch');
    emit('pointerup');
    for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      emit('pointerdown');
      emit('pointermove', { clientX: 420 });
      emit(ending);
      emit('pointerup');
    }
    assert.equal(pauses, 4, 'each gesture pauses exactly once');
    assert.equal(resumes, 4, 'fresh drags rebase the held block');
    picked = null;
    const before = rotations;
    emit('pointerdown');
    emit('pointermove', { clientX: 450 });
    emit('pointerup');
    assert.equal(rotations, before + 1, 'empty-space drags orbit');
    emit('wheel', { deltaY: 3, deltaMode: 1 });
    assert.equal(zooms.at(-1), 48);
    emit('wheel', { deltaY: -1000, deltaMode: 0 });
    assert.equal(zooms.at(-1), -100);
  } finally {
    controls.destroy();
  }
});

test('projected pulling rebases without jumps at different camera angles', () => {
  const source = readFileSync(new URL('../games/tower-tumble/src/main.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const functions = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ['beginGrab', 'resumeGrab', 'rebaseCarry', 'updateDrag', 'planePoint'].includes(node.name?.text ?? '')).map(node => node.getText(file)).join('\n');
  for (const cameraPosition of [[3, 2, 3], [3, 2, 0.01], [0.01, 2, 3]]) {
    const camera = new PerspectiveCamera(50, 800 / 500, 0.05, 60);
    camera.position.set(...cameraPosition as [number, number, number]);
    camera.lookAt(0, 1, 0);
    const grip = { index: 8, phase: 'extract', pullX: 1, pullZ: 0, input: { distance: 0, x: 0, z: 0 } };
    const context = {
      THREE, tower: { bodies: Array.from({ length: 9 }, () => ({ translation: () => ({ x: 0, y: 1, z: 0 }) })) },
      scene: { camera }, canvas: { getBoundingClientRect: () => ({ width: 800, height: 500 }) },
      grip: null, phase: 'idle', mode: 'authority', selected: null, snapped: false, pullStart: {},
      carryReady: false, carryOffset: {}, beginGrip: () => grip, inputAllowed: () => true,
      currentBlocks: () => [], towerTop: () => 2, CARRY_HEIGHT: 0.33, CARRY_LIMIT: 0.55, EXTRACT_LIMIT: 0.62,
      session: { send(action: string) { assert.equal(action, 'grab'); } },
      ray: { screenX: 400, screenY: 250, origin: { x: 0.4, y: 4, z: 2 }, direction: { x: 0, y: -1, z: -1 } },
    };
    runInNewContext(ts.transpile(`${functions}\nbeginGrab(8, ray); resumeGrab(ray); updateDrag(ray);`), context);
    assert.equal(grip.input.distance, 0);
    context.ray.screenX += 25;
    runInNewContext('updateDrag(ray)', context);
    assert.ok(Number.isFinite(grip.input.distance) && grip.input.distance < 1);
    const distance = grip.input.distance;
    runInNewContext('resumeGrab(ray); updateDrag(ray)', context);
    assert.equal(grip.input.distance, distance, 'resuming must preserve extraction distance');
    grip.phase = 'carry';
    grip.input.x = 0.2;
    runInNewContext('resumeGrab(ray); updateDrag(ray)', context);
    assert.ok(Math.abs(grip.input.x - 0.2) < 1e-9, 'carrying preserves the pointer offset');
    context.ray.origin.x -= 0.15;
    runInNewContext('updateDrag(ray)', context);
    assert.equal(grip.input.x, 0, 'near the center the target snaps');
    context.ray.origin.x += 0.05;
    runInNewContext('updateDrag(ray)', context);
    assert.equal(grip.input.x, 0, 'snap remains within the exit radius');
    context.ray.origin.x += 0.03;
    runInNewContext('updateDrag(ray)', context);
    assert.ok(Math.abs(grip.input.x - 0.13) < 1e-9, 'dragging beyond the exit radius releases the snap');
  }
});

test('only explicit placement drops a carried block and starts settling', () => {
  const source = readFileSync(new URL('../games/tower-tumble/src/main.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const release = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'releaseGrab')!;
  let releases = 0;
  const active = { index: 8, phase: 'extract' };
  const context = { tower: {}, grip: active as typeof active | null, phase: 'holding', selected: 8, carryReady: true,
    moved: [] as boolean[], drop: null, settleTime: 1, stableTime: 1, inputAllowed: () => true,
    currentBlocks: () => [], towerTop: () => 3, releaseGrip() { releases++; }, scene: { showGuide() {} } };
  runInNewContext(ts.transpile(`${release.getText(file)}\nreleaseGrab();`), context);
  assert.equal(releases, 0, 'cannot place during extraction');
  active.phase = 'carry';
  runInNewContext('releaseGrab(); releaseGrab()', context);
  assert.equal(releases, 1);
  assert.equal(context.grip, null);
  assert.equal(context.phase, 'settling');
  assert.equal(context.moved[8], true);
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
  const hud = { onPlace() {}, party: { append() {} }, setQuality() {}, onRestart() {}, addControl() {}, onQuality() {}, setStats() {}, toast() {}, setRestartVisible() {}, hideResult() {} };
  const scene = { camera: {}, orbit: {}, setQuality() {}, resize() {}, syncPoses() {}, showGuide() {}, update() {}, render() { rendered++; }, renderer: { setAnimationLoop() {} } };
  const context = {
    tower: null, scene: null, hud: null, controls: null, seed: 1, quality: {}, qualityName: 'high',
    selected: null, mode: 'solo', phase: 'idle', snapshots: [], accumulator: 0, grip: null, drop: null, moved: [], placed: 0,
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
      updateControlFeedback() {}, simulateFrame() { poses[0]!.y -= 0.1; },
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
  assert.ok(Math.hypot(grip.input.x - pulled.x, grip.input.z - pulled.z) < 0.02, 'lifting starts at the extracted position instead of pulling back through the tower');
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
