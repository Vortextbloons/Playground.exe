import { createGame, createInput, fitCanvas } from '@playground-exe/game-kit';
import {
  BUNKER_CELL,
  BUNKER_COLS,
  BUNKER_ROWS,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  INVADER_H,
  INVADER_W,
  PLAYER_H,
  PLAYER_W,
  PLAYER_Y,
  WORLD_H,
  WORLD_W,
  createInitialState,
  setWorldSize,
  step,
} from './engine';
import './style.css';

const container = document.querySelector<HTMLElement>('#game')!;
container.replaceChildren();

const wrap = document.createElement('div');
wrap.className = 'invaders-wrap';
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Space Invaders play field');
wrap.append(canvas);

const hud = document.createElement('div');
hud.className = 'invaders-hud';
const scoreEl = document.createElement('div');
scoreEl.className = 'invaders-score';
scoreEl.textContent = '0';
const bestEl = document.createElement('div');
bestEl.className = 'invaders-best';
const livesEl = document.createElement('div');
livesEl.className = 'invaders-lives';
const center = document.createElement('div');
center.className = 'invaders-center';
const title = document.createElement('h1');
const body = document.createElement('p');
const keys = document.createElement('p');
keys.className = 'keys';
keys.textContent = '← → / A D move · Space shoots · Drag to steer and hold to fire · R restarts';
const action = document.createElement('button');
action.type = 'button';
center.append(title, body, keys, action);
hud.append(scoreEl, bestEl, livesEl, center);
wrap.append(hud);
container.append(wrap);

const ctx = canvas.getContext('2d')!;
const input = createInput(container);

function fitWorld(): void {
  const portrait = window.innerWidth < window.innerHeight;
  setWorldSize(portrait ? 480 : 640, portrait ? 640 : 480);
}

fitWorld();
const sizing = fitCanvas(canvas, container, WORLD_W, WORLD_H);

const stars = Array.from({ length: 90 }, (_, i) => ({
  x: (i * 137) % WORLD_W,
  y: (i * 251) % WORLD_H,
  r: i % 3 === 0 ? 1.6 : 1,
  tw: (i * 37) % 100,
}));

let state = createInitialState();
let raf = 0;
let last = 0;
let running = false;
let muted = false;
let audioCtx: AudioContext | null = null;
let waveFlash = 0;

function best(): number {
  const value = game.storage.get<number>('high-score', 0);
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function blip(freq: number, dur: number, type: OscillatorType, gain = 0.05): void {
  if (muted) return;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, audioCtx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(amp).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {
    // Audio is decorative; never break the game loop.
  }
}

function beginPlaying(): void {
  if (state.phase === 'ready') state.phase = 'playing';
  renderOverlay();
}

function onRestart(): void {
  state = createInitialState();
  state.phase = 'playing';
  game.score(0);
  renderOverlay();
  container.focus();
}

function loop(now: number): void {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  waveFlash = Math.max(0, waveFlash - dt);
  const shoot =
    input.isDown('Space') || input.isDown('ArrowUp') || input.isDown('KeyW') || input.pointer.down;
  if (input.pointer.down) {
    const root = container.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const pointerX = root.left + input.pointer.x * root.width;
    const targetX = ((pointerX - box.left) / (box.width || 1)) * WORLD_W;
    state.playerX += (targetX - state.playerX) * Math.min(1, dt * 12);
  }
  const events = step(
    state,
    dt,
    {
      left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
      right: input.isDown('ArrowRight') || input.isDown('KeyD'),
      shoot,
    },
  );
  for (const event of events) {
    if (event === 'playerShot') blip(740, 0.07, 'square');
    else if (event === 'invaderKilled') {
      blip(220, 0.08, 'sawtooth');
      scoreEl.textContent = String(state.score);
      game.score(state.score);
    } else if (event === 'bunkerHit') blip(140, 0.05, 'triangle', 0.04);
    else if (event === 'playerHit') {
      blip(110, 0.3, 'sawtooth', 0.08);
      game.score(state.score);
    } else if (event === 'waveClear') {
      blip(660, 0.12, 'sine');
      waveFlash = 1.2;
      game.score(state.score);
    } else if (event === 'gameOver') {
      game.score(state.score);
      renderOverlay();
    }
  }
  scoreEl.textContent = String(state.score);
  bestEl.textContent = `Best ${Math.max(best(), state.score)}`;
  livesEl.textContent = `♥ ${state.lives} · Wave ${state.wave}`;
  if (state.phase === 'waveclear' || state.phase === 'over') renderOverlay();
  draw();
  raf = requestAnimationFrame(loop);
}

function drawInvader(x: number, y: number, row: number, t: number): void {
  const color = row <= 0 ? '#c084fc' : row <= 2 ? '#67e8f9' : '#4ade80';
  const frame = Math.floor(t * 4) % 2 === 0;
  ctx.fillStyle = color;
  ctx.fillRect(x + 4, y, INVADER_W - 8, 6);
  ctx.fillRect(x, y + 6, INVADER_W, INVADER_H - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 6, y + 8, 5, 5);
  ctx.fillRect(x + INVADER_W - 11, y + 8, 5, 5);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 7, y + 9, 3, 3);
  ctx.fillRect(x + INVADER_W - 10, y + 9, 3, 3);
  ctx.fillStyle = color;
  if (frame) {
    ctx.fillRect(x + 1, y + INVADER_H - 4, 6, 4);
    ctx.fillRect(x + INVADER_W - 7, y + INVADER_H - 4, 6, 4);
  } else {
    ctx.fillRect(x + 5, y + INVADER_H - 4, 6, 4);
    ctx.fillRect(x + INVADER_W - 11, y + INVADER_H - 4, 6, 4);
  }
  ctx.fillRect(x + INVADER_W / 2 - 1, y - 4, 2, 4);
}

function draw(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#050810';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    const a = 0.35 + 0.4 * Math.abs(Math.sin(state.time * 1.4 + s.tw));
    ctx.globalAlpha = a;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(74,222,128,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, PLAYER_Y + PLAYER_H / 2 + 22);
  ctx.lineTo(WORLD_W, PLAYER_Y + PLAYER_H / 2 + 22);
  ctx.stroke();

  for (const bunker of state.bunkers) {
    ctx.fillStyle = '#22c55e';
    for (let r = 0; r < BUNKER_ROWS; r++) {
      for (let c = 0; c < BUNKER_COLS; c++) {
        if (!bunker.cells[r * BUNKER_COLS + c]) continue;
        ctx.fillRect(bunker.x + c * BUNKER_CELL, bunker.y + r * BUNKER_CELL, BUNKER_CELL - 1, BUNKER_CELL - 1);
      }
    }
  }

  for (const inv of state.invaders) {
    if (inv.alive) drawInvader(inv.x, inv.y, inv.row, state.time + inv.col * 0.2);
  }

  for (const bullet of state.bullets) {
    if (bullet.enemy) {
      ctx.fillStyle = '#f87171';
      ctx.fillRect(bullet.x - ENEMY_BULLET_W / 2, bullet.y, ENEMY_BULLET_W, ENEMY_BULLET_H);
      ctx.fillStyle = '#fecaca';
      ctx.fillRect(bullet.x - 1, bullet.y + 2, 2, ENEMY_BULLET_H - 4);
    } else {
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(bullet.x - 2, bullet.y, 4, 12);
      ctx.fillStyle = '#fff';
      ctx.fillRect(bullet.x - 1, bullet.y, 2, 12);
    }
  }

  const blink = state.shieldT > 0 && Math.floor(state.time * 10) % 2 === 0;
  if (!blink && state.phase !== 'over') {
    const x = state.playerX;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(x - PLAYER_W / 2, PLAYER_Y - 4, PLAYER_W, 14);
    ctx.fillRect(x - 9, PLAYER_Y - PLAYER_H / 2 - 2, 18, 12);
    ctx.fillStyle = '#052e16';
    ctx.fillRect(x - 5, PLAYER_Y - 2, 10, 6);
    ctx.fillStyle = '#bbf7d0';
    ctx.fillRect(x - PLAYER_W / 2 + 3, PLAYER_Y - 2, PLAYER_W - 6, 2);
  }

  if (waveFlash > 0) {
    ctx.fillStyle = `rgba(74,222,128,${Math.min(0.35, waveFlash * 0.3)})`;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }
}

function renderOverlay(): void {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = `Best ${Math.max(best(), state.score)}`;
  livesEl.textContent = `♥ ${state.lives} · Wave ${state.wave}`;
  const show = state.phase !== 'playing';
  center.hidden = !show;
  if (!show) return;
  if (state.phase === 'ready') {
    title.textContent = 'Space Invaders';
    body.textContent = 'Clear the swarm before it lands — bunkers burn away, so keep moving.';
    action.textContent = 'Start defending (Space)';
  } else if (state.phase === 'waveclear') {
    title.textContent = `Wave ${state.wave} clear!`;
    body.textContent = `Bonus banked. Next swarm drops faster. Score ${state.score}.`;
    action.textContent = 'Keep defending';
  } else {
    title.textContent = 'Game over';
    body.textContent = `The swarm landed. Score ${state.score} · Wave ${state.wave} · Best ${Math.max(best(), state.score)}.`;
    action.textContent = 'Invade again (R)';
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.repeat) {
    if (event.code === 'Space') event.preventDefault();
    return;
  }
  if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'Enter') {
    if (state.phase === 'ready' || state.phase === 'over') {
      event.preventDefault();
      if (state.phase === 'over') onRestart();
      else beginPlaying();
      container.focus();
    } else if (state.phase === 'waveclear') {
      event.preventDefault();
    }
  } else if (event.code === 'KeyR') {
    event.preventDefault();
    onRestart();
  }
}

function onPointerDown(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest('button')) return;
  container.focus();
  if (state.phase === 'ready') beginPlaying();
}

function onActionClick(): void {
  container.focus();
  if (state.phase === 'over') onRestart();
  else beginPlaying();
}

const game = createGame('space-invaders', {
  initialize() {
    renderOverlay();
  },
  start() {
    container.focus();
    running = true;
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  },
  pause() {
    running = false;
    cancelAnimationFrame(raf);
    input.clear();
  },
  resume() {
    running = true;
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  },
  restart() {
    onRestart();
    running = true;
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  },
  destroy() {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    container.removeEventListener('pointerdown', onPointerDown as EventListener);
    action.removeEventListener('click', onActionClick);
    input.destroy();
    sizing.destroy();
  },
  mute(m: boolean) {
    muted = m;
  },
});

window.addEventListener('keydown', onKeyDown);
container.addEventListener('pointerdown', onPointerDown as EventListener);
canvas.style.touchAction = 'none';
action.addEventListener('click', onActionClick);

window.addEventListener('resize', () => {
  fitWorld();
  sizing.setWorld(WORLD_W, WORLD_H);
  state = createInitialState();
  renderOverlay();
});

void game.boot().catch((error) => {
  console.error(error);
  game.destroy();
});
