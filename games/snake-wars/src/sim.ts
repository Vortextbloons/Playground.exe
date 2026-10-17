export const WIDTH = 48;
export const HEIGHT = 30;
export const STEP_MS = 100;
export const START_LEN = 5;
export const SHRINK_START_TICKS = 300;
export const SHRINK_EVERY_TICKS = 150;
export const WARN_TICKS = 30;
export const TIME_LIMIT_TICKS = 1800;
export const TURBO_TICKS = 15;
export const GHOST_TICKS = 30;

export type Dir = 'up' | 'down' | 'left' | 'right';
export type PowerKind = 'turbo' | 'ghost';

export type Snake = {
  id: string;
  body: number[];
  dir: Dir;
  want: Dir;
  alive: boolean;
  food: number;
  kills: number;
  power: PowerKind | null;
  turbo: number;
  ghost: number;
};

export type Item = {
  kind: PowerKind;
  at: number;
};

export type ArenaState = {
  tick: number;
  lastTick: number;
  rng: number;
  snakes: Snake[];
  food: number[];
  items: Item[];
  ring: number;
  warnRing: number;
  warnUntil: number;
  winner: string | null;
  finished: boolean;
  nextItemIn: number;
}

export function idx(x: number, y: number): number {
  return y * WIDTH + x;
}

export function opposite(a: Dir, b: Dir): boolean {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}

function rand(state: ArenaState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function takenTiles(state: ArenaState): Set<number> {
  const set = new Set<number>();
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    for (const cell of snake.body) set.add(cell);
  }
  for (const f of state.food) set.add(f);
  for (const item of state.items) set.add(item.at);
  return set;
}

function freeTile(state: ArenaState): number | null {
  const taken = takenTiles(state);
  const ring = Math.max(state.ring, state.warnRing);
  for (let tries = 0; tries < 60; tries++) {
    const spanX = WIDTH - ring * 2;
    const spanY = HEIGHT - ring * 2;
    if (spanX <= 0 || spanY <= 0) return null;
    const at = idx(ring + Math.floor(rand(state) * spanX), ring + Math.floor(rand(state) * spanY));
    if (!taken.has(at)) return at;
  }
  return null;
}

function spawnFood(state: ArenaState, count: number): void {
  for (let i = 0; i < count; i++) {
    const at = freeTile(state);
    if (at === null) return;
    state.food.push(at);
  }
}

const SPAWNS: { x: number; y: number; dir: Dir }[] = [
  { x: 6, y: 6, dir: 'right' },
  { x: 41, y: 23, dir: 'left' },
  { x: 41, y: 6, dir: 'left' },
  { x: 6, y: 23, dir: 'right' },
  { x: 24, y: 4, dir: 'down' },
  { x: 24, y: 25, dir: 'up' },
  { x: 4, y: 15, dir: 'right' },
  { x: 43, y: 15, dir: 'left' },
  { x: 14, y: 10, dir: 'down' },
  { x: 33, y: 19, dir: 'up' },
  { x: 33, y: 10, dir: 'down' },
  { x: 14, y: 19, dir: 'up' },
];

const DX: Record<Dir, number> = { up: 0, down: 0, left: -1, right: 1 };
const DY: Record<Dir, number> = { up: -1, down: 1, left: 0, right: 0 };

export function createInitial(ids: string[], seed: number, now: number): ArenaState {
  const state: ArenaState = {
    tick: 0,
    lastTick: now,
    rng: seed | 0,
    snakes: [],
    food: [],
    items: [],
    ring: 0,
    warnRing: 0,
    warnUntil: 0,
    winner: null,
    finished: false,
    nextItemIn: 100,
  };
  ids.forEach((id, i) => {
    const spawn = SPAWNS[i % SPAWNS.length]!;
    const body: number[] = [];
    for (let s = 0; s < START_LEN; s++) {
      body.push(idx(spawn.x - DX[spawn.dir] * s, spawn.y - DY[spawn.dir] * s));
    }
    state.snakes.push({
      id,
      body,
      dir: spawn.dir,
      want: spawn.dir,
      alive: true,
      food: 0,
      kills: 0,
      power: null,
      turbo: 0,
      ghost: 0,
    });
  });
  spawnFood(state, Math.max(8, ids.length * 3));
  return state;
}

export function setDirection(state: ArenaState, id: string, dir: Dir): boolean {
  const snake = state.snakes.find((s) => s.id === id);
  if (!snake || !snake.alive || state.finished) return false;
  if (dir === snake.dir || dir === snake.want) return true;
  if (opposite(dir, snake.dir)) return false;
  snake.want = dir;
  return true;
}

export function activatePower(state: ArenaState, id: string): boolean {
  const snake = state.snakes.find((s) => s.id === id);
  if (!snake || !snake.alive || !snake.power || state.finished) return false;
  if (snake.power === 'turbo') snake.turbo = TURBO_TICKS;
  else snake.ghost = GHOST_TICKS;
  snake.power = null;
  return true;
}

function inDanger(x: number, y: number, ring: number): boolean {
  return x < ring || y < ring || x >= WIDTH - ring || y >= HEIGHT - ring;
}

function moveHeads(state: ArenaState): Map<string, number> {
  const heads = new Map<string, number>();
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    snake.dir = snake.want;
    const head = snake.body[0]!;
    const x = head % WIDTH;
    const y = Math.floor(head / WIDTH);
    heads.set(snake.id, idx(x + DX[snake.dir], y + DY[snake.dir]));
  }
  return heads;
}

function resolveMove(state: ArenaState, heads: Map<string, number>, lethal: number): Set<string> {
  const counts = new Map<number, number>();
  for (const at of heads.values()) counts.set(at, (counts.get(at) ?? 0) + 1);
  const growing = new Set<string>();
  for (const [id, at] of heads) {
    if (state.food.includes(at)) growing.add(id);
  }
  const solid = new Set<number>();
  for (const snake of state.snakes) {
    if (!snake.alive || !heads.has(snake.id)) continue;
    const end = growing.has(snake.id) ? snake.body.length : snake.body.length - 1;
    for (let i = 0; i < end; i++) solid.add(snake.body[i]!);
  }
  const died = new Set<string>();
  for (const snake of state.snakes) {
    if (!snake.alive || !heads.has(snake.id)) continue;
    const at = heads.get(snake.id)!;
    const x = at % WIDTH;
    const y = Math.floor(at / WIDTH);
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || inDanger(x, y, lethal)) {
      died.add(snake.id);
      continue;
    }
    if ((counts.get(at) ?? 0) > 1) {
      died.add(snake.id);
      continue;
    }
    if (snake.ghost <= 0 && solid.has(at)) died.add(snake.id);
  }
  return died;
}

function applyMove(state: ArenaState, heads: Map<string, number>, died: Set<string>): void {
  for (const snake of state.snakes) {
    if (!snake.alive || !heads.has(snake.id)) continue;
    if (died.has(snake.id)) {
      snake.alive = false;
      let added = 0;
      for (let i = 0; i < snake.body.length && added < 10; i += 2) {
        const at = snake.body[i]!;
        if (!state.food.includes(at) && state.food.length < 60) {
          state.food.push(at);
          added++;
        }
      }
      continue;
    }
    const at = heads.get(snake.id)!;
    const foodIndex = state.food.indexOf(at);
    if (foodIndex >= 0) {
      state.food.splice(foodIndex, 1);
      snake.food++;
      snake.body.unshift(at);
      const fresh = freeTile(state);
      if (fresh !== null) state.food.push(fresh);
    } else {
      snake.body.unshift(at);
      snake.body.pop();
      const itemIndex = state.items.findIndex((item) => item.at === at);
      if (itemIndex >= 0 && snake.power === null) {
        snake.power = state.items[itemIndex]!.kind;
        state.items.splice(itemIndex, 1);
      }
    }
  }
}

function stepOnce(state: ArenaState): void {
  if (state.finished) return;
  state.tick++;
  if (state.warnRing > state.ring && state.tick >= state.warnUntil) {
    state.ring = state.warnRing;
  } else if (
    state.warnRing === state.ring &&
    state.tick >= SHRINK_START_TICKS &&
    (state.tick - SHRINK_START_TICKS) % SHRINK_EVERY_TICKS === 0
  ) {
    const maxRing = Math.floor(Math.min(WIDTH, HEIGHT) / 2) - 3;
    if (state.ring < maxRing) {
      state.warnRing = state.ring + 1;
      state.warnUntil = state.tick + WARN_TICKS;
    }
  }
  const heads = moveHeads(state);
  const died = resolveMove(state, heads, state.ring);
  applyMove(state, heads, died);
  const boosted = state.snakes.filter((s) => s.alive && s.turbo > 0 && !died.has(s.id));
  if (boosted.length) {
    const extra = new Map<string, number>();
    for (const snake of boosted) {
      snake.dir = snake.want;
      const head = snake.body[0]!;
      const x = head % WIDTH;
      const y = Math.floor(head / WIDTH);
      extra.set(snake.id, idx(x + DX[snake.dir], y + DY[snake.dir]));
    }
    applyMove(state, extra, resolveMove(state, extra, state.ring));
  }
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    if (snake.turbo > 0) snake.turbo--;
    if (snake.ghost > 0) snake.ghost--;
  }
  state.nextItemIn--;
  if (state.nextItemIn <= 0) {
    state.nextItemIn = 100 + Math.floor(rand(state) * 50);
    if (state.items.length < 3) {
      const at = freeTile(state);
      if (at !== null) state.items.push({ kind: rand(state) < 0.5 ? 'turbo' : 'ghost', at });
    }
  }
  const alive = state.snakes.filter((s) => s.alive);
  if (state.snakes.length > 1 && alive.length <= 1) {
    state.finished = true;
    state.winner = alive[0]?.id ?? null;
  } else if (state.tick >= TIME_LIMIT_TICKS) {
    state.finished = true;
    const ranked = [...state.snakes].sort((a, b) => b.food - a.food || b.body.length - a.body.length);
    state.winner = ranked[0]?.id ?? null;
  }
}

export function advanceClock(state: ArenaState, now: number): number {
  if (state.finished) {
    state.lastTick = now;
    return 0;
  }
  const elapsed = now - state.lastTick;
  if (elapsed < STEP_MS) return 0;
  const steps = Math.min(5, Math.floor(elapsed / STEP_MS));
  for (let i = 0; i < steps; i++) {
    stepOnce(state);
    if (state.finished) break;
  }
  state.lastTick += steps * STEP_MS;
  return steps;
}

export function advanceTicks(state: ArenaState, n: number): void {
  for (let i = 0; i < n; i++) {
    stepOnce(state);
    if (state.finished) break;
  }
  state.lastTick += n * STEP_MS;
}

export function aliveCount(state: ArenaState): number {
  return state.snakes.filter((s) => s.alive).length;
}

export function stateSize(state: ArenaState): number {
  return JSON.stringify(state).length;
}
