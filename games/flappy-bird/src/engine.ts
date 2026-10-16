export const WORLD_W = 480;
export const WORLD_H = 640;
export const GROUND_H = 96;
export const BIRD_X = 140;
export const BIRD_R = 16;
export const GRAVITY = 1900;
export const FLAP_VY = -560;
export const MAX_FALL = 760;
export const PIPE_W = 78;
export const PIPE_SPACING = 292;
export const BASE_SPEED = 178;
export const BASE_GAP = 172;
export const MIN_GAP = 148;

export interface Pipe {
  x: number;
  gapY: number;
  gap: number;
  scored: boolean;
}

export interface FlappyState {
  phase: 'ready' | 'playing' | 'dead';
  birdY: number;
  birdVy: number;
  pipes: Pipe[];
  score: number;
  groundX: number;
  time: number;
  flash: number;
}

export function speedFor(score: number): number {
  return Math.min(268, BASE_SPEED + score * 2.2);
}

export function gapFor(score: number): number {
  return Math.max(MIN_GAP, BASE_GAP - score * 0.9);
}

function randomGapY(gap: number, rand: () => number = Math.random): number {
  const margin = 90;
  const top = margin + gap / 2;
  const bottom = WORLD_H - GROUND_H - margin - gap / 2;
  return top + rand() * Math.max(40, bottom - top);
}

export function createInitialState(): FlappyState {
  return {
    phase: 'ready',
    birdY: WORLD_H / 2 - 40,
    birdVy: 0,
    pipes: [],
    score: 0,
    groundX: 0,
    time: 0,
    flash: 0,
  };
}

export function spawnPipe(state: FlappyState, rand: () => number = Math.random): void {
  const gap = gapFor(state.score);
  const lastX = state.pipes.length > 0 ? state.pipes[state.pipes.length - 1]!.x : WORLD_W + 40;
  state.pipes.push({ x: Math.max(WORLD_W + 40, lastX + PIPE_SPACING), gapY: randomGapY(gap, rand), gap, scored: false });
}

export function flap(state: FlappyState): void {
  if (state.phase === 'ready') {
    state.phase = 'playing';
    state.pipes = [];
    spawnPipe(state);
  }
  if (state.phase !== 'playing') return;
  state.birdVy = FLAP_VY;
}

export function circleHitsPipe(birdY: number, pipe: Pipe): boolean {
  const topH = pipe.gapY - pipe.gap / 2;
  const botY = pipe.gapY + pipe.gap / 2;
  const left = pipe.x;
  const right = pipe.x + PIPE_W;
  const cx = Math.max(left, Math.min(BIRD_X, right));
  const inTop = cx >= left && cx <= right && birdY - BIRD_R < topH && birdY + BIRD_R > 0;
  const inBottom = cx >= left && cx <= right && birdY + BIRD_R > botY && birdY - BIRD_R < WORLD_H;
  if (cx !== BIRD_X) {
    const dx = BIRD_X - cx;
    const dyTop = birdY - Math.min(Math.max(birdY, 0), topH);
    const dyBot = birdY - Math.min(Math.max(birdY, botY), WORLD_H);
    if (inTop && dx * dx + dyTop * dyTop < BIRD_R * BIRD_R) return true;
    if (inBottom && dx * dx + dyBot * dyBot < BIRD_R * BIRD_R) return true;
    return false;
  }
  return inTop || inBottom;
}

/** Advance physics by dt seconds. Returns 'scored' | 'died' | null. */
export function step(state: FlappyState, dt: number): 'scored' | 'died' | null {
  const clamped = Math.min(dt, 1 / 30);
  state.time += clamped;
  if (state.flash > 0) state.flash = Math.max(0, state.flash - clamped);
  if (state.phase === 'ready') {
    state.birdY = WORLD_H / 2 - 40 + Math.sin(state.time * 3.2) * 8;
    state.groundX = (state.groundX + BASE_SPEED * clamped) % 48;
    return null;
  }
  if (state.phase !== 'playing') {
    state.groundX = state.groundX % 48;
    return null;
  }
  const speed = speedFor(state.score);
  state.birdVy = Math.min(MAX_FALL, state.birdVy + GRAVITY * clamped);
  state.birdY += state.birdVy * clamped;
  state.groundX = (state.groundX + speed * clamped) % 48;

  for (const pipe of state.pipes) pipe.x -= speed * clamped;
  while (state.pipes.length > 0 && state.pipes[0]!.x + PIPE_W < -20) state.pipes.shift();
  const last = state.pipes[state.pipes.length - 1];
  if (!last || last.x + PIPE_SPACING < WORLD_W + 40) spawnPipe(state);

  let result: 'scored' | 'died' | null = null;
  for (const pipe of state.pipes) {
    if (!pipe.scored && pipe.x + PIPE_W < BIRD_X - BIRD_R) {
      pipe.scored = true;
      state.score += 1;
      result = 'scored';
    }
    if (circleHitsPipe(state.birdY, pipe)) {
      state.phase = 'dead';
      state.flash = 0.35;
      return 'died';
    }
  }
  if (state.birdY - BIRD_R <= 0) {
    state.birdY = BIRD_R;
    state.birdVy = Math.max(state.birdVy, 0);
  }
  if (state.birdY + BIRD_R >= WORLD_H - GROUND_H) {
    state.birdY = WORLD_H - GROUND_H - BIRD_R;
    state.phase = 'dead';
    state.flash = 0.35;
    return 'died';
  }
  return result;
}
