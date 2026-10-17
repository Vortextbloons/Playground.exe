import { BIG_WIN, MIN_BET } from '../core/economy';
import { asRecord, readInt } from '../core/parse';
import { randomBelow } from '../core/rng';
import type { Engine, EngineSummary } from '../core/types';

export const SLOTS_LIMIT = 16;
export const SLOTS_BETS: readonly number[] = [1, 5, 10];
export const JACKPOT_SEED = 500;
export const JACKPOT_RATE = 0.05;

export const SLOT_SYMBOLS = ['seven', 'diamond', 'bar', 'bell', 'lemon', 'cherry'] as const;
export const SLOT_SYMBOL_NAMES = ['Seven', 'Diamond', 'Bar', 'Bell', 'Lemon', 'Cherry'] as const;
export const SLOT_PAYTABLE: readonly number[] = [8, 5, 3, 2, 1.2, 0.8];

const STRIP: readonly number[] = [
  1, 1, 5, 0, 5, 0, 0, 2, 3, 4, 5, 1, 0, 2, 3, 4, 5, 1, 0, 2, 3, 4, 5, 1, 0, 2, 3,
  4, 5, 1, 0, 2, 3, 4, 0, 2, 3, 4, 0, 2, 3, 4, 0, 2, 3, 4, 0, 2, 3, 0, 2, 0, 0, 5,
];

export const SLOTS_REELS: readonly (readonly number[])[] = [STRIP, STRIP, STRIP];

export const SLOTS_LINES = [
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
] as const;

const DIAMOND = 1;
const JACKPOT_BET = 10;

export type SlotMachine = {
  grid: number[][];
  lines: number[];
  win: number;
};

export type SlotsState = {
  occupants: string[];
  machines: Record<string, SlotMachine>;
  pot: number;
};

export type SlotsView = {
  grid: number[][];
  lines: number[];
  win: number;
  machines: { id: string; lastWin: number }[];
  jackpot: number;
  bets: number[];
  limit: number;
};

function freshMachine(): SlotMachine {
  return { grid: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], lines: [], win: 0 };
}

function stopGrid(stops: readonly number[]): number[][] {
  return [0, 1, 2].map(row =>
    SLOTS_REELS.map((strip, reel) => {
      const stop = stops[reel]!;
      return strip[(stop + row + strip.length - 1) % strip.length]!;
    }),
  );
}

function cell(grid: number[][], row: number, col: number): number {
  return grid[row]![col]!;
}

export const slotsEngine: Engine<SlotsState> = {
  id: 'slots',
  create() {
    return { occupants: [], machines: {}, pot: JACKPOT_SEED };
  },
  join(state, playerId) {
    if (state.occupants.includes(playerId)) return;
    if (state.occupants.length >= SLOTS_LIMIT) throw new Error('Table is full.');
    state.occupants.push(playerId);
    state.machines[playerId] = freshMachine();
  },
  leave(state, playerId) {
    state.occupants = state.occupants.filter(id => id !== playerId);
    delete state.machines[playerId];
  },
  act(state, playerId, name, payload, ctx) {
    if (name !== 'spin') throw new Error('Unknown action.');
    const machine = state.machines[playerId];
    if (!machine) throw new Error('You are not at this table.');
    const bet = readInt(asRecord(payload), 'bet', MIN_BET, JACKPOT_BET);
    if (!SLOTS_BETS.includes(bet)) throw new Error('Invalid bet.');
    if (bet > ctx.bankroll(playerId)) throw new Error('Not enough chips.');

    const stops = SLOTS_REELS.map(strip => randomBelow(ctx.entropy, strip.length));
    const grid = stopGrid(stops);
    const lines: number[] = [];
    let win = 0;
    SLOTS_LINES.forEach((line, index) => {
      const symbol = cell(grid, line[0][0], line[0][1]);
      if (symbol !== cell(grid, line[1][0], line[1][1])) return;
      if (symbol !== cell(grid, line[2][0], line[2][1])) return;
      lines.push(index);
      win += Math.floor(bet * SLOT_PAYTABLE[symbol]!);
    });

    state.pot += Math.floor(bet * JACKPOT_RATE);
    let jackpotWin = 0;
    if (bet === JACKPOT_BET && grid[1]!.every(symbol => symbol === DIAMOND)) {
      jackpotWin = state.pot;
      state.pot = JACKPOT_SEED;
      win += jackpotWin - Math.floor(bet * SLOT_PAYTABLE[DIAMOND]!);
    }

    ctx.cash(playerId, -bet);
    ctx.cash(playerId, win);
    ctx.result(playerId, 'slots', win - bet);
    if (jackpotWin > 0) ctx.announce('jackpot', playerId, jackpotWin);
    else if (win >= BIG_WIN || win >= bet * 10) ctx.announce('bigwin', playerId, win);

    machine.grid = grid;
    machine.lines = lines;
    machine.win = win;
  },
  tick() {},
  settle() {},
  pending() { return false; },
  occupants(state) { return [...state.occupants]; },
  view(state, viewerId): SlotsView {
    const machine = viewerId === null ? undefined : state.machines[viewerId];
    return {
      grid: machine?.grid ?? [],
      lines: machine?.lines ?? [],
      win: machine?.win ?? 0,
      machines: state.occupants.map(id => ({ id, lastWin: state.machines[id]!.win })),
      jackpot: state.pot,
      bets: [...SLOTS_BETS],
      limit: SLOTS_LIMIT,
    };
  },
  summary(state): EngineSummary {
    return {
      mode: state.occupants.length >= 2 ? 'shared' : 'solo',
      limit: SLOTS_LIMIT,
      info: { jackpot: state.pot },
    };
  },
};
