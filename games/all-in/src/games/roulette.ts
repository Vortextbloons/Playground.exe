import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { BIG_WIN } from '../core/economy';
import { asRecord, readChoice, readInt } from '../core/parse';
import { randomBelow } from '../core/rng';
import type { ActionCtx, Engine } from '../core/types';

export const ROULETTE_LIMIT = 16;
export const ROULETTE_MIN_CHIP = 1;
export const ROULETTE_MAX_CHIP = 1000;
export const ROULETTE_MAX_TOTAL = 10_000;
export const ROULETTE_MAX_CHIPS = 20;
export const ROULETTE_BET_MS = 12_000;
export const ROULETTE_RESULT_MS = 3_000;

const WHEEL_SIZE = 37;
const HISTORY_LIMIT = 8;
const MAX_BET_NUMBERS = 18;

const BET_KINDS = ['straight', 'split', 'street', 'corner', 'sixline', 'column', 'dozen', 'red', 'black', 'odd', 'even', 'low', 'high'] as const;
export type RouletteBetKind = (typeof BET_KINDS)[number];

const PAYOUTS: readonly number[] = [35, 17, 11, 8, 5, 2, 2, 1, 1, 1, 1, 1, 1];
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

type ChipState = [number, number, number];

export type RouletteChip = { kind: RouletteBetKind; numbers: number[]; amount: number };
export type RouletteRoundResult = { id: string; staked: number; returned: number; net: number };

export type RouletteState = {
  occupants: string[];
  bettable: Record<string, boolean>;
  phase: 'betting' | 'results';
  deadline: number;
  chips: Record<string, ChipState[]>;
  last: number | null;
  history: number[];
  results: [string, number, number][];
};

export type RouletteView = {
  phase: 'betting' | 'results';
  deadline: number;
  wheel: { last: number | null; history: number[] };
  chips: Record<string, RouletteChip[]>;
  lastResults: RouletteRoundResult[];
  limits: { minChip: number; maxChip: number; maxTotal: number; maxChips: number };
  yourChips: RouletteChip[];
};

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function buildSets(): number[][][] {
  const straight: number[][] = [];
  for (let value = 0; value <= 36; value += 1) straight.push([value]);
  const split: number[][] = [];
  for (let value = 1; value <= 36; value += 1) {
    if (value % 3 !== 0) split.push([value, value + 1]);
    if (value + 3 <= 36) split.push([value, value + 3]);
  }
  const street: number[][] = [];
  for (let value = 1; value <= 34; value += 3) street.push([value, value + 1, value + 2]);
  const corner: number[][] = [];
  for (let value = 1; value <= 32; value += 1) {
    if (value % 3 === 0) continue;
    corner.push([value, value + 1, value + 3, value + 4]);
  }
  const sixline: number[][] = [];
  for (let value = 1; value <= 31; value += 3) sixline.push([value, value + 1, value + 2, value + 3, value + 4, value + 5]);
  const red = [RED_NUMBERS];
  const black = [range(1, 36).filter(value => !RED_NUMBERS.includes(value))];
  const odd = [range(1, 36).filter(value => value % 2 === 1)];
  const even = [range(1, 36).filter(value => value % 2 === 0)];
  return [
    straight, split, street, corner, sixline,
    [range(1, 12), range(13, 24), range(25, 36)],
    [range(1, 12), range(13, 24), range(25, 36)],
    red, black, odd, even,
    [range(1, 18)], [range(19, 36)],
  ];
}

const BET_SETS = buildSets();

function toViewChip(chip: ChipState): RouletteChip {
  const kindIndex = chip[0];
  return { kind: BET_KINDS[kindIndex]!, numbers: [...BET_SETS[kindIndex]![chip[2]]!], amount: chip[1] };
}

function hasChips(state: RouletteState): boolean {
  for (const chips of Object.values(state.chips)) {
    if (chips.length > 0) return true;
  }
  return false;
}

function chipCount(state: RouletteState): number {
  let count = 0;
  for (const chips of Object.values(state.chips)) count += chips.length;
  return count;
}

function refreshBettable(state: RouletteState, ctx: ActionCtx): void {
  for (const playerId of state.occupants) state.bettable[playerId] = ctx.bankroll(playerId) >= ROULETTE_MIN_CHIP;
}

function bettableCount(state: RouletteState): number {
  let count = 0;
  for (const playerId of state.occupants) {
    if (state.bettable[playerId]) count += 1;
  }
  return count;
}

function isShared(state: RouletteState): boolean {
  return bettableCount(state) >= 2;
}

function openWindow(state: RouletteState, ctx: ActionCtx): void {
  if (state.phase === 'betting' && state.deadline === 0 && isShared(state)) state.deadline = ctx.now + ROULETTE_BET_MS;
}

function readBetNumbers(record: Record<string, Json>): number[] {
  const value = record.numbers;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BET_NUMBERS) throw new Error('Invalid bet.');
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 36) throw new Error('Invalid bet.');
    numbers.push(item);
  }
  return numbers;
}

function resolve(state: RouletteState, ctx: ActionCtx): void {
  const outcome = randomBelow(ctx.entropy, WHEEL_SIZE);
  state.last = outcome;
  state.history.push(outcome);
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
  const chips = state.chips;
  state.chips = {};
  const results: [string, number, number][] = [];
  for (const playerId of Object.keys(chips)) {
    const list = chips[playerId]!;
    let staked = 0;
    let returned = 0;
    for (const chip of list) {
      staked += chip[1];
      if (BET_SETS[chip[0]]![chip[2]]!.includes(outcome)) returned += chip[1] * (PAYOUTS[chip[0]]! + 1);
    }
    if (staked === 0) continue;
    if (returned > 0) ctx.cash(playerId, returned);
    const net = returned - staked;
    ctx.result(playerId, 'roulette', net);
    if (net >= BIG_WIN) ctx.announce('bigwin', playerId, net);
    results.push([playerId, staked, returned]);
  }
  state.results = results;
  state.phase = 'results';
  state.deadline = ctx.now + ROULETTE_RESULT_MS;
}

export const rouletteEngine: Engine<RouletteState> = {
  id: 'roulette',
  create() {
    return { occupants: [], bettable: {}, phase: 'betting', deadline: 0, chips: {}, last: null, history: [], results: [] };
  },
  join(state, playerId, ctx) {
    if (state.occupants.includes(playerId)) return;
    if (state.occupants.length >= ROULETTE_LIMIT) throw new Error('Table is full.');
    state.occupants.push(playerId);
    refreshBettable(state, ctx);
    openWindow(state, ctx);
  },
  leave(state, playerId, ctx) {
    const index = state.occupants.indexOf(playerId);
    if (index === -1) return;
    state.occupants.splice(index, 1);
    delete state.bettable[playerId];
    refreshBettable(state, ctx);
  },
  act(state, playerId, name, payload, ctx) {
    if (!state.occupants.includes(playerId)) throw new Error('Take a seat first.');
    refreshBettable(state, ctx);
    if (name === 'bet') {
      if (state.phase !== 'betting') throw new Error('Wait for the next round.');
      const record = asRecord(payload);
      const kind = readChoice(record, 'kind', BET_KINDS);
      const amount = readInt(record, 'amount', ROULETTE_MIN_CHIP, ROULETTE_MAX_CHIP);
      const numbers = readBetNumbers(record);
      if (amount > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
      const kindIndex = BET_KINDS.indexOf(kind);
      const setIndex = BET_SETS[kindIndex]!.findIndex(set => set.length === numbers.length && set.every((value, position) => value === numbers[position]));
      if (setIndex === -1) throw new Error('Invalid bet.');
      const existing = state.chips[playerId];
      if (existing && existing.length >= ROULETTE_MAX_CHIPS) throw new Error('Too many chips.');
      let total = 0;
      if (existing) {
        for (const chip of existing) total += chip[1];
      }
      if (total + amount > ROULETTE_MAX_TOTAL) throw new Error('Table limit reached.');
      ctx.cash(playerId, -amount);
      if (existing) existing.push([kindIndex, amount, setIndex]);
      else state.chips[playerId] = [[kindIndex, amount, setIndex]];
      return;
    }
    if (name === 'clear') {
      const chips = state.chips[playerId];
      if (!chips || chips.length === 0) return;
      let total = 0;
      for (const chip of chips) total += chip[1];
      delete state.chips[playerId];
      ctx.cash(playerId, total);
      return;
    }
    if (name === 'spin') {
      if (state.phase !== 'betting') throw new Error('Wait for the next round.');
      if (state.deadline === 0) {
        if (!(state.chips[playerId]?.length)) throw new Error('Place a bet first.');
        resolve(state, ctx);
        return;
      }
      if (!hasChips(state)) throw new Error('Place a bet first.');
      for (const id of state.occupants) {
        if (state.bettable[id] && !(state.chips[id]?.length)) throw new Error('Everyone at the table must place a bet first.');
      }
      resolve(state, ctx);
      return;
    }
    throw new Error('Unknown action.');
  },
  tick(state, ctx) {
    refreshBettable(state, ctx);
    if (state.phase === 'results') {
      if (ctx.now < state.deadline) return;
      state.phase = 'betting';
      state.deadline = isShared(state) ? ctx.now + ROULETTE_BET_MS : 0;
      return;
    }
    if (state.deadline === 0) {
      openWindow(state, ctx);
      return;
    }
    if (ctx.now < state.deadline) return;
    if (hasChips(state)) {
      resolve(state, ctx);
      return;
    }
    state.deadline = isShared(state) ? ctx.now + ROULETTE_BET_MS : 0;
  },
  settle(state, ctx) {
    if (state.phase === 'betting' && hasChips(state)) resolve(state, ctx);
  },
  pending(state, playerId) {
    return (state.chips[playerId]?.length ?? 0) > 0;
  },
  occupants(state) {
    return [...state.occupants];
  },
  view(state, viewerId) {
    const chips: Record<string, RouletteChip[]> = {};
    for (const playerId of Object.keys(state.chips)) {
      const list = state.chips[playerId]!;
      if (list.length > 0) chips[playerId] = list.map(toViewChip);
    }
    const own = viewerId !== null ? state.chips[viewerId] ?? [] : [];
    return {
      phase: state.phase,
      deadline: state.deadline,
      wheel: { last: state.last, history: [...state.history] },
      chips,
      lastResults: state.results.map(([id, staked, returned]) => ({ id, staked, returned, net: returned - staked })),
      limits: { minChip: ROULETTE_MIN_CHIP, maxChip: ROULETTE_MAX_CHIP, maxTotal: ROULETTE_MAX_TOTAL, maxChips: ROULETTE_MAX_CHIPS },
      yourChips: own.map(toViewChip),
    };
  },
  summary(state) {
    return {
      mode: isShared(state) ? 'shared' : 'solo',
      limit: ROULETTE_LIMIT,
      info: { last: state.last, staked: chipCount(state) },
    };
  },
};
