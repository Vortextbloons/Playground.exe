import { BIG_WIN } from '../core/economy';
import { asRecord, readChoice, readInt } from '../core/parse';
import { mulberry32 } from '../core/rng';
import type { Engine, EngineSummary } from '../core/types';

const RISKS = ['low', 'medium', 'high'] as const;

export type Risk = typeof RISKS[number];

export const PLINKO_LIMIT = 16;
export const PLINKO_ROWS = 12;
export const PLINKO_MIN = 1;
export const PLINKO_MAX = 100;

const BALL_CAP = 24;

export const RISK_TABLES: Record<Risk, number[]> = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};

export function simulateDrop(seed: number, rows: number): number {
  const rng = mulberry32(seed >>> 0);
  let slot = 0;
  for (let row = 0; row < rows; row += 1) {
    if (rng() >= 0.5) slot += 1;
  }
  return slot;
}

export type PlinkoBall = {
  id: number;
  playerId: string;
  bet: number;
  risk: Risk;
  seed: number;
  slot: number;
  win: number;
  at: number;
};

export type PlinkoState = {
  occupants: string[];
  balls: PlinkoBall[];
  nextId: number;
};

export type PlinkoView = {
  balls: PlinkoBall[];
  mine: PlinkoBall[];
  limit: number;
  min: number;
  max: number;
  rows: number;
};

export const plinkoEngine: Engine<PlinkoState> = {
  id: 'plinko',
  create() {
    return { occupants: [], balls: [], nextId: 1 };
  },
  join(state, playerId) {
    if (state.occupants.includes(playerId)) return;
    if (state.occupants.length >= PLINKO_LIMIT) throw new Error('Table is full.');
    state.occupants.push(playerId);
  },
  leave(state, playerId) {
    state.occupants = state.occupants.filter(id => id !== playerId);
  },
  act(state, playerId, name, payload, ctx) {
    if (name !== 'drop') throw new Error('Unknown action.');
    const record = asRecord(payload);
    const bet = readInt(record, 'bet', PLINKO_MIN, PLINKO_MAX);
    const risk = readChoice(record, 'risk', RISKS);
    if (bet > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
    const seed = ctx.entropy() >>> 0;
    const slot = simulateDrop(seed, PLINKO_ROWS);
    const multiplier = RISK_TABLES[risk][slot]!;
    const win = Math.floor(bet * multiplier);
    ctx.cash(playerId, -bet);
    ctx.cash(playerId, win);
    ctx.result(playerId, 'plinko', win - bet);
    if (win >= BIG_WIN || multiplier >= 10) ctx.announce('bigwin', playerId, win);
    state.balls.push({ id: state.nextId, playerId, bet, risk, seed, slot, win, at: ctx.now });
    state.nextId += 1;
    if (state.balls.length > BALL_CAP) state.balls.splice(0, state.balls.length - BALL_CAP);
  },
  tick() {},
  settle() {},
  pending() { return false; },
  occupants(state) { return [...state.occupants]; },
  view(state, viewerId) {
    return {
      balls: state.balls,
      mine: viewerId === null ? [] : state.balls.filter(ball => ball.playerId === viewerId),
      limit: PLINKO_LIMIT,
      min: PLINKO_MIN,
      max: PLINKO_MAX,
      rows: PLINKO_ROWS,
    };
  },
  summary(state): EngineSummary {
    return {
      mode: state.occupants.length >= 2 ? 'shared' : 'solo',
      limit: PLINKO_LIMIT,
      info: { balls: state.balls.length },
    };
  },
};
