import { createGame, createInput, fitCanvas } from '@playground-exe/game-kit';
import {
  BIRD_R,
  BIRD_X,
  GROUND_H,
  PIPE_W,
  WORLD_H,
  WORLD_W,
  createInitialState,
  flap,
  setWorldSize,
  step,
} from './engine';
import './style.css';

// --- Presentation -----------------------------------------------------------

const container = document.querySelector<HTMLElement>('#game')!;
container.replaceChildren();

const wrap = document.createElement('div');
wrap.className = 'flappy-wrap';
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Flappy Bird play field');
wrap.append(canvas);

const hud = document.createElement('div');
hud.className = 'flappy-hud';
const scoreEl = document.createElement('div');
scoreEl.className = 'flappy-score';
scoreEl.textContent = '0';
const bestEl = document.createElement('div');
bestEl.className = 'flappy-best';
const center = document.createElement('div');
center.className = 'flappy-center';
const title = document.createElement('h1');
const body = document.createElement('p');
const keys = document.createElement('p');
keys.className = 'keys';
keys.textContent = 'Space / ↑ / W or click / tap to flap · R to restart';
const action = document.createElement('button');
action.type = 'button';
center.append(title, body, keys, action);
hud.append(scoreEl, bestEl, center);
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

const clouds = Array.from({ length: 5 }, (_, i) => ({
  x: (i * 173) % WORLD_W,
  y: 40 + ((i * 67) % 200),
  s: 0.6 + (i % 3) * 0.35,
  v: 12 + (i % 3) * 7,
}));

let state = createInitialState();
let raf = 0;
let last = 0;
let running = false;
let muted = false;
let audioCtx: AudioContext | null = null;

function best(): number {
  const value = game.storage.get<number>('high-score', 0);
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function blip(freq: number, dur: number, type: OscillatorType, gain = 0.06): void {
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

function onFlap(): void {
  flap(state);
  if (state.phase === 'playing') {
    blip(520, 0.09, 'square');
    action.blur();
  }
  renderOverlay();
}

function onRestart(): void {
  state = createInitialState();
  game.score(0);
  renderOverlay();
  container.focus();
}

function loop(now: number): void {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  for (const cloud of clouds) {
    cloud.x -= cloud.v * dt;
    if (cloud.x < -90) {
      cloud.x = WORLD_W + 90;
      cloud.y = 30 + Math.random() * 220;
    }
  }
  const event = step(state, dt);
  if (event === 'scored') {
    scoreEl.textContent = String(state.score);
    blip(880, 0.08, 'sine');
    const top = game.score(state.score);
    bestEl.textContent = `Best ${top}`;
  } else if (event === 'died') {
    const top = game.score(state.score);
    bestEl.textContent = `Best ${Math.max(top, state.score)}`;
    blip(160, 0.3, 'sawtooth', 0.08);
    renderOverlay();
  }
  draw();
  raf = requestAnimationFrame(loop);
}

function drawPipe(x: number, y: number, w: number, h: number, lip: boolean): void {
  if (h <= 0) return;
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#3f8f3a');
  grad.addColorStop(0.25, '#6fcf5f');
  grad.addColorStop(0.55, '#a4e89a');
  grad.addColorStop(0.8, '#57b34c');
  grad.addColorStop(1, '#35782f');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#1e4d1a';
  ctx.lineWidth = 3;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 1.5, y - 2, w - 3, h + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x + 10, y + 4, 10, h - 8);
  if (lip) {
    ctx.fillStyle = grad;
    ctx.fillRect(x - 5, y, w + 10, 26);
    ctx.strokeRect(x - 5 + 1.5, y, w + 10 - 3, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 5, y + 4, 10, 18);
  }
}

function drawBird(): void {
  const tilt = Math.max(-0.45, Math.min(1.25, state.birdVy / 700));
  ctx.save();
  ctx.translate(BIRD_X, state.birdY);
  ctx.rotate(tilt * 0.55);
  // Tail
  ctx.fillStyle = '#e8932f';
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-26, -8);
  ctx.lineTo(-24, 6);
  ctx.closePath();
  ctx.fill();
  // Body
  const bodyGrad = ctx.createLinearGradient(0, -BIRD_R, 0, BIRD_R);
  bodyGrad.addColorStop(0, '#ffe066');
  bodyGrad.addColorStop(1, '#f5a623');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#7a4a00';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Wing (flaps with time while alive)
  const wing = state.phase === 'playing' ? Math.sin(state.time * 22) * 6 : Math.sin(state.time * 4) * 3;
  ctx.fillStyle = '#fff3c4';
  ctx.strokeStyle = '#7a4a00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-6, 4 + wing * 0.4, 10, 6 + wing * 0.25, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(6, -6, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7a4a00';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = state.phase === 'dead' ? '#666' : '#222';
  ctx.beginPath();
  ctx.arc(8, -6, 3, 0, Math.PI * 2);
  ctx.fill();
  if (state.phase === 'dead') {
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(4, -10);
    ctx.lineTo(12, -2);
    ctx.moveTo(12, -10);
    ctx.lineTo(4, -2);
    ctx.stroke();
  }
  // Beak
  ctx.fillStyle = '#ff6b35';
  ctx.strokeStyle = '#a83a12';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(24, 4);
  ctx.lineTo(12, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function draw(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, '#4fb3d9');
  sky.addColorStop(0.65, '#8fd8e8');
  sky.addColorStop(1, '#c9f0e4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // Sun
  ctx.fillStyle = 'rgba(255,244,200,0.9)';
  ctx.beginPath();
  ctx.arc(398, 96, 30, 0, Math.PI * 2);
  ctx.fill();
  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  for (const c of clouds) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 20 * c.s, 0, Math.PI * 2);
    ctx.arc(c.x + 22 * c.s, c.y + 4 * c.s, 15 * c.s, 0, Math.PI * 2);
    ctx.arc(c.x - 22 * c.s, c.y + 5 * c.s, 14 * c.s, 0, Math.PI * 2);
    ctx.fill();
  }
  // Distant hills
  ctx.fillStyle = '#a8dcb2';
  ctx.beginPath();
  ctx.moveTo(0, WORLD_H - GROUND_H);
  for (let x = 0; x <= WORLD_W; x += 40) {
    ctx.lineTo(x, WORLD_H - GROUND_H - 26 - Math.sin((x + 120) / 90) * 16);
  }
  ctx.lineTo(WORLD_W, WORLD_H - GROUND_H);
  ctx.closePath();
  ctx.fill();
  // Pipes
  for (const pipe of state.pipes) {
    const topH = pipe.gapY - pipe.gap / 2;
    const botY = pipe.gapY + pipe.gap / 2;
    drawPipe(pipe.x, -4, PIPE_W, topH - 22, true);
    ctx.fillStyle = '#2f7a28';
    ctx.fillRect(pipe.x - 5, topH - 26, PIPE_W + 10, 4);
    drawPipe(pipe.x, botY, PIPE_W, WORLD_H - GROUND_H - botY + 4, false);
    ctx.fillStyle = '#2f7a28';
    ctx.fillRect(pipe.x - 5, botY, PIPE_W + 10, 4);
  }
  // Ground
  const gy = WORLD_H - GROUND_H;
  ctx.fillStyle = '#e8d98a';
  ctx.fillRect(0, gy, WORLD_W, GROUND_H);
  ctx.fillStyle = '#7ec850';
  ctx.fillRect(0, gy, WORLD_W, 26);
  ctx.fillStyle = '#5da53d';
  ctx.fillRect(0, gy + 26, WORLD_W, 6);
  ctx.fillStyle = 'rgba(120,90,30,0.35)';
  for (let x = -state.groundX; x < WORLD_W; x += 48) {
    ctx.fillRect(x, gy + 44, 24, 8);
    ctx.fillRect(x + 8, gy + 64, 24, 8);
  }
  ctx.fillStyle = '#3c2f1a';
  ctx.fillRect(0, gy - 2, WORLD_W, 3);

  drawBird();

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(state.flash / 0.35) * 0.55})`;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }
}

function renderOverlay(): void {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = `Best ${Math.max(best(), state.score)}`;
  const show = state.phase !== 'playing';
  center.hidden = !show;
  if (!show) return;
  if (state.phase === 'ready') {
    title.textContent = 'Flappy Bird';
    body.textContent = 'Dodge the pipes. One point per gate — how far can you fly?';
    action.textContent = 'Tap / Space to flap';
  } else {
    title.textContent = 'Crashed!';
    body.textContent = `You scored ${state.score}. Best ${Math.max(best(), state.score)}.`;
    action.textContent = 'Flap again (R)';
  }
}

function pressFlap(event: Event): void {
  event.preventDefault();
  if (state.phase === 'dead') onRestart();
  onFlap();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.repeat) return;
  if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
    pressFlap(event);
  } else if (event.code === 'KeyR' || event.code === 'Enter') {
    if (state.phase === 'dead' || state.phase === 'ready') {
      event.preventDefault();
      onRestart();
      if (event.code === 'Enter') onFlap();
    }
  }
}

function onPointerDown(event: PointerEvent): void {
  // Let the restart button handle its own clicks.
  if ((event.target as HTMLElement).closest('button')) return;
  container.focus();
  pressFlap(event);
}

const game = createGame('flappy-bird', {
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

function onActionClick(): void {
  container.focus();
  if (state.phase === 'dead') onRestart();
  onFlap();
}

window.addEventListener('keydown', onKeyDown);
// Tap anywhere in the frame to flap. HUD button stays clickable.
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
