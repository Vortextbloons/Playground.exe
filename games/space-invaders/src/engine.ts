export let WORLD_W = 480;
export let WORLD_H = 640;
export let PLAYER_Y = 568;
export const PLAYER_W = 40;
export const PLAYER_H = 22;
export const PLAYER_SPEED = 300;
export const PLAYER_COOLDOWN = 0.26;
export const MAX_PLAYER_BULLETS = 3;

export const INVADER_W = 28;
export const INVADER_H = 20;
export const INVADER_COLS = 9;
export const INVADER_ROWS = 5;
export const INVADER_HGAP = 14;
export const INVADER_VGAP = 16;
export let INVADER_ORIGIN_Y = 92;
export const INVADER_DROP = 18;
export const INVADER_MARGIN = 16;

export const BULLET_W = 4;
export const BULLET_H = 12;
export const PLAYER_BULLET_SPEED = -480;
export const ENEMY_BULLET_W = 4;
export const ENEMY_BULLET_H = 12;

export const BUNKER_COUNT = 4;
export const BUNKER_W = 54;
export const BUNKER_H = 36;
export const BUNKER_CELL = 6;
export const BUNKER_COLS = BUNKER_W / BUNKER_CELL;
export const BUNKER_ROWS = BUNKER_H / BUNKER_CELL;
export let BUNKER_Y = 468;

/** Pick a portrait or landscape world and rescale the layout to match. */
export function setWorldSize(width: number, height: number): void {
  WORLD_W = Math.round(width);
  WORLD_H = Math.round(height);
  PLAYER_Y = WORLD_H - 72;
  INVADER_ORIGIN_Y = Math.round(WORLD_H * 0.144);
  BUNKER_Y = WORLD_H - 172;
}

export type Phase = 'ready' | 'playing' | 'waveclear' | 'over';

export interface Invader {
  col: number;
  row: number;
  x: number;
  y: number;
  points: number;
  alive: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vy: number;
  enemy: boolean;
}

export interface Bunker {
  x: number;
  y: number;
  cells: boolean[];
}

export interface InvaderState {
  phase: Phase;
  time: number;
  score: number;
  lives: number;
  wave: number;
  playerX: number;
  cooldown: number;
  shieldT: number;
  waveT: number;
  dir: 1 | -1;
  invaders: Invader[];
  bullets: Bullet[];
  bunkers: Bunker[];
  fireT: number;
}

export interface StepInput {
  left: boolean;
  right: boolean;
  shoot: boolean;
}

export type StepEvent =
  | 'playerShot'
  | 'invaderKilled'
  | 'bunkerHit'
  | 'playerHit'
  | 'waveClear'
  | 'gameOver';

export function pointsForRow(row: number): number {
  if (row <= 0) return 30;
  if (row <= 2) return 20;
  return 10;
}

export function marchSpeed(state: InvaderState): number {
  const total = INVADER_COLS * INVADER_ROWS;
  const alive = state.invaders.reduce((n, inv) => n + (inv.alive ? 1 : 0), 0);
  const killedRatio = 1 - alive / total;
  return 26 + state.wave * 7 + killedRatio * 110;
}

function formationGeometry(state: InvaderState): void {
  const span = INVADER_COLS * INVADER_W + (INVADER_COLS - 1) * INVADER_HGAP;
  const originX = Math.round((WORLD_W - span) / 2);
  state.invaders = [];
  for (let row = 0; row < INVADER_ROWS; row++) {
    for (let col = 0; col < INVADER_COLS; col++) {
      state.invaders.push({
        col,
        row,
        x: originX + col * (INVADER_W + INVADER_HGAP),
        y: INVADER_ORIGIN_Y + row * (INVADER_H + INVADER_VGAP),
        points: pointsForRow(row),
        alive: true,
      });
    }
  }
}

function makeBunkers(): Bunker[] {
  const bunkers: Bunker[] = [];
  const gap = (WORLD_W - BUNKER_COUNT * BUNKER_W) / (BUNKER_COUNT + 1);
  for (let i = 0; i < BUNKER_COUNT; i++) {
    const x = Math.round(gap + i * (BUNKER_W + gap));
    const cells = new Array<boolean>(BUNKER_COLS * BUNKER_ROWS).fill(true);
    for (let r = BUNKER_ROWS - 2; r < BUNKER_ROWS; r++) {
      for (let c = 3; c <= 5; c++) cells[r * BUNKER_COLS + c] = false;
    }
    bunkers.push({ x, y: BUNKER_Y, cells });
  }
  return bunkers;
}

export function createInitialState(): InvaderState {
  const state: InvaderState = {
    phase: 'ready',
    time: 0,
    score: 0,
    lives: 3,
    wave: 1,
    playerX: WORLD_W / 2,
    cooldown: 0,
    shieldT: 0,
    waveT: 0,
    dir: 1,
    invaders: [],
    bullets: [],
    bunkers: [],
    fireT: 1.2,
  };
  formationGeometry(state);
  state.bunkers = makeBunkers();
  return state;
}

export function startWave(state: InvaderState, wave: number): void {
  state.wave = wave;
  state.dir = 1;
  state.bullets = [];
  state.fireT = 1;
  state.cooldown = 0;
  formationGeometry(state);
  state.bunkers = makeBunkers();
}

function damageBunker(bunker: Bunker, hitX: number, hitY: number, radius: number): boolean {
  let hit = false;
  for (let r = 0; r < BUNKER_ROWS; r++) {
    for (let c = 0; c < BUNKER_COLS; c++) {
      const index = r * BUNKER_COLS + c;
      if (!bunker.cells[index]) continue;
      const cx = bunker.x + c * BUNKER_CELL + BUNKER_CELL / 2;
      const cy = bunker.y + r * BUNKER_CELL + BUNKER_CELL / 2;
      if (Math.abs(cx - hitX) <= radius + BUNKER_CELL / 2 && Math.abs(cy - hitY) <= radius + BUNKER_CELL / 2) {
        bunker.cells[index] = false;
        hit = true;
      }
    }
  }
  return hit;
}

function bunkerAt(state: InvaderState, x: number, y: number): Bunker | null {
  for (const bunker of state.bunkers) {
    if (x >= bunker.x - BULLET_W && x <= bunker.x + BUNKER_W + BULLET_W && y >= bunker.y - BULLET_H && y <= bunker.y + BUNKER_H + BULLET_H) {
      return bunker;
    }
  }
  return null;
}

function enemyFireInterval(state: InvaderState): number {
  const total = INVADER_COLS * INVADER_ROWS;
  const alive = state.invaders.reduce((n, inv) => n + (inv.alive ? 1 : 0), 0);
  const pressure = 1 - alive / total;
  return Math.max(0.26, 0.95 - state.wave * 0.07 - pressure * 0.35);
}

function pickShooter(state: InvaderState, rand: () => number): Invader | null {
  const byCol = new Map<number, Invader>();
  for (const inv of state.invaders) {
    if (!inv.alive) continue;
    const current = byCol.get(inv.col);
    if (!current || inv.y > current.y) byCol.set(inv.col, inv);
  }
  const shooters = [...byCol.values()];
  if (shooters.length === 0) return null;
  return shooters[Math.floor(rand() * shooters.length)]!;
}

export function step(state: InvaderState, dt: number, input: StepInput, rand: () => number = Math.random): StepEvent[] {
  const events: StepEvent[] = [];
  const clamped = Math.min(Math.max(dt, 0), 0.05);
  state.time += clamped;
  if (state.phase === 'ready' || state.phase === 'over') return events;
  if (state.phase === 'waveclear') {
    state.waveT -= clamped;
    if (state.waveT <= 0) {
      startWave(state, state.wave + 1);
      state.phase = 'playing';
    } else {
      return events;
    }
  }

  if (input.left && !input.right) state.playerX -= PLAYER_SPEED * clamped;
  if (input.right && !input.left) state.playerX += PLAYER_SPEED * clamped;
  state.playerX = Math.max(PLAYER_W / 2 + 4, Math.min(WORLD_W - PLAYER_W / 2 - 4, state.playerX));
  state.cooldown = Math.max(0, state.cooldown - clamped);
  state.shieldT = Math.max(0, state.shieldT - clamped);

  const playerBullets = state.bullets.filter(b => !b.enemy).length;
  if (input.shoot && state.cooldown <= 0 && playerBullets < MAX_PLAYER_BULLETS) {
    state.bullets.push({ x: state.playerX, y: PLAYER_Y - PLAYER_H / 2 - BULLET_H, vy: PLAYER_BULLET_SPEED, enemy: false });
    state.cooldown = PLAYER_COOLDOWN;
    events.push('playerShot');
  }

  const alive = state.invaders.filter(inv => inv.alive);
  if (alive.length > 0) {
    const speed = marchSpeed(state);
    const dx = state.dir * speed * clamped;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const inv of alive) {
      minX = Math.min(minX, inv.x + dx);
      maxX = Math.max(maxX, inv.x + INVADER_W + dx);
    }
    if (minX < INVADER_MARGIN || maxX > WORLD_W - INVADER_MARGIN) {
      state.dir = state.dir === 1 ? -1 : 1;
      for (const inv of alive) inv.y += INVADER_DROP;
    } else {
      for (const inv of alive) inv.x += dx;
    }
  }

  state.fireT -= clamped;
  const enemyCount = state.bullets.filter(b => b.enemy).length;
  const maxEnemy = Math.min(5, 2 + state.wave);
  if (state.fireT <= 0 && alive.length > 0 && enemyCount < maxEnemy) {
    const shooter = pickShooter(state, rand);
    if (shooter) {
      const speed = 170 + state.wave * 14;
      state.bullets.push({ x: shooter.x + INVADER_W / 2, y: shooter.y + INVADER_H + 2, vy: speed, enemy: true });
    }
    state.fireT = enemyFireInterval(state) * (0.6 + rand() * 0.8);
  }

  const prevY = new Map<Bullet, number>();
  for (const bullet of state.bullets) prevY.set(bullet, bullet.y);
  for (const bullet of state.bullets) bullet.y += bullet.vy * clamped;
  state.bullets = state.bullets.filter(b => b.y > -20 && b.y < WORLD_H + 20);

  for (const bullet of state.bullets) {
    if (bullet.enemy) continue;
    const bunker = bunkerAt(state, bullet.x, bullet.y);
    if (bunker && damageBunker(bunker, bullet.x, bullet.y, 7)) {
      bullet.y = -100;
      events.push('bunkerHit');
    }
  }
  for (const bullet of state.bullets) {
    if (!bullet.enemy) continue;
    const bunker = bunkerAt(state, bullet.x, bullet.y);
    if (bunker && damageBunker(bunker, bullet.x, bullet.y, 7)) {
      bullet.y = WORLD_H + 100;
      events.push('bunkerHit');
    }
  }

  const remaining: Bullet[] = [];
  const deadBullets = new Set<Bullet>();
  for (const bullet of state.bullets) {
    if (bullet.y <= -19 || bullet.y >= WORLD_H + 19) {
      deadBullets.add(bullet);
      continue;
    }
    remaining.push(bullet);
  }
  state.bullets = remaining;

  for (const bullet of [...state.bullets]) {
    if (bullet.enemy || deadBullets.has(bullet)) continue;
    const sweptTop = Math.min(bullet.y, prevY.get(bullet) ?? bullet.y);
    const sweptBottom = Math.max(bullet.y + BULLET_H, (prevY.get(bullet) ?? bullet.y) + BULLET_H);
    for (const inv of state.invaders) {
      if (!inv.alive) continue;
      if (bullet.x + BULLET_W / 2 >= inv.x && bullet.x - BULLET_W / 2 <= inv.x + INVADER_W && sweptTop <= inv.y + INVADER_H && sweptBottom >= inv.y) {
        inv.alive = false;
        state.score += inv.points;
        deadBullets.add(bullet);
        events.push('invaderKilled');
        break;
      }
    }
    if (!deadBullets.has(bullet)) {
      for (const other of state.bullets) {
        if (!other.enemy || deadBullets.has(other)) continue;
        if (Math.abs(bullet.x - other.x) < BULLET_W + 2 && Math.abs(bullet.y - other.y) < BULLET_H) {
          deadBullets.add(bullet);
          deadBullets.add(other);
          break;
        }
      }
    }
  }
  state.bullets = state.bullets.filter(b => !deadBullets.has(b));

  if (state.shieldT <= 0) {
    const px0 = state.playerX - PLAYER_W / 2;
    const px1 = state.playerX + PLAYER_W / 2;
    const pt0 = PLAYER_Y - PLAYER_H / 2;
    const pt1 = PLAYER_Y + PLAYER_H / 2;
    for (const bullet of state.bullets) {
      if (!bullet.enemy) continue;
      const sweptTop = Math.min(bullet.y, prevY.get(bullet) ?? bullet.y);
      const sweptBottom = Math.max(bullet.y + ENEMY_BULLET_H, (prevY.get(bullet) ?? bullet.y) + ENEMY_BULLET_H);
      if (bullet.x >= px0 && bullet.x <= px1 && sweptBottom >= pt0 && sweptTop <= pt1) {
        deadBullets.add(bullet);
        state.lives -= 1;
        state.bullets = state.bullets.filter(b => !b.enemy || !deadBullets.has(b));
        if (state.lives <= 0) {
          state.lives = 0;
          state.phase = 'over';
          events.push('playerHit', 'gameOver');
        } else {
          state.shieldT = 2;
          state.bullets = state.bullets.filter(b => !b.enemy);
          events.push('playerHit');
        }
        break;
      }
    }
  }

  for (const inv of state.invaders) {
    if (!inv.alive) continue;
    const bunker = bunkerAt(state, inv.x + INVADER_W / 2, inv.y + INVADER_H);
    if (bunker) damageBunker(bunker, inv.x + INVADER_W / 2, inv.y + INVADER_H, 14);
    if (inv.y + INVADER_H >= PLAYER_Y - PLAYER_H / 2 - 4) {
      state.phase = 'over';
      events.push('gameOver');
      break;
    }
  }

  if (state.phase === 'playing' && state.invaders.every(inv => !inv.alive)) {
    state.score += 100 * state.wave;
    state.phase = 'waveclear';
    state.waveT = 2;
    events.push('waveClear');
  }

  return events;
}
