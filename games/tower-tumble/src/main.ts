import { createGame } from '@playground-exe/game-kit';
import * as THREE from 'three';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import metadata from '../game.json';
import {
  BLOCK_COUNT,
  BLOCK_HEIGHT,
  CARRY_LIMIT,
  EXTRACT_LIMIT,
  POSE_STRIDE,
  TURN_MS,
  decodePoses,
  isCollapsed,
  isRemovable,
  onTop,
  topAxis,
  towerTop,
  type BlockPose,
  type TowerBlock,
} from './layout';
import {
  applyEncoded,
  applyGrip,
  beginGrip,
  CARRY_HEIGHT,
  collectImpacts,
  createTower,
  destroyTower,
  encodeTower,
  initRapier,
  maxSpeed,
  pick,
  readBlocks,
  readPoses,
  releaseGrip,
  stepTower,
  STEP,
  type Grip,
  type Tower,
} from './physics';
import { createScene, QUALITY_LEVELS, type Quality, type Scene3D } from './scene';
import { createControls, type PointerRay } from './controls';
import { createSound } from './audio';
import { createHud, type Hud } from './hud';
import type { TowerActions, TowerState } from './multiplayer';
import './style.css';

const container = document.querySelector<HTMLElement>('#game')!;
const canvas = container.querySelector<HTMLCanvasElement>('canvas')!;
const sound = createSound();
const config = parseMultiplayer(metadata.multiplayer);

type Phase = 'idle' | 'holding' | 'settling' | 'over';
type Mode = 'solo' | 'authority' | 'replay' | 'falling';

let tower: Tower | null = null;
let scene: Scene3D | null = null;
let hud: Hud | null = null;
let controls: ReturnType<typeof createControls> | null = null;
let moved: boolean[] = new Array(BLOCK_COUNT).fill(false);
let previousSpeeds = new Float32Array(BLOCK_COUNT);
let phase: Phase = 'idle';
let grip: Grip | null = null;
let selected: number | null = null;
let hovered: number | null = null;
let hoverLegal = false;
let pullStart = { x: 0, y: 0, distance: 0, dx: 0, dy: 0 };
let snapped = false;
let carryReady = false;
let carryOffset = { x: 0, z: 0 };
let drop: { index: number; previousTop: number } | null = null;
let placed = 0;
let best = 0;
let seed = (Math.random() * 0xffffffff) >>> 0;
let accumulator = 0;
let last = 0;
let settleTime = 0;
let stableTime = 0;
let qualityName: 'high' | 'low' = 'high';
let quality: Quality = QUALITY_LEVELS.high;
let mode: Mode = 'solo';
let snapshots: { time: number; poses: BlockPose[] }[] = [];
let lastSync = 0;
let lastStats = '';
let resultsShown = false;
let timeoutSent = false;
let lastState: TowerState | null = null;
const timerButton = document.createElement('button');
timerButton.type = 'button';
timerButton.hidden = true;

const game = createGame('tower-tumble', {
  async initialize() {
    await initRapier();
    tower = createTower(seed);
    scene = createScene(canvas, quality);
    hud = createHud(container);
    hud.party.append(partyControls);
    const stored = game.storage.get<'high' | 'low' | 'auto'>('quality', 'auto');
    qualityName = stored === 'auto' ? detectQuality() : stored;
    quality = QUALITY_LEVELS[qualityName];
    scene.setQuality(quality);
    hud.setQuality(qualityName);
    hud.onPlace(releaseGrab);
    hud.onRestart(() => game.restart());
    timerButton.addEventListener('click', () => {
      const state = lastState;
      if (!state) return;
      session.send('timer', { enabled: !state.timerEnabled });
    });
    hud.addControl(timerButton);
    hud.onQuality(value => {
      qualityName = value;
      quality = QUALITY_LEVELS[value];
      scene?.setQuality(quality);
      game.storage.set('quality', value);
    });
    controls = createControls(canvas, scene.camera, {
      pick(ray) {
        if (!tower || !inputAllowed()) return null;
        return pick(tower, ray.origin, ray.direction)?.index ?? null;
      },
      canGrab(index) {
        return inputAllowed() && (grip ? grip.index === index : phase === 'idle' && isRemovable(currentBlocks(), index));
      },
      select(index) { selected = index; },
      beginGrab,
      resumeGrab,
      drag: updateDrag,
      pauseGrab() { carryReady = false; },
      hover(index, legal) {
        hovered = index;
        hoverLegal = legal;
      },
      orbit: scene.orbit,
    });
    container.addEventListener('pointerdown', () => sound.resume(), { once: true });
    window.addEventListener('resize', onResize);
    scene.resize();
    updateStats(true);
    scene.syncPoses(readPoses(tower));
  },
  start() {
    const view = session.current;
    if (view.match) {
      handleState(view.match.state, view.match.status === 'playing', view.isPlayer);
      if (mode === 'replay') pushSnapshot(view.match.state.blocks);
      hud?.setRestartVisible(view.match.status !== 'playing');
    }
    updateStats(true);
    last = performance.now();
    accumulator = 0;
    if (tower && scene) {
      scene.syncPoses(mode === 'replay' ? sampleSnapshots(last) : readPoses(tower));
      scene.update(0);
      scene.render();
    }
    scene?.renderer.setAnimationLoop(tick);
  },
  pause() {
    scene?.renderer.setAnimationLoop(null);
  },
  resume() {
    last = performance.now();
    accumulator = 0;
    scene?.renderer.setAnimationLoop(tick);
  },
  restart() {
    if (session.current.match?.status === 'playing') {
      hud?.toast('Use the party menu to start another round.');
      return;
    }
    resetTower();
  },
  destroy() {
    scene?.renderer.setAnimationLoop(null);
    controls?.destroy();
    partyMenu.destroy();
    window.removeEventListener('resize', onResize);
    hud?.destroy();
    scene?.dispose();
    if (tower) destroyTower(tower);
    sound.dispose();
  },
  mute(muted: boolean) {
    sound.setMuted(muted);
  },
});

const session = game.multiplayer<TowerState, TowerActions>();
const partyMenu = createMultiplayerMenu(session, metadata.id, config);
const partyControls = document.createElement('details');
partyControls.open = true;
const partySummary = document.createElement('summary');
partySummary.textContent = 'Party menu';
partyControls.append(partySummary, partyMenu.element);
let partyPlaying = false;

function detectQuality(): 'high' | 'low' {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 8;
  return coarse && cores <= 6 ? 'low' : 'high';
}

function inputAllowed(): boolean {
  if (session.current.match?.status !== 'playing') return true;
  return mode === 'authority' && phase !== 'over';
}

function updateStats(force = false) {
  const view = session.current;
  const state = view.match?.state as TowerState | undefined;
  if (state) {
    lastState = state;
    timerButton.hidden = view.match?.status !== 'playing' || !view.isPlayer;
    timerButton.textContent = state.timerEnabled ? 'Timer on' : 'Timer off';
  } else {
    lastState = null;
    timerButton.hidden = true;
  }
  let text = '';
  let detail = '';
  if (view.match && state) {
    const name = (id: string | null) => view.party?.players.find(player => player.id === id)?.nickname ?? 'Player';
    if (state.phase === 'finished') {
      text = state.loser === view.playerId ? 'The tower fell on your turn' : state.loser ? `${name(state.loser)} toppled the tower` : 'Round over';
      detail = `${state.placed} placed`;
    } else {
      const seconds = Math.max(0, Math.ceil((TURN_MS - (Date.now() - state.turnStartedAt)) / 1000));
      text = `${name(state.turn)}’s turn`;
      detail = state.timerEnabled ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${state.placed} placed`;
    }
  } else {
    text = `Placed ${placed}`;
    detail = `Best ${best}`;
  }
  const signature = `${text}|${detail}`;
  if (signature === lastStats && !force) return;
  lastStats = signature;
  hud?.setStats(text, detail);
}

function currentBlocks(): TowerBlock[] {
  return tower ? readBlocks(tower, moved) : [];
}

function carryYaw(blocks: readonly TowerBlock[], exclude = -1): number {
  return topAxis(blocks, exclude) === 'x' ? Math.PI / 2 : 0;
}

function planePoint(ray: PointerRay, y: number): { x: number; z: number } | null {
  if (Math.abs(ray.direction.y) < 0.1) return null;
  const t = (y - ray.origin.y) / ray.direction.y;
  if (t <= 0.05) return null;
  return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
}

function beginGrab(index: number, _ray: PointerRay) {
  if (!tower || grip || phase !== 'idle') return;
  grip = beginGrip(tower, index);
  selected = index;
  snapped = false;
  phase = 'holding';
  if (mode === 'authority') session.send('grab', { block: index });
}

function resumeGrab(ray: PointerRay) {
  if (!tower || !grip || !scene) return;
  const position = tower.bodies[grip.index]!.translation();
  scene.camera.updateMatrixWorld();
  const start = new THREE.Vector3(position.x, position.y, position.z).project(scene.camera);
  const end = new THREE.Vector3(position.x + grip.pullX, position.y, position.z + grip.pullZ).project(scene.camera);
  const rect = canvas.getBoundingClientRect();
  pullStart = { x: ray.screenX, y: ray.screenY, distance: grip.input.distance,
    dx: (end.x - start.x) * rect.width / 2, dy: -(end.y - start.y) * rect.height / 2 };
  carryReady = false;
  if (grip.phase === 'carry') rebaseCarry(ray);
}

function rebaseCarry(ray: PointerRay) {
  if (!grip) return;
  const point = planePoint(ray, towerTop(currentBlocks(), grip.index) + CARRY_HEIGHT);
  if (!point) return;
  carryOffset = { x: grip.input.x - point.x, z: grip.input.z - point.z };
  carryReady = true;
}

function updateDrag(ray: PointerRay) {
  if (!tower || !grip || !inputAllowed()) return;
  if (grip.phase === 'extract') {
    const { x, y, distance, dx, dy } = pullStart;
    grip.input.distance = THREE.MathUtils.clamp(distance + ((ray.screenX - x) * dx + (ray.screenY - y) * dy) / Math.max(dx * dx + dy * dy, 1600), 0, EXTRACT_LIMIT);
    return;
  }
  const top = towerTop(currentBlocks(), grip.index);
  const point = planePoint(ray, top + CARRY_HEIGHT);
  if (!point) return;
  if (!carryReady) { rebaseCarry(ray); return; }
  const x = THREE.MathUtils.clamp(point.x + carryOffset.x, -CARRY_LIMIT, CARRY_LIMIT);
  const z = THREE.MathUtils.clamp(point.z + carryOffset.z, -CARRY_LIMIT, CARRY_LIMIT);
  const distance = Math.hypot(x, z);
  snapped = distance < (snapped ? 0.12 : 0.08);
  grip.input.x = snapped ? 0 : x;
  grip.input.z = snapped ? 0 : z;
}

function releaseGrab() {
  if (!tower || !grip || grip.phase !== 'carry' || !inputAllowed()) return;
  const active = grip;
  const blocks = currentBlocks();
  const top = towerTop(blocks, active.index);
  releaseGrip(tower, active);
  moved[active.index] = true;
  drop = { index: active.index, previousTop: top };
  settleTime = 0;
  stableTime = 0;
  phase = 'settling';
  grip = null;
  selected = null;
  carryReady = false;
  scene?.showGuide(false, 0, 0);
}

function reportToServer() {
  if (!tower) return;
  session.send('sync', { blocks: encodeTower(tower), maxSpeed: maxSpeed(tower) });
  session.send('release', { settled: true });
  snapshots = [{ time: performance.now(), poses: readPoses(tower) }];
  phase = 'over';
  mode = 'falling';
}

function finishSettling() {
  if (!tower || !drop) return;
  const blocks = currentBlocks();
  const block = blocks[drop.index]!;
  if (isCollapsed(blocks)) { collapseLocal(); return; }
  const good = onTop(block, drop.previousTop);
  drop = null;
  phase = 'idle';
  if (mode === 'authority') { reportToServer(); return; }
  if (good) {
    placed++;
    best = game.score(placed);
    hud?.toast(placed === 1 ? 'Nicely done.' : `${placed} blocks placed.`);
  } else {
    hud?.toast('That block missed the top of the tower.');
  }
  updateStats();
}

function collapseLocal() {
  if (phase === 'over') return;
  grip = null;
  selected = null;
  drop = null;
  scene?.showGuide(false, 0, 0);
  scene?.shake(1);
  sound.crash();
  if (mode === 'authority') { reportToServer(); return; }
  phase = 'over';
  best = game.score(placed);
  updateStats();
  hud?.showResult('The tower fell!', `${placed} block${placed === 1 ? '' : 's'} placed · Personal best ${best}`, {
    label: 'Play again',
    onSelect: () => game.restart(),
  });
}

function simulate() {
  if (!tower) return;
  if (grip) {
    const blocks = currentBlocks();
    const top = towerTop(blocks, grip.index);
    const yaw = carryYaw(blocks, grip.index);
    const wasExtracting = grip.phase === 'extract';
    applyGrip(tower, grip, top, yaw);
    if (wasExtracting && grip.phase === 'carry') carryReady = false;
    scene?.showGuide(grip.phase === 'carry', top + BLOCK_HEIGHT, yaw, grip.input.x, grip.input.z);
  }
  stepTower(tower, previousSpeeds);
  const impacts = collectImpacts(tower, previousSpeeds);
  if (impacts.length) sound.impacts(impacts);
}

function simulateFrame(dt: number) {
  if (!tower || !scene) return;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    simulate();
    accumulator -= STEP;
    steps++;
  }
  if (accumulator > STEP) accumulator = 0;
  if (mode === 'falling') { scene.syncPoses(readPoses(tower)); return; }
  if (phase !== 'over' && isCollapsed(currentBlocks(), undefined, grip?.index ?? -1)) {
    collapseLocal();
  } else if (phase === 'settling') {
    settleTime += dt;
    stableTime = maxSpeed(tower) < 0.07 ? stableTime + dt : 0;
    if (stableTime > 0.5 || settleTime > 6) finishSettling();
  }
}

function replayFrame(now: number) {
  if (!scene) return;
  const poses = sampleSnapshots(now);
  if (poses.length) scene.syncPoses(poses);
}

function sampleSnapshots(now: number): BlockPose[] {
  if (!snapshots.length) return [];
  if (snapshots.length === 1) return snapshots[0]!.poses;
  const target = now - 120;
  let before = snapshots[0]!;
  let after = snapshots[snapshots.length - 1]!;
  for (const entry of snapshots) {
    if (entry.time <= target) before = entry;
    if (entry.time >= target) { after = entry; break; }
  }
  if (before === after || after.time <= before.time) return after.poses;
  const amount = Math.min(Math.max((target - before.time) / (after.time - before.time), 0), 1);
  const from = new THREE.Quaternion();
  const to = new THREE.Quaternion();
  return before.poses.map((pose, index) => {
    const next = after.poses[index] ?? pose;
    from.set(pose.qx, pose.qy, pose.qz, pose.qw);
    to.set(next.qx, next.qy, next.qz, next.qw);
    from.slerp(to, amount);
    return {
      x: pose.x + (next.x - pose.x) * amount,
      y: pose.y + (next.y - pose.y) * amount,
      z: pose.z + (next.z - pose.z) * amount,
      qx: from.x, qy: from.y, qz: from.z, qw: from.w,
    };
  });
}

function pushSnapshot(blocks: readonly number[]) {
  if (blocks.length !== BLOCK_COUNT * POSE_STRIDE) return;
  snapshots.push({ time: performance.now(), poses: decodePoses(blocks) });
  if (snapshots.length > 3) snapshots.shift();
}

function streamAuthority(now: number) {
  if (!tower || mode !== 'authority') return;
  if (now - lastSync < 100) return;
  lastSync = now;
  session.send('sync', { blocks: encodeTower(tower), maxSpeed: maxSpeed(tower) });
}

function tick(time: number) {
  const dt = Math.min((time - last) / 1000, 0.1);
  last = time;
  const now = performance.now();
  if (mode === 'replay') {
    replayFrame(now);
    if (tower && !snapshots.length) scene?.syncPoses(readPoses(tower));
  } else {
    simulateFrame(dt);
    if (mode === 'authority') {
      streamAuthority(now);
      const state = lastState;
      if (state?.timerEnabled && !timeoutSent && Date.now() - state.turnStartedAt > TURN_MS) {
        timeoutSent = true;
        session.send('timeout', null);
      }
    }
    if (tower) scene?.syncPoses(readPoses(tower));
  }
  scene?.update(dt);
  updateControlFeedback();
  scene?.render();
  updateStats();
}

function updateControlFeedback() {
  if (!scene || !tower || !hud) return;
  const allowed = inputAllowed() && phase !== 'over';
  if (!allowed) selected = null;
  scene.highlight(allowed ? selected ?? hovered : null, selected !== null || hoverLegal);
  const placement = selected === null ? null : tower.placements[selected]!;
  const position = selected === null ? null : tower.bodies[selected]!.translation();
  scene.showPull(position && placement && (!grip || grip.phase === 'extract') ? { ...position, dx: placement.axis === 'z' ? (placement.slot === 0 ? -1 : 1) : 0, dz: placement.axis === 'x' ? (placement.slot === 0 ? -1 : 1) : 0 } : null);
  if (!grip) scene.showGuide(false, 0, 0);
  const canPlace = allowed && grip?.phase === 'carry';
  const message = !allowed ? 'Watch the tower — wait for your turn.'
    : canPlace ? 'Position the block, then press Place block. Lift to pause.'
    : phase === 'settling' ? 'Wait for the block to settle.'
    : selected !== null ? 'Drag the highlighted block along the arrow. Lift to pause.'
    : 'Select a block. Drag empty space to rotate the tower.';
  hud.setInteraction(message, canPlace);
}

function resetTower() {
  if (tower) destroyTower(tower);
  seed = (Math.random() * 0xffffffff) >>> 0;
  tower = createTower(seed);
  moved = new Array(BLOCK_COUNT).fill(false);
  previousSpeeds = new Float32Array(BLOCK_COUNT);
  phase = 'idle';
  grip = null;
  selected = null;
  drop = null;
  placed = 0;
  accumulator = 0;
  snapshots = [];
  mode = 'solo';
  resultsShown = false;
  hud?.hideResult();
  hud?.setRestartVisible(true);
  scene?.showGuide(false, 0, 0);
  updateStats(true);
  if (tower && scene) scene.syncPoses(readPoses(tower));
}

function applyServerState(state: TowerState) {
  if (!tower) return;
  applyEncoded(tower, state.blocks);
  moved = state.moved.map(value => value === true);
  placed = state.placed;
  phase = 'idle';
  grip = null;
  selected = null;
  drop = null;
  accumulator = 0;
  snapshots = [{ time: performance.now(), poses: decodePoses(state.blocks) }];
  scene?.showGuide(false, 0, 0);
}

function syncServerFlags(state: TowerState) {
  moved = state.moved.map(value => value === true);
  placed = state.placed;
}

function enterAuthoritativeTurn(state: TowerState) {
  applyServerState(state);
  mode = 'authority';
  lastSync = 0;
  timeoutSent = false;
  hud?.toast('Your turn.');
}

function enterReplay(state: TowerState, falling: boolean) {
  if (falling) {
    if (mode !== 'falling') {
      applyServerState(state);
      mode = 'falling';
      phase = 'over';
      scene?.shake(0.8);
      sound.crash();
    }
    return;
  }
  if (mode !== 'replay') {
    mode = 'replay';
    phase = 'idle';
    grip = null;
    selected = null;
    drop = null;
    snapshots = [];
    hud?.setRestartVisible(false);
    hud?.hideResult();
    resultsShown = false;
  }
}

function showMatchResults(state: TowerState) {
  if (resultsShown) return;
  resultsShown = true;
  const view = session.current;
  const name = (id: string | null) => view.party?.players.find(player => player.id === id)?.nickname ?? 'Player';
  const won = !!view.playerId && state.winners.includes(view.playerId);
  const title = state.loser === view.playerId ? 'The tower fell on your turn' : won ? 'You win!' : 'Round over';
  const highlight = state.lastPlaced ? `${name(state.lastPlaced)} placed the last block` : 'no blocks placed';
  hud?.showResult(title, `${state.placed} blocks placed · ${highlight}`, {
    label: 'Back to the game menu',
    onSelect: () => { session.command({ type: 'return' }); },
  });
}

function handleState(state: TowerState, playing: boolean, isPlayer: boolean) {
  if (!tower) return;
  const playerId = session.current.playerId;
  if (state.phase === 'finished') {
    enterReplay(state, true);
    showMatchResults(state);
    updateStats(true);
    return;
  }
  if (playing && isPlayer && state.turn === playerId) {
    if (mode !== 'authority') enterAuthoritativeTurn(state);
    else syncServerFlags(state);
    return;
  }
  enterReplay(state, false);
  updateStats();
}

function onResize() {
  scene?.resize();
  scene?.render();
}

session.subscribe(view => {
  const match = view.match;
  const playing = match?.status === 'playing';
  partyControls.hidden = view.party?.selection?.gameId !== metadata.id;
  if (playing !== partyPlaying) {
    partyControls.open = !playing;
    partyPlaying = playing;
  }
  if (!match) {
    if (mode !== 'solo') resetTower();
    return;
  }
  if (match.status === 'playing') hud?.setRestartVisible(false);
});

session.onState((state, view) => {
  if (!view.match) return;
  handleState(state, view.match.status === 'playing', view.isPlayer);
  if (view.match.status === 'playing' && mode === 'replay') pushSnapshot(state.blocks);
});

session.onError(message => {
  hud?.toast(message);
  if (lastState && mode === 'authority') {
    applyServerState(lastState);
    mode = 'replay';
  }
});

void game.boot().catch(error => {
  console.error(error);
  game.destroy();
});
