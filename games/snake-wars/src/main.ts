import { createGame, fitCanvas } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import metadata from '../game.json';
import './style.css';
import { createMovementPrediction } from './prediction';
import {
  WIDTH, HEIGHT, STEP_MS, advanceTicks, createInitial, setDirection, activatePower, opposite, idx,
  type ArenaState, type Dir, type Snake,
} from './sim';

const TILE = 20;
const VIEW_W = WIDTH * TILE;
const VIEW_H = HEIGHT * TILE;
const PALETTE = ['#22d3ee', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#fb7185', '#34d399', '#60a5fa'];
const BOT_NAMES = ['Viper', 'Noodle', 'Fang'];
const SWIPE_PX = 24;

type Actions = { turn: string; heartbeat: string | null; powerup: null };

const container = document.querySelector<HTMLElement>('#game')!;
container.innerHTML = `<header><div><p class="eyebrow">THE LAST SNAKE STANDING</p><h1>SNAKE <span>WARS</span></h1></div><div class="header-actions"><button id="sound" aria-pressed="false">Sound on</button><button id="rematch">New practice</button><button id="solo">Practice solo</button></div></header>
<div class="war-layout"><div class="war-view"><div class="hud"><span id="clock">00:00</span><span id="alive"></span><span id="power"></span></div><div class="canvas-wrap"><canvas width="960" height="600" aria-label="Snake Wars arena. Steer with arrow keys or WASD; use Space for power-ups."></canvas></div><p id="status" role="status"></p><div class="touch-controls"><div class="dpad" role="group" aria-label="Steer"><button data-dir="up" aria-label="Steer up">▲</button><div class="dpad-mid"><button data-dir="left" aria-label="Steer left">◀</button><button data-dir="down" aria-label="Steer down">▼</button><button data-dir="right" aria-label="Steer right">▶</button></div></div><button id="boost" class="boost">⚡ Power</button></div></div><div id="menu"></div></div>
<div id="scoreboard" class="scoreboard" aria-label="Snake standings"></div><p class="note"><b>STEER</b> WASD / arrows / swipe <b>POWER</b> Space <b>SURVIVE</b> Avoid snakes and the closing red ring</p>`;

const canvas = container.querySelector('canvas')!;
const ctx = canvas.getContext('2d')!;
const wrap = container.querySelector('.canvas-wrap')!;
const status = container.querySelector<HTMLElement>('#status')!;
const clock = container.querySelector<HTMLElement>('#clock')!;
const aliveHud = container.querySelector<HTMLElement>('#alive')!;
const powerHud = container.querySelector<HTMLElement>('#power')!;
const soloButton = container.querySelector<HTMLButtonElement>('#solo')!;
const boostButton = container.querySelector<HTMLButtonElement>('#boost')!;
const soundButton = container.querySelector<HTMLButtonElement>('#sound')!;
const rematchButton = container.querySelector<HTMLButtonElement>('#rematch')!;
const scoreboard = container.querySelector<HTMLElement>('#scoreboard')!;
let audio: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let hostMuted = false;
let feedbackState: ArenaState | null = null;
let standingsKey = '';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function unlockAudio(): void {
  if (!audio) {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = muted || hostMuted ? 0 : 0.16;
    master.connect(audio.destination);
  }
  if (audio.state === 'suspended') void audio.resume().catch(() => {});
}

function sound(notes: number[], duration = 0.09, type: OscillatorType = 'sine'): void {
  if (!audio || !master || muted || hostMuted || paused || audio.state !== 'running') return;
  notes.forEach((frequency, index) => {
    const start = audio!.currentTime + index * duration;
    const oscillator = audio!.createOscillator();
    const envelope = audio!.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.8, start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(0.6, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(master!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  });
}

function setSound(): void {
  if (master && audio) master.gain.setValueAtTime(muted || hostMuted ? 0 : 0.16, audio.currentTime);
  soundButton.textContent = muted || hostMuted ? 'Sound off' : 'Sound on';
  soundButton.setAttribute('aria-pressed', String(!muted && !hostMuted));
}
soundButton.onclick = () => { unlockAudio(); muted = !muted; setSound(); if (!muted) sound([440, 660]); };
rematchButton.onclick = () => { unlockAudio(); startSolo(); sound([220, 330, 440]); };
container.addEventListener('pointerdown', unlockAudio);
const fit = fitCanvas(canvas, wrap as HTMLElement, VIEW_W, VIEW_H);

const YOU = 'you';
let solo: ArenaState | null = null;
let playingSolo = false;
let paused = false;
let animation = 0;
let lastFrame = 0;
let acc = 0;
let lastDir: Dir = 'right';
let prev: ArenaState | null = null;
let curr: ArenaState | null = null;
let snapAt = 0;
let prevMatchId = '';
const prediction = createMovementPrediction();
let particles: { x: number; y: number; vx: number; vy: number; ttl: number; color: string }[] = [];
let prevAlive = new Map<string, number>();

const game = createGame('snake-wars', {
  initialize() {},
  start() {
    lastFrame = performance.now();
    animation = requestAnimationFrame(frame);
  },
  pause() {
    paused = true;
    if (audio) void audio.suspend();
    cancelAnimationFrame(animation);
  },
  resume() {
    paused = false;
    if (audio) void audio.resume().catch(() => {});
    lastFrame = performance.now();
    animation = requestAnimationFrame(frame);
  },
  restart() {
    if (session.current.party) {
      status.textContent = 'The host can use Back to game menu to restart the party round.';
      return;
    }
    startSolo();
  },
  destroy() {
    if (audio) void audio.close();
    container.removeEventListener('pointerdown', unlockAudio);
    cancelAnimationFrame(animation);
    clearInterval(heartbeat);
    fit.destroy();
    partyMenu.destroy();
    window.removeEventListener('keydown', keydown);
  },
  mute(value) { hostMuted = value; setSound(); },
});

const session = game.multiplayer<ArenaState, Actions>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));
container.querySelector('#menu')!.append(partyMenu.element);

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

function snakeIndex(state: ArenaState, id: string): number {
  return Math.max(0, state.snakes.findIndex((s) => s.id === id));
}

function displayName(id: string): string {
  if (id === YOU) return 'You';
  if (id.startsWith('bot-')) return BOT_NAMES[Number(id.slice(4)) - 1] ?? 'Bot';
  return session.current.party?.players.find((p) => p.id === id)?.nickname ?? 'Snake';
}

function startSolo(): void {
  particles = [];
  feedbackState = null;
  acc = 0;
  solo = createInitial([YOU, 'bot-1', 'bot-2', 'bot-3'], (Math.random() * 0xffffffff) | 0, Date.now());
  playingSolo = true;
  lastDir = solo.snakes[0]!.dir;
  prev = null;
  curr = structuredClone(solo);
  snapAt = performance.now();
  prevAlive = new Map(solo.snakes.map((s) => [s.id, 1]));
  render();
}

function effectiveState(): ArenaState | null {
  const match = session.current.match;
  if (match && !playingSolo) return match.state;
  return solo;
}

function myId(): string | null {
  const match = session.current.match;
  if (match && !playingSolo) return session.current.playerId;
  return YOU;
}

function burst(x: number, y: number, color: string): void {
  if (reducedMotion) return;
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 140;
    particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, ttl: 0.6 + Math.random() * 0.4, color });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function steer(dir: Dir): void {
  const match = session.current.match;
  if (match && !playingSolo) {
    if (!session.current.isPlayer || !session.current.connected) return;
    const snake = match.state.snakes.find(item => item.id === session.current.playerId);
    if (!snake?.alive || opposite(dir, snake.dir) || !session.send('turn', dir)) return;
    lastDir = dir;
    prediction.receive(match.state, snake.id, dir, performance.now());
    return;
  }
  if (!solo || solo.finished) return;
  if (setDirection(solo, YOU, dir)) lastDir = dir;
}

function firePower(): void {
  const match = session.current.match;
  if (match && !playingSolo) {
    session.send('powerup', null);
    return;
  }
  if (solo) activatePower(solo, YOU);
}

const keyMap: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

function keydown(event: KeyboardEvent): void {
  if (event.target instanceof Element && event.target.closest('.multiplayer-menu, input, textarea')) return;
  const dir = keyMap[event.code];
  if (dir || event.code === 'Space') unlockAudio();
  if (dir) {
    event.preventDefault();
    if (!event.repeat) steer(dir);
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) firePower();
  }
}
window.addEventListener('keydown', keydown);

for (const button of container.querySelectorAll<HTMLButtonElement>('[data-dir]')) {
  const dir = button.dataset.dir as Dir;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    steer(dir);
  });
}
boostButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  firePower();
});
soloButton.onclick = () => {
  if (session.current.party && session.current.match && !playingSolo) {
    playingSolo = true;
    if (!solo || solo.finished) startSolo();
    render();
  } else if (session.current.party && playingSolo) {
    playingSolo = false;
    render();
  } else {
    startSolo();
  }
};

let touchStart: { x: number; y: number } | null = null;
canvas.addEventListener('touchstart', (event) => {
  const t = event.changedTouches[0]!;
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
canvas.addEventListener('touchmove', (event) => {
  event.preventDefault();
  if (!touchStart) return;
  const t = event.changedTouches[0]!;
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: false });
canvas.addEventListener('touchend', () => {
  touchStart = null;
});

const heartbeat = setInterval(() => {
  const { match, isPlayer, connected } = session.current;
  if (!match || playingSolo || !isPlayer || !connected || match.status !== 'playing') return;
  const state = match.state;
  const me = state.snakes.find((s) => s.id === session.current.playerId);
  if (me?.alive && !state.finished) session.send('heartbeat', lastDir);
}, 250);

function botChoice(state: ArenaState, snake: Snake): Dir {
  const solid = new Set<number>();
  for (const other of state.snakes) {
    if (!other.alive) continue;
    for (let i = 0; i < other.body.length - 1; i++) solid.add(other.body[i]!);
  }
  const head = snake.body[0]!;
  const hx = head % WIDTH;
  const hy = Math.floor(head / WIDTH);
  let target = state.food[0] ?? idx(WIDTH >> 1, HEIGHT >> 1);
  let best = Number.MAX_SAFE_INTEGER;
  for (const f of state.food) {
    const d = Math.abs((f % WIDTH) - hx) + Math.abs(Math.floor(f / WIDTH) - hy);
    if (d < best) {
      best = d;
      target = f;
    }
  }
  const tx = target % WIDTH;
  const ty = Math.floor(target / WIDTH);
  const options: Dir[] = (['up', 'down', 'left', 'right'] as Dir[]).filter((d) => !opposite(d, snake.dir));
  const safe = options.filter((d) => {
    const nx = hx + (d === 'left' ? -1 : d === 'right' ? 1 : 0);
    const ny = hy + (d === 'up' ? -1 : d === 'down' ? 1 : 0);
    if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) return false;
    if (nx < state.ring || ny < state.ring || nx >= WIDTH - state.ring || ny >= HEIGHT - state.ring) return false;
    if (snake.ghost <= 0 && solid.has(idx(nx, ny))) return false;
    return true;
  });
  const pool = safe.length ? safe : options;
  pool.sort((a, b) => {
    const ax = hx + (a === 'left' ? -1 : a === 'right' ? 1 : 0) - tx;
    const ay = hy + (a === 'up' ? -1 : a === 'down' ? 1 : 0) - ty;
    const bx = hx + (b === 'left' ? -1 : b === 'right' ? 1 : 0) - tx;
    const by = hy + (b === 'up' ? -1 : b === 'down' ? 1 : 0) - ty;
    return ax * ax + ay * ay - (bx * bx + by * by);
  });
  return pool[0] ?? snake.dir;
}

function tickSolo(): void {
  if (!solo || solo.finished || paused) return;
  const playing = !session.current.match || playingSolo;
  if (!playing) return;
  for (const snake of solo.snakes) {
    if (snake.alive && snake.id !== YOU) snake.want = botChoice(solo, snake);
  }
  advanceTicks(solo, 1);
  for (const snake of solo.snakes) {
    if (!snake.alive && prevAlive.get(snake.id) === 1) {
      const head = snake.body[0] ?? 0;
      burst((head % WIDTH) * TILE + TILE / 2, Math.floor(head / WIDTH) * TILE + TILE / 2, colorFor(snakeIndex(solo, snake.id)));
    }
    prevAlive.set(snake.id, snake.alive ? 1 : -1);
  }
  prev = curr;
  curr = structuredClone(solo);
  snapAt = performance.now();
  if (solo.finished) {
    const score = solo.snakes[0]!.food * 10 + solo.snakes[0]!.body.length;
    game.score(score);
    render();
  }
}

function syncServer(state: ArenaState): void {
  const moved = !curr || state.tick !== curr.tick;
  if (moved) { prev = curr; snapAt = performance.now(); }
  curr = structuredClone(state);
  const id = session.current.playerId;
  if (id && (moved || !state.snakes.find(item => item.id === id)?.alive || state.finished)) prediction.receive(state, id, lastDir, performance.now());
  for (const snake of state.snakes) {
    const was = prevAlive.get(snake.id);
    if (was === 1 && !snake.alive) {
      const head = snake.body[0] ?? 0;
      burst((head % WIDTH) * TILE + TILE / 2, Math.floor(head / WIDTH) * TILE + TILE / 2, colorFor(snakeIndex(state, snake.id)));
    }
    prevAlive.set(snake.id, snake.alive ? 1 : -1);
  }
}

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const match = session.current.match;
  if (!match || playingSolo) {
    if (!solo) startSolo();
    acc += dt * 1000;
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      tickSolo();
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.ttl -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.ttl <= 0) particles.splice(i, 1);
  }
  draw(dt);
  feedback();
  updateHud();
  animation = requestAnimationFrame(frame);
}

function feedback(): void {
  if (!curr || curr === feedbackState) return;
  const before = feedbackState;
  feedbackState = curr;
  if (!before || curr.tick < before.tick) return;
  const me = curr.snakes.find((s) => s.id === myId());
  const old = before.snakes.find((s) => s.id === myId());
  if (me && old) {
    if (me.food > old.food) {
      sound([620, 940], 0.055);
      const at = me.body[0]!;
      burst((at % WIDTH) * TILE + 10, Math.floor(at / WIDTH) * TILE + 10, '#ffe6a3');
    }
    if (me.power && !old.power) sound([440, 660, 880]);
    if (me.turbo > old.turbo || me.ghost > old.ghost) sound([160, 320, 640], 0.11, 'triangle');
    if (old.alive && !me.alive) sound([180, 100, 45], 0.14, 'sawtooth');
  }
  if (curr.warnRing > before.warnRing) sound([240, 240, 180], 0.17, 'square');
  if (curr.finished && !before.finished) sound(curr.winner === myId() ? [392, 494, 587, 784] : [294, 247, 196], 0.16, 'triangle');
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function draw(dt: number): void {
  void dt;
  const state = effectiveState();
  ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
  const background = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 40, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.65);
  background.addColorStop(0, '#16394b');
  background.addColorStop(1, '#071624');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (!state) return;
  ctx.strokeStyle = 'rgba(151,211,231,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WIDTH; x++) {
    ctx.moveTo(x * TILE + 0.5, 0);
    ctx.lineTo(x * TILE + 0.5, VIEW_H);
  }
  for (let y = 0; y <= HEIGHT; y++) {
    ctx.moveTo(0, y * TILE + 0.5);
    ctx.lineTo(VIEW_W, y * TILE + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = '#4a7b8c';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, VIEW_W - 4, VIEW_H - 4);
  const now = performance.now();
  const interval = playingSolo ? STEP_MS : Math.max(STEP_MS, ((curr?.tick ?? 0) - (prev?.tick ?? 0)) * STEP_MS);
  const k = Math.min(1, (now - snapAt) / interval);
  const ownPositions = !playingSolo && session.current.connected && session.current.isPlayer && session.current.match?.status === 'playing' && !state.finished ? prediction.sample(now) : [];
  const ring = state.ring;
  if (ring > 0) {
    ctx.fillStyle = 'rgba(239,68,68,0.28)';
    ctx.fillRect(0, 0, VIEW_W, ring * TILE);
    ctx.fillRect(0, VIEW_H - ring * TILE, VIEW_W, ring * TILE);
    ctx.fillRect(0, 0, ring * TILE, VIEW_H);
    ctx.fillRect(VIEW_W - ring * TILE, 0, ring * TILE, VIEW_H);
    ctx.strokeStyle = '#ff735e';
    ctx.lineWidth = 3;
    ctx.strokeRect(ring * TILE, ring * TILE, VIEW_W - ring * TILE * 2, VIEW_H - ring * TILE * 2);
  }
  if (state.warnRing > state.ring) {
    const blink = reducedMotion || Math.floor(performance.now() / 500) % 2 === 0;
    ctx.strokeStyle = blink ? 'rgba(239,68,68,0.9)' : 'rgba(251,146,60,0.9)';
    ctx.lineWidth = 3;
    const w = state.warnRing;
    ctx.strokeRect(w * TILE, w * TILE, VIEW_W - w * TILE * 2, VIEW_H - w * TILE * 2);
  }
  for (const f of state.food) {
    const x = (f % WIDTH) * TILE + TILE / 2;
    const y = Math.floor(f / WIDTH) * TILE + TILE / 2;
    ctx.save();
    ctx.shadowColor = '#ffca76';
    ctx.shadowBlur = 13;
    ctx.fillStyle = '#ffc875';
    ctx.beginPath();
    const radius = reducedMotion ? 5 : 5 + Math.sin(performance.now() / 300 + f) * 0.8;
    ctx.moveTo(x, y - radius - 1);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius + 1);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff4d7';
    ctx.fillRect(x - 1, y - 3, 2, 3);
    ctx.restore();
  }
  for (const item of state.items) {
    const x = (item.at % WIDTH) * TILE + TILE / 2;
    const y = Math.floor(item.at / WIDTH) * TILE + TILE / 2;
    ctx.save();
    ctx.shadowColor = item.kind === 'turbo' ? '#facc15' : '#67e8f9';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#142c42';
    ctx.strokeStyle = item.kind === 'turbo' ? '#facc15' : '#67e8f9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 9, y - 9, 18, 18, 5);
    ctx.fill();
    ctx.stroke();
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.kind === 'turbo' ? '⚡' : '👻', x, y);
    ctx.restore();
  }
  const me = myId();
  state.snakes.forEach((snake, si) => {
    if (!snake.alive && !snake.body.length) return;
    const color = colorFor(si);
    const prevSnake = prev?.snakes.find((s) => s.id === snake.id);
    const n = snake.body.length;
    ctx.save();
    if (snake.ghost > 0) ctx.globalAlpha = 0.55;
    ctx.shadowColor = color;
    ctx.shadowBlur = snake.id === me ? 14 : 8;
    for (let i = n - 1; i >= 0; i--) {
      const cur = snake.body[i]!;
      const old = prevSnake?.body[Math.min(i, prevSnake.body.length - 1)] ?? cur;
      const position = snake.id === me && snake.alive ? ownPositions[i] : undefined;
      const cx = (position?.x ?? lerp(old % WIDTH, cur % WIDTH, k)) * TILE + TILE / 2;
      const cy = (position?.y ?? lerp(Math.floor(old / WIDTH), Math.floor(cur / WIDTH), k)) * TILE + TILE / 2;
      const r = i === 0 ? 9 : Math.max(4, 8 - i * 0.12);
      ctx.fillStyle = i === 0 ? color : shade(color, i);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.beginPath();
      ctx.ellipse(cx - 1.5, cy - r * 0.4, r * 0.55, r * 0.22, -0.3, 0, Math.PI * 2);
      ctx.fill();
      if (i === 0) drawEyes(cx, cy, snake.dir);
    }
    ctx.restore();
    if (snake.alive && snake.body[0] !== undefined) {
      const head = snake.body[0];
      const old = prevSnake?.body[0] ?? head;
      const position = snake.id === me ? ownPositions[0] : undefined;
      const x = (position?.x ?? lerp(old % WIDTH, head % WIDTH, k)) * TILE + 10;
      const y = (position?.y ?? lerp(Math.floor(old / WIDTH), Math.floor(head / WIDTH), k)) * TILE;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = snake.id === me ? '#ffffff' : color;
      ctx.fillText(snake.id === me ? 'YOU' : displayName(snake.id), Math.max(30, Math.min(VIEW_W - 30, x)), Math.max(14, y - 7));
    }
    if (snake.turbo > 0 && snake.body[0] !== undefined) {
      const head = snake.body[0]!;
      ctx.save();
      ctx.fillStyle = 'rgba(250,204,21,0.8)';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('💨', (head % WIDTH) * TILE + TILE / 2, Math.floor(head / WIDTH) * TILE - 4);
      ctx.restore();
    }
  });
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.ttl * 2));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    ctx.restore();
  }
  if (state.finished) {
    ctx.fillStyle = 'rgba(5,17,29,0.76)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = state.winner === myId() ? '#ffc875' : '#e1f5ff';
    ctx.font = '900 54px system-ui';
    ctx.fillText(state.winner === myId() ? 'ARENA CHAMPION' : 'ROUND OVER', VIEW_W / 2, VIEW_H / 2 - 15);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#b9d7e5';
    ctx.fillText(state.winner ? `${displayName(state.winner)} takes the arena` : 'No survivors', VIEW_W / 2, VIEW_H / 2 + 24);
  }
}

function shade(hex: string, i: number): string {
  const f = Math.max(0.45, 1 - i * 0.03);
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * f);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * f);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * f);
  return `rgb(${r},${g},${b})`;
}

function drawEyes(cx: number, cy: number, dir: Dir): void {
  const off = 4;
  const fwd = 3;
  let dx = 0;
  let dy = 0;
  if (dir === 'up') dy = -fwd;
  if (dir === 'down') dy = fwd;
  if (dir === 'left') dx = -fwd;
  if (dir === 'right') dx = fwd;
  const px = dir === 'up' || dir === 'down' ? off : 0;
  const py = dir === 'left' || dir === 'right' ? off : 0;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + dx + px * s, cy + dy + py * s, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0e1a';
    ctx.beginPath();
    ctx.arc(cx + dx * 1.8 + px * s, cy + dy * 1.8 + py * s, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fmtTime(tick: number): string {
  const s = Math.floor(tick / 10);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function updateHud(): void {
  const state = effectiveState();
  if (!state) return;
  clock.textContent = fmtTime(state.tick);
  const alive = state.snakes.filter((s) => s.alive).length;
  aliveHud.textContent = `${alive} / ${state.snakes.length} ALIVE`;
  rematchButton.hidden = !!session.current.party && !playingSolo;
  const key = state.snakes.map((s) => `${s.id}:${s.food}:${s.alive}`).join('|') + myId();
  if (key !== standingsKey) {
    standingsKey = key;
    scoreboard.replaceChildren(...[...state.snakes].sort((a, b) => Number(b.alive) - Number(a.alive) || b.food - a.food).map((s) => {
      const entry = document.createElement('div');
      entry.className = `standing${s.alive ? '' : ' eliminated'}`;
      entry.style.setProperty('--snake', colorFor(snakeIndex(state, s.id)));
      const name = document.createElement('strong');
      name.textContent = displayName(s.id);
      const score = document.createElement('span');
      score.textContent = s.alive ? `${s.food} food` : 'OUT';
      entry.append(name, score);
      return entry;
    }));
  }
  const me = state.snakes.find((s) => s.id === myId());
  let powerText = '';
  if (me && !me.alive) powerText = '👻 spectating';
  else if (me?.turbo && me.turbo > 0) powerText = '⚡ TURBO';
  else if (me?.ghost && me.ghost > 0) powerText = '👻 GHOST';
  else if (me?.power) powerText = me.power === 'turbo' ? '⚡ ready' : '👻 ready';
  powerHud.textContent = powerText;
  boostButton.disabled = !me || !me.alive || !me.power;
  boostButton.textContent = me?.power === 'ghost' ? '👻 Ghost' : me?.power === 'turbo' ? '⚡ Turbo' : '⚡ Power';
}

function render(): void {
  const { party, match, playerId, isPlayer, connected } = session.current;
  if ((match?.id ?? '') !== prevMatchId) {
    prevMatchId = match?.id ?? '';
    prediction.reset();
    if (match) {
      feedbackState = null;
      playingSolo = false;
      prev = null;
      curr = structuredClone(match.state);
      snapAt = performance.now();
      prevAlive = new Map(match.state.snakes.map((s) => [s.id, s.alive ? 1 : -1]));
      const me = match.state.snakes.find((s) => s.id === playerId);
      if (me) lastDir = me.dir;
      if (playerId) prediction.receive(match.state, playerId, lastDir, performance.now(), true);
    } else if (!solo) {
      startSolo();
      return;
    }
  }
  container.classList.toggle('with-party', !!party);
  soloButton.hidden = !!party && !!match && !playingSolo ? false : !!party && !match ? true : false;
  if (!party) soloButton.hidden = true;
  soloButton.textContent = playingSolo && match ? 'Watch party battle' : 'Practice solo';
  const view = container.querySelector<HTMLElement>('.war-view')!;
  view.hidden = !!party && !match && !playingSolo;
  if (!match || playingSolo) {
    const s = solo;
    if (!s) {
      status.textContent = 'Warming up…';
      return;
    }
    if (s.finished) {
      const winner = s.snakes.find((x) => x.id === s.winner);
      const youWon = s.winner === YOU;
      status.textContent = youWon
        ? `🏆 You win! ${s.snakes[0]!.food} food · length ${s.snakes[0]!.body.length}. Play again?`
        : `${winner ? displayName(winner.id) : 'Nobody'} wins the practice. You ${s.snakes[0]!.alive ? 'survived' : 'crashed'} with ${s.snakes[0]!.food} food.`;
    } else {
      status.textContent = `Practice vs ${BOT_NAMES.length} bots · length ${s.snakes[0]!.body.length} · ${s.snakes[0]!.food} food`;
    }
    return;
  }
  const state = match.state;
  if (!connected) {
    status.textContent = 'Reconnecting… steering paused until your seat is restored.';
    return;
  }
  if (state.finished) {
    const winner = state.winner ? displayName(state.winner) : null;
    status.textContent = winner ? `🏆 ${winner} wins! Host: Back to game menu for a rematch.` : 'Draw! Host: Back to game menu for a rematch.';
    return;
  }
  if (!isPlayer) {
    status.textContent = `Watching ${aliveHud.textContent}.`;
    return;
  }
  const me = state.snakes.find((s) => s.id === playerId);
  if (me && !me.alive) {
    status.textContent = 'You crashed! Spectating the survivors…';
    return;
  }
  status.textContent = `Last snake wins · ${state.snakes.filter((s) => s.alive).length} left · length ${me?.body.length ?? 0}`;
}

session.onState((state) => {
  if (playingSolo) return;
  syncServer(state);
});
session.subscribe(render);
session.onError((message) => {
  status.textContent = message;
});

startSolo();
if (session.current.match) playingSolo = false;
void game.boot().catch((error) => {
  status.textContent = String(error);
  game.destroy();
});
