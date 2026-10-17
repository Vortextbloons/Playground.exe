import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCasino, createCasino, viewCasino } from '../games/all-in/src/core/casino.ts';
import { MATCH_MS, START_BANKROLL } from '../games/all-in/src/core/economy.ts';
import { asRecord, readInt } from '../games/all-in/src/core/parse.ts';
import type { ActionCtx, Engine, EngineRegistry, EngineSummary, TableId } from '../games/all-in/src/core/types.ts';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import {
  JACKPOT_RATE, JACKPOT_SEED, SLOTS_BETS, SLOTS_LIMIT, SLOTS_LINES, SLOTS_REELS, SLOT_PAYTABLE,
  SLOT_SYMBOLS, slotsEngine, type SlotsState, type SlotsView,
} from '../games/all-in/src/games/slots.ts';

type StubState = { occupants: string[] };

function stubEngine(id: TableId): Engine<StubState> {
  return {
    id,
    create() { return { occupants: [] }; },
    join(state, playerId) { if (!state.occupants.includes(playerId)) state.occupants.push(playerId); },
    leave(state, playerId) { state.occupants = state.occupants.filter(item => item !== playerId); },
    act(_state, playerId, name, payload, ctx) {
      if (name !== 'bet') throw new Error('Unknown action.');
      const amount = readInt(asRecord(payload), 'amount', 1, 100000);
      if (amount > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
      ctx.cash(playerId, -amount);
      ctx.result(playerId, id, -amount);
    },
    tick() {},
    settle() {},
    pending() { return false; },
    occupants(state) { return [...state.occupants]; },
    view(state) { return { ...state }; },
    summary(): EngineSummary { return { mode: 'solo', limit: 8, info: {} }; },
  };
}

function registry(): EngineRegistry {
  return {
    blackjack: stubEngine('blackjack'), roulette: stubEngine('roulette'), slots: slotsEngine,
    plinko: stubEngine('plinko'), poker: stubEngine('poker'),
  };
}

type Casino = ReturnType<typeof createCasino>;

const T0 = 1_000_000;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function scripted(values: number[], fallback: () => number): () => number {
  let at = 0;
  return () => (at < values.length ? values[at++]! : fallback());
}

function seat(engines: EngineRegistry, state: Casino, playerId: string, at: string, now: number, entropy: () => number): Casino {
  return applyCasino(engines, state, playerId, 'sit', { at } as Json, { now, entropy }).state;
}

function spin(engines: EngineRegistry, state: Casino, playerId: string, bet: number, now: number, entropy: () => number) {
  return applyCasino(engines, state, playerId, 'spin', { bet } as Json, { now, entropy });
}

function table(state: Casino): SlotsState {
  return state.tables.slots as SlotsState;
}

function render(stops: readonly number[]): number[][] {
  return [0, 1, 2].map(row =>
    SLOTS_REELS.map((strip, reel) => {
      const stop = stops[reel]!;
      return strip[(stop + row + strip.length - 1) % strip.length]!;
    }),
  );
}

function payout(grid: number[][], bet: number): { win: number; lines: number[] } {
  const lines: number[] = [];
  let win = 0;
  SLOTS_LINES.forEach((line, index) => {
    const symbol = grid[line[0][0]]![line[0][1]]!;
    if (symbol !== grid[line[1][0]]![line[1][1]]!) return;
    if (symbol !== grid[line[2][0]]![line[2][1]]!) return;
    lines.push(index);
    win += Math.floor(bet * SLOT_PAYTABLE[symbol]!);
  });
  return { win, lines };
}

test('the five-line paytable returns between 0.88 and 0.92 on every bet', () => {
  const r0 = SLOTS_REELS[0]!;
  const r1 = SLOTS_REELS[1]!;
  const r2 = SLOTS_REELS[2]!;
  const combos = r0.length * r1.length * r2.length;
  assert.ok(combos <= 200_000, `enumeration covers ${combos} combinations`);
  for (const bet of SLOTS_BETS) {
    let total = 0;
    for (let a = 0; a < r0.length; a += 1) {
      for (let b = 0; b < r1.length; b += 1) {
        for (let c = 0; c < r2.length; c += 1) {
          total += payout(render([a, b, c]), bet).win;
        }
      }
    }
    const rtp = total / combos / bet;
    assert.ok(rtp >= 0.88 && rtp <= 0.92, `bet ${bet} returns ${rtp}`);
  }
});

test('spins resolve instantly, pay the paytable, and count one round', () => {
  const engines = registry();
  const entropy = lcg(2026);
  let state = createCasino(engines, ['a'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'slots', T0, entropy);
  state.players.a!.bankroll = 10_000;
  for (let index = 0; index < 6; index += 1) {
    const bet = SLOTS_BETS[index % SLOTS_BETS.length]!;
    const before = state.players.a!.bankroll;
    const next = spin(engines, state, 'a', bet, T0 + index + 1, entropy).state;
    const machine = table(next).machines.a!;
    const expected = payout(machine.grid, bet);
    assert.equal(machine.grid.length, 3);
    assert.ok(machine.grid.every(row => row.length === 3));
    assert.ok(machine.grid.flat().every(symbol => Number.isInteger(symbol) && symbol >= 0 && symbol < SLOT_SYMBOLS.length));
    assert.equal(machine.win, expected.win);
    assert.deepEqual(machine.lines, expected.lines);
    assert.equal(next.players.a!.bankroll, before - bet + expected.win);
    assert.equal(next.players.a!.rounds, index + 1);
    assert.equal(next.players.a!.byGame.slots, index + 1);
    state = next;
  }
});

test('$10 middle-row diamonds take the pot, smaller bets just pay the line', () => {
  const engines = registry();
  const rng = lcg(7);
  let state = createCasino(engines, ['a'], { now: T0, entropy: rng });
  state = seat(engines, state, 'a', 'slots', T0, rng);

  const jackpot = spin(engines, state, 'a', 10, T0 + 1, scripted([0, 1, 0], rng)).state;
  const machine = table(jackpot).machines.a!;
  assert.deepEqual(machine.grid, [[5, 1, 5], [1, 1, 1], [1, 5, 1]]);
  assert.deepEqual(machine.lines, [1]);
  assert.equal(machine.win, JACKPOT_SEED);
  assert.equal(table(jackpot).pot, JACKPOT_SEED);
  assert.equal(jackpot.players.a!.bankroll, START_BANKROLL - 10 + JACKPOT_SEED);
  assert.equal(jackpot.players.a!.biggestWin, JACKPOT_SEED - 10);
  const item = jackpot.feed.at(-1)!;
  assert.equal(item.kind, 'jackpot');
  assert.equal(item.playerId, 'a');
  assert.equal(item.amount, JACKPOT_SEED);

  const small = spin(engines, jackpot, 'a', 5, T0 + 2, scripted([0, 1, 0], rng)).state;
  const smallMachine = table(small).machines.a!;
  assert.deepEqual(smallMachine.lines, [1]);
  assert.equal(smallMachine.win, 25);
  assert.equal(table(small).pot, JACKPOT_SEED + Math.floor(5 * JACKPOT_RATE));
  assert.equal(small.players.a!.bankroll, START_BANKROLL - 10 + JACKPOT_SEED - 5 + 25);
  assert.equal(small.feed.length, jackpot.feed.length);

  const quiet = spin(engines, small, 'a', 10, T0 + 3, scripted([6, 8, 10], rng)).state;
  assert.equal(table(quiet).machines.a!.win, 0);
  assert.deepEqual(table(quiet).machines.a!.lines, []);
  assert.equal(table(quiet).pot, JACKPOT_SEED + Math.floor(5 * JACKPOT_RATE) + Math.floor(10 * JACKPOT_RATE));
  assert.equal(quiet.feed.length, small.feed.length);
});

test('every spin tithes the pot by floor(bet × 0.05) and a jackpot resets it', () => {
  const engines = registry();
  const rng = lcg(11);
  let state = createCasino(engines, ['a'], { now: T0, entropy: rng });
  state = seat(engines, state, 'a', 'slots', T0, rng);
  state.players.a!.bankroll = 10_000;
  let pot = JACKPOT_SEED;
  for (const bet of SLOTS_BETS) {
    state = spin(engines, state, 'a', bet, T0 + bet, scripted([6, 8, 10], rng)).state;
    pot += Math.floor(bet * JACKPOT_RATE);
    assert.equal(table(state).pot, pot);
  }
  assert.ok(pot > JACKPOT_SEED);
  state = spin(engines, state, 'a', 10, T0 + 100, scripted([0, 1, 0], rng)).state;
  assert.equal(table(state).pot, JACKPOT_SEED);
  assert.equal(table(state).machines.a!.win, pot);
});

test('big wins reach the feed and quiet spins stay out', () => {
  const engines = registry();
  const rng = lcg(3);
  let state = createCasino(engines, ['a'], { now: T0, entropy: rng });
  state = seat(engines, state, 'a', 'slots', T0, rng);

  const quiet = spin(engines, state, 'a', 10, T0 + 1, scripted([6, 8, 10], rng)).state;
  assert.equal(quiet.feed.length, state.feed.length);

  const big = spin(engines, quiet, 'a', 10, T0 + 2, scripted([4, 4, 4], rng)).state;
  const bigMachine = table(big).machines.a!;
  assert.deepEqual(bigMachine.grid, [[0, 0, 0], [5, 5, 5], [0, 0, 0]]);
  assert.deepEqual(bigMachine.lines, [0, 1, 2]);
  assert.equal(bigMachine.win, 168);
  assert.equal(big.feed.at(-1)!.kind, 'bigwin');
  assert.equal(big.feed.at(-1)!.amount, 168);

  const small = spin(engines, big, 'a', 1, T0 + 3, scripted([4, 4, 4], rng)).state;
  assert.equal(table(small).machines.a!.win, 16);
  assert.equal(small.feed.at(-1)!.kind, 'bigwin');
  assert.equal(small.feed.at(-1)!.amount, 16);
});

test('the view shares every machine, the pot, and the bets with the table', () => {
  const engines = registry();
  const rng = lcg(5);
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy: rng });
  state = seat(engines, state, 'a', 'slots', T0, rng);
  assert.deepEqual(slotsEngine.summary(table(state)), { mode: 'solo', limit: SLOTS_LIMIT, info: { jackpot: JACKPOT_SEED } });
  state = seat(engines, state, 'b', 'slots', T0, rng);
  state = spin(engines, state, 'a', 10, T0 + 1, scripted([4, 4, 4], rng)).state;
  state = spin(engines, state, 'b', 5, T0 + 2, scripted([6, 8, 10], rng)).state;

  const viewA = slotsEngine.view(table(state), 'a') as SlotsView;
  assert.equal(viewA.win, 168);
  assert.deepEqual(viewA.lines, [0, 1, 2]);
  assert.deepEqual(viewA.grid, [[0, 0, 0], [5, 5, 5], [0, 0, 0]]);
  assert.deepEqual(viewA.machines, [{ id: 'a', lastWin: 168 }, { id: 'b', lastWin: 0 }]);
  assert.equal(viewA.jackpot, JACKPOT_SEED);
  assert.deepEqual(viewA.bets, SLOTS_BETS);
  assert.equal(viewA.limit, SLOTS_LIMIT);
  assert.deepEqual(viewCasino(engines, state, 'a').table, viewA);

  const spectator = slotsEngine.view(table(state), null) as SlotsView;
  assert.deepEqual(spectator.grid, []);
  assert.deepEqual(spectator.lines, []);
  assert.equal(spectator.win, 0);
  assert.deepEqual(spectator.machines, [{ id: 'a', lastWin: 168 }, { id: 'b', lastWin: 0 }]);

  state = seat(engines, state, 'a', 'floor', T0 + 3, rng);
  assert.deepEqual(slotsEngine.summary(table(state)), { mode: 'solo', limit: SLOTS_LIMIT, info: { jackpot: JACKPOT_SEED } });
  assert.deepEqual((slotsEngine.view(table(state), 'b') as SlotsView).machines, [{ id: 'b', lastWin: 0 }]);
  assert.equal(viewCasino(engines, state, 'a').tables.slots.seats, 1);
});

test('invalid bets and unaffordable spins fail before any chips move', () => {
  const engines = registry();
  const rng = lcg(9);
  let state = createCasino(engines, ['a'], { now: T0, entropy: rng });
  state = seat(engines, state, 'a', 'slots', T0, rng);
  assert.throws(() => spin(engines, state, 'a', 2, T0 + 1, rng), /Invalid bet\./);
  assert.throws(() => spin(engines, state, 'a', 0, T0 + 1, rng), /Invalid bet\./);
  assert.throws(() => spin(engines, state, 'a', 11, T0 + 1, rng), /Invalid bet\./);
  assert.throws(() => spin(engines, state, 'a', 1.5, T0 + 1, rng), /Invalid bet\./);
  assert.throws(() => applyCasino(engines, state, 'a', 'spin', null, { now: T0 + 1, entropy: rng }), /Invalid action\./);
  assert.throws(() => applyCasino(engines, state, 'a', 'drop', { bet: 1 } as Json, { now: T0 + 1, entropy: rng }), /Unknown action\./);
  assert.equal(state.players.a!.bankroll, START_BANKROLL);
  assert.equal(table(state).machines.a!.win, 0);
  assert.deepEqual(table(state).machines.a!.lines, []);

  const ctx: ActionCtx = {
    now: T0, entropy: rng, bankroll: () => START_BANKROLL,
    cash() {}, result() {}, announce() {},
  };
  assert.throws(() => slotsEngine.act(table(state), 'ghost', 'spin', { bet: 1 } as Json, ctx), /You are not at this table\./);

  const broke = structuredClone(state);
  broke.players.a!.bankroll = 9;
  assert.throws(() => spin(engines, broke, 'a', 10, T0 + 2, rng), /Not enough chips\./);
  assert.equal(broke.players.a!.bankroll, 9);
  assert.equal(table(broke).machines.a!.win, 0);
});

test('the slots floor caps at 16 machines and frees them on leave', () => {
  const engines = registry();
  const ids = Array.from({ length: SLOTS_LIMIT + 1 }, (_, index) => `p${index}`);
  const rng = lcg(13);
  let state = createCasino(engines, ids, { now: T0, entropy: rng });
  for (const id of ids.slice(0, SLOTS_LIMIT)) state = seat(engines, state, id, 'slots', T0, rng);
  assert.deepEqual(slotsEngine.occupants(table(state)), ids.slice(0, SLOTS_LIMIT));
  assert.throws(() => seat(engines, state, ids[SLOTS_LIMIT]!, 'slots', T0 + 1, rng), /Table is full\./);
  state = seat(engines, state, ids[3]!, 'floor', T0 + 2, rng);
  assert.equal(table(state).machines[ids[3]!], undefined);
  assert.equal(slotsEngine.occupants(table(state)).length, SLOTS_LIMIT - 1);
  state = seat(engines, state, ids[SLOTS_LIMIT]!, 'slots', T0 + 3, rng);
  assert.equal(slotsEngine.occupants(table(state)).at(-1), ids[SLOTS_LIMIT]);
  assert.equal(viewCasino(engines, state, ids[0]!).tables.slots.seats, SLOTS_LIMIT);
});

test('slots never hold a player, ignore the clock, and stay inside the state budget', () => {
  const engines = registry();
  const ids = Array.from({ length: SLOTS_LIMIT }, (_, index) => `player-${index}`);
  const rng = lcg(42);
  let state = createCasino(engines, ids, { now: T0, entropy: rng });
  for (const id of ids) {
    state = seat(engines, state, id, 'slots', T0, rng);
    state.players[id]!.bankroll = 10_000;
  }
  for (let index = 0; index < 30; index += 1) {
    const bet = SLOTS_BETS[index % SLOTS_BETS.length]!;
    state = spin(engines, state, ids[index % SLOTS_LIMIT]!, bet, T0 + index + 1, rng).state;
  }
  for (const id of ids) assert.equal(slotsEngine.pending(table(state), id), false);
  assert.equal(slotsEngine.pending(table(state), 'ghost'), false);

  const before = state.tables.slots;
  const ticked = applyCasino(engines, state, null, 'tick', null, { now: T0 + 31, entropy: rng });
  assert.deepEqual(ticked.state.tables.slots, before);
  const settled = applyCasino(engines, state, ids[0]!, 'tick', null, { now: T0 + MATCH_MS, entropy: rng });
  assert.equal(settled.finished, true);
  assert.deepEqual(settled.state.tables.slots, before);

  const json = JSON.stringify(state.tables.slots);
  assert.ok(json.length < 4096, `slots table serializes to ${json.length} bytes`);
  assert.deepEqual(JSON.parse(json), state.tables.slots);
});


test('high-stake diamonds qualify for the jackpot without reducing the line payout', () => {
  const engines = registry();
  const rng = lcg(7);
  let state = createCasino(engines, ['a'], { now: T0, entropy: rng });
  state = seat(engines, state, 'a', 'slots', T0, rng);
  const next = spin(engines, state, 'a', 1000, T0 + 1, scripted([0, 1, 0], rng)).state;
  assert.deepEqual(table(next).machines.a!.lines, [1]);
  assert.equal(table(next).machines.a!.win, 5000);
  assert.equal(next.players.a!.bankroll, 5000);
  assert.equal(table(next).pot, JACKPOT_SEED);
  assert.equal(next.feed.at(-1)!.kind, 'jackpot');
});
