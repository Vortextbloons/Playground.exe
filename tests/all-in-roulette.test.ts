import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCasino, createCasino, viewCasino, type CasinoResult } from '../games/all-in/src/core/casino.ts';
import { MATCH_MS, START_BANKROLL } from '../games/all-in/src/core/economy.ts';
import { randomBelow } from '../games/all-in/src/core/rng.ts';
import { ROULETTE_BET_MS, ROULETTE_LIMIT, ROULETTE_RESULT_MS, rouletteEngine } from '../games/all-in/src/games/roulette.ts';
import type { RouletteBetKind, RouletteState, RouletteView } from '../games/all-in/src/games/roulette.ts';
import type { CasinoState, Engine, EngineRegistry, TableId } from '../games/all-in/src/core/types.ts';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';

type StubState = { occupants: string[] };

function idleEngine(id: TableId): Engine<StubState> {
  return {
    id,
    create() { return { occupants: [] }; },
    join(state, playerId) { if (!state.occupants.includes(playerId)) state.occupants.push(playerId); },
    leave(state, playerId) { state.occupants = state.occupants.filter(item => item !== playerId); },
    act() { throw new Error('Unknown action.'); },
    tick() {},
    settle() {},
    pending() { return false; },
    occupants(state) { return [...state.occupants]; },
    view() { return null; },
    summary() { return { mode: 'solo', limit: 8, info: null }; },
  };
}

function registry(): EngineRegistry {
  return {
    blackjack: idleEngine('blackjack'),
    roulette: rouletteEngine,
    slots: idleEngine('slots'),
    plinko: idleEngine('plinko'),
    poker: idleEngine('poker'),
  };
}

const T0 = 1_000_000;

type Clock = { now: number; entropy: () => number };

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
}

function outcomeOf(seed: number, spin = 0): number {
  const entropy = lcg(seed);
  let outcome = 0;
  for (let index = 0; index <= spin; index += 1) outcome = randomBelow(entropy, 37);
  return outcome;
}

function seedFor(target: number): number {
  for (let seed = 1; seed <= 100_000; seed += 1) {
    if (outcomeOf(seed) === target) return seed;
  }
  throw new Error(`No seed yields ${target}.`);
}

function host(seed: number): Clock {
  return { now: T0, entropy: lcg(seed) };
}

function run(engines: EngineRegistry, state: CasinoState, playerId: string, action: string, payload: Json, clock: Clock, now: number): CasinoResult {
  clock.now = now;
  return applyCasino(engines, state, playerId, action, payload, clock);
}

function seat(engines: EngineRegistry, state: CasinoState, playerId: string, clock: Clock, now: number): CasinoState {
  return run(engines, state, playerId, 'sit', { at: 'roulette' } as Json, clock, now).state;
}

type Bet = { kind: RouletteBetKind; numbers: number[]; amount: number };

function placeBet(engines: EngineRegistry, state: CasinoState, playerId: string, bet: Bet, clock: Clock, now: number): CasinoState {
  return run(engines, state, playerId, 'bet', { kind: bet.kind, numbers: bet.numbers, amount: bet.amount } as Json, clock, now).state;
}

function table(state: CasinoState): RouletteState {
  return state.tables.roulette as RouletteState;
}

function tableView(engines: EngineRegistry, state: CasinoState, viewerId: string): RouletteView {
  return viewCasino(engines, state, viewerId).table as RouletteView;
}

const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];
const ODD = Array.from({ length: 18 }, (_, index) => index * 2 + 1);
const EVEN = Array.from({ length: 18 }, (_, index) => index * 2 + 2);
const LOW = Array.from({ length: 18 }, (_, index) => index + 1);
const HIGH = Array.from({ length: 18 }, (_, index) => index + 19);
const MIDDLE = Array.from({ length: 12 }, (_, index) => index + 13);

test('pays every bet kind at its canonical odds', () => {
  const cases: Array<{ kind: RouletteBetKind; numbers: number[]; payout: number; target: number }> = [
    { kind: 'straight', numbers: [17], payout: 35, target: 17 },
    { kind: 'split', numbers: [16, 17], payout: 17, target: 17 },
    { kind: 'street', numbers: [16, 17, 18], payout: 11, target: 17 },
    { kind: 'corner', numbers: [14, 15, 17, 18], payout: 8, target: 17 },
    { kind: 'sixline', numbers: [13, 14, 15, 16, 17, 18], payout: 5, target: 17 },
    { kind: 'column', numbers: MIDDLE, payout: 2, target: 17 },
    { kind: 'dozen', numbers: MIDDLE, payout: 2, target: 17 },
    { kind: 'red', numbers: RED, payout: 1, target: 16 },
    { kind: 'black', numbers: BLACK, payout: 1, target: 17 },
    { kind: 'odd', numbers: ODD, payout: 1, target: 17 },
    { kind: 'even', numbers: EVEN, payout: 1, target: 16 },
    { kind: 'low', numbers: LOW, payout: 1, target: 17 },
    { kind: 'high', numbers: HIGH, payout: 1, target: 20 },
  ];
  for (const betCase of cases) {
    const engines = registry();
    const clock = host(seedFor(betCase.target));
    let state = createCasino(engines, ['a'], clock);
    state = seat(engines, state, 'a', clock, T0 + 1);
    state = placeBet(engines, state, 'a', { kind: betCase.kind, numbers: betCase.numbers, amount: 10 }, clock, T0 + 2);
    state = run(engines, state, 'a', 'spin', null, clock, T0 + 3).state;
    assert.equal(state.players.a!.bankroll, START_BANKROLL + 10 * betCase.payout, betCase.kind);
    const view = tableView(engines, state, 'a');
    assert.equal(view.wheel.last, betCase.target, betCase.kind);
    assert.deepEqual(view.lastResults, [{ id: 'a', staked: 10, returned: 10 * (betCase.payout + 1), net: 10 * betCase.payout }], betCase.kind);
  }
});

test('zero beats no outside bet', () => {
  const losers: Array<[RouletteBetKind, number[]]> = [
    ['red', RED], ['black', BLACK], ['odd', ODD], ['even', EVEN],
    ['low', LOW], ['high', HIGH], ['column', MIDDLE], ['dozen', MIDDLE],
  ];
  for (const [kind, numbers] of losers) {
    const engines = registry();
    const clock = host(seedFor(0));
    let state = createCasino(engines, ['a'], clock);
    state = seat(engines, state, 'a', clock, T0 + 1);
    state = placeBet(engines, state, 'a', { kind, numbers, amount: 10 }, clock, T0 + 2);
    state = run(engines, state, 'a', 'spin', null, clock, T0 + 3).state;
    assert.equal(state.players.a!.bankroll, START_BANKROLL - 10, kind);
    assert.equal(tableView(engines, state, 'a').wheel.last, 0, kind);
  }
  const engines = registry();
  const clock = host(seedFor(0));
  let state = createCasino(engines, ['a'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [0], amount: 10 }, clock, T0 + 2);
  state = run(engines, state, 'a', 'spin', null, clock, T0 + 3).state;
  assert.equal(state.players.a!.bankroll, START_BANKROLL + 10 * 35);
});

test('rejects malformed number sets', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  const malformed: Array<[RouletteBetKind, number[]]> = [
    ['straight', [1, 2]],
    ['straight', [37]],
    ['straight', [1.5]],
    ['split', [1, 3]],
    ['split', [2, 1]],
    ['split', [0, 1]],
    ['street', [1, 2, 4]],
    ['corner', [1, 2, 3, 4]],
    ['sixline', [2, 3, 4, 5, 6, 7]],
    ['sixline', [1, 2, 3, 4, 5]],
    ['column', Array.from({ length: 11 }, (_, index) => index + 1)],
    ['dozen', Array.from({ length: 13 }, (_, index) => index + 1)],
    ['red', [...RED.slice(0, 17), 35]],
    ['high', LOW],
  ];
  for (const [kind, numbers] of malformed) {
    assert.throws(() => placeBet(engines, state, 'a', { kind, numbers, amount: 1 }, clock, T0 + 2), /Invalid bet\./);
  }
  assert.throws(() => run(engines, state, 'a', 'bet', { kind: 'straight', numbers: '17', amount: 1 } as Json, clock, T0 + 3), /Invalid bet\./);
  assert.equal(state.players.a!.bankroll, START_BANKROLL);
  assert.deepEqual(tableView(engines, state, 'a').chips, {});
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 1 }, clock, T0 + 4);
  assert.equal(tableView(engines, state, 'a').chips['a']!.length, 1);
});

test('solo spin resolves immediately and announces big wins', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  assert.throws(() => run(engines, state, 'a', 'spin', null, clock, T0 + 2), /Place a bet first\./);
  assert.equal(rouletteEngine.pending(table(state), 'a'), false);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 100 }, clock, T0 + 2);
  assert.equal(state.players.a!.bankroll, 900);
  assert.equal(rouletteEngine.pending(table(state), 'a'), true);
  state = run(engines, state, 'a', 'spin', null, clock, T0 + 3).state;
  assert.equal(state.players.a!.bankroll, 4500);
  assert.equal(state.players.a!.rounds, 1);
  const view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'results');
  assert.equal(view.wheel.last, 17);
  assert.deepEqual(view.wheel.history, [17]);
  assert.equal(view.deadline, T0 + 3 + ROULETTE_RESULT_MS);
  assert.deepEqual(view.lastResults, [{ id: 'a', staked: 100, returned: 3600, net: 3500 }]);
  assert.equal(rouletteEngine.pending(table(state), 'a'), false);
  assert.ok(state.feed.some(item => item.kind === 'bigwin' && item.playerId === 'a' && item.amount === 3500));
  const resumed = tableView(engines, run(engines, state, 'a', 'tick', null, clock, T0 + 3 + ROULETTE_RESULT_MS).state, 'a');
  assert.equal(resumed.phase, 'betting');
  assert.equal(resumed.deadline, 0);
});

test('shared early spin requires a bet from every bettable player', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a', 'b'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = seat(engines, state, 'b', clock, T0 + 2);
  const window = tableView(engines, state, 'a');
  assert.equal(window.phase, 'betting');
  assert.equal(window.deadline, T0 + 2 + ROULETTE_BET_MS);
  assert.equal(rouletteEngine.summary(table(state)).mode, 'shared');
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 10 }, clock, T0 + 3);
  assert.throws(() => run(engines, state, 'a', 'spin', null, clock, T0 + 4), /Everyone at the table must place a bet first\./);
  assert.throws(() => run(engines, state, 'b', 'spin', null, clock, T0 + 5), /Everyone at the table must place a bet first\./);
  state = placeBet(engines, state, 'b', { kind: 'black', numbers: BLACK, amount: 10 }, clock, T0 + 6);
  state = run(engines, state, 'b', 'spin', null, clock, T0 + 7).state;
  assert.equal(state.players.a!.bankroll, 1350);
  assert.equal(state.players.b!.bankroll, 1010);
  assert.equal(tableView(engines, state, 'a').wheel.last, 17);
});

test('the shared deadline auto-spins, then cancels into a fresh window', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a', 'b'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = seat(engines, state, 'b', clock, T0 + 2);
  const deadline = T0 + 2 + ROULETTE_BET_MS;
  const early = run(engines, state, 'a', 'tick', null, clock, deadline - 1).state;
  assert.equal(tableView(engines, early, 'a').deadline, deadline);
  assert.equal(tableView(engines, early, 'a').wheel.last, null);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 10 }, clock, T0 + 3);
  state = placeBet(engines, state, 'a', { kind: 'red', numbers: RED, amount: 10 }, clock, T0 + 4);
  state = placeBet(engines, state, 'b', { kind: 'red', numbers: RED, amount: 10 }, clock, T0 + 5);
  state = run(engines, state, 'a', 'tick', null, clock, deadline).state;
  assert.equal(state.players.a!.bankroll, 1340);
  assert.equal(state.players.b!.bankroll, 990);
  const settled = tableView(engines, state, 'a');
  assert.equal(settled.phase, 'results');
  assert.equal(settled.wheel.last, 17);
  assert.deepEqual(settled.lastResults, [
    { id: 'a', staked: 20, returned: 360, net: 340 },
    { id: 'b', staked: 10, returned: 0, net: -10 },
  ]);
  const reopened = tableView(engines, run(engines, state, 'a', 'tick', null, clock, deadline + ROULETTE_RESULT_MS).state, 'a');
  assert.equal(reopened.phase, 'betting');
  assert.equal(reopened.deadline, deadline + ROULETTE_RESULT_MS + ROULETTE_BET_MS);
  assert.deepEqual(reopened.chips, {});
  const idle = registry();
  const idleClock = host(1);
  let fresh = createCasino(idle, ['a', 'b'], idleClock);
  fresh = seat(idle, fresh, 'a', idleClock, T0 + 1);
  fresh = seat(idle, fresh, 'b', idleClock, T0 + 2);
  const cancelled = tableView(idle, run(idle, fresh, 'a', 'tick', null, idleClock, T0 + 2 + ROULETTE_BET_MS).state, 'a');
  assert.equal(cancelled.phase, 'betting');
  assert.equal(cancelled.wheel.last, null);
  assert.equal(cancelled.deadline, T0 + 2 + ROULETTE_BET_MS + ROULETTE_BET_MS);
});

test('solo chips roll into the first shared window', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a', 'b'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 50 }, clock, T0 + 2);
  let view = tableView(engines, state, 'a');
  assert.equal(view.deadline, 0);
  assert.equal(view.chips['a']!.length, 1);
  assert.equal(rouletteEngine.summary(table(state)).mode, 'solo');
  assert.deepEqual(rouletteEngine.summary(table(state)).info, { last: null, staked: 1 });
  state = seat(engines, state, 'b', clock, T0 + 3);
  view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'betting');
  assert.equal(view.deadline, T0 + 3 + ROULETTE_BET_MS);
  assert.equal(view.chips['a']!.length, 1);
  assert.equal(state.players.a!.bankroll, 950);
  assert.equal(rouletteEngine.summary(table(state)).mode, 'shared');
  assert.equal(rouletteEngine.pending(table(state), 'a'), true);
  state = placeBet(engines, state, 'b', { kind: 'black', numbers: BLACK, amount: 10 }, clock, T0 + 4);
  state = run(engines, state, 'a', 'tick', null, clock, T0 + 3 + ROULETTE_BET_MS).state;
  assert.equal(state.players.a!.bankroll, 950 + 50 * 36);
  assert.equal(state.players.b!.bankroll, 1010);
  view = tableView(engines, state, 'a');
  assert.equal(view.wheel.last, 17);
  assert.equal(view.chips['a'], undefined);
});

test('an open window resolves when occupancy drops to one, then solo resumes', () => {
  const engines = registry();
  const seed = seedFor(17);
  const clock = host(seed);
  let state = createCasino(engines, ['a', 'b'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = seat(engines, state, 'b', clock, T0 + 2);
  const deadline = T0 + 2 + ROULETTE_BET_MS;
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 20 }, clock, T0 + 3);
  state = run(engines, state, 'b', 'sit', { at: 'floor' } as Json, clock, T0 + 4).state;
  assert.equal(rouletteEngine.occupants(table(state)).includes('b'), false);
  assert.equal(rouletteEngine.summary(table(state)).mode, 'solo');
  let view = tableView(engines, state, 'a');
  assert.equal(view.deadline, deadline);
  assert.equal(view.chips['a']!.length, 1);
  state = run(engines, state, 'a', 'tick', null, clock, deadline).state;
  assert.equal(state.players.a!.bankroll, 1000 - 20 + 720);
  view = tableView(engines, run(engines, state, 'a', 'tick', null, clock, deadline + ROULETTE_RESULT_MS).state, 'a');
  assert.equal(view.phase, 'betting');
  assert.equal(view.deadline, 0);
  const next = outcomeOf(seed, 1);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [next], amount: 10 }, clock, deadline + ROULETTE_RESULT_MS + 1);
  state = run(engines, state, 'a', 'spin', null, clock, deadline + ROULETTE_RESULT_MS + 2).state;
  assert.equal(state.players.a!.bankroll, 2050);
});

test('clear refunds committed chips and pending follows them', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 60 }, clock, T0 + 2);
  state = placeBet(engines, state, 'a', { kind: 'red', numbers: RED, amount: 40 }, clock, T0 + 3);
  assert.equal(state.players.a!.bankroll, 900);
  assert.equal(rouletteEngine.pending(table(state), 'a'), true);
  const before = tableView(engines, state, 'a');
  assert.equal(before.chips['a']!.length, 2);
  assert.deepEqual(before.yourChips, [
    { kind: 'straight', numbers: [17], amount: 60 },
    { kind: 'red', numbers: RED, amount: 40 },
  ]);
  assert.deepEqual(before.limits, { minChip: 1, maxChip: 100, maxTotal: 500, maxChips: 20 });
  state = run(engines, state, 'a', 'clear', null, clock, T0 + 4).state;
  assert.equal(state.players.a!.bankroll, 1000);
  assert.equal(rouletteEngine.pending(table(state), 'a'), false);
  const cleared = tableView(engines, state, 'a');
  assert.deepEqual(cleared.chips, {});
  assert.deepEqual(cleared.yourChips, []);
  state = run(engines, state, 'a', 'clear', null, clock, T0 + 5).state;
  assert.equal(state.players.a!.bankroll, 1000);
  assert.throws(() => run(engines, state, 'a', 'spin', null, clock, T0 + 6), /Place a bet first\./);
});

test('settle pays open chips at the match deadline exactly once', () => {
  const engines = registry();
  const clock = host(seedFor(17));
  let state = createCasino(engines, ['a'], clock);
  state = seat(engines, state, 'a', clock, T0 + 1);
  state = placeBet(engines, state, 'a', { kind: 'straight', numbers: [17], amount: 100 }, clock, T0 + 2);
  const final = run(engines, state, 'a', 'tick', null, clock, T0 + MATCH_MS);
  assert.equal(final.finished, true);
  assert.equal(final.state.players.a!.bankroll, 4500);
  const view = tableView(engines, final.state, 'a');
  assert.equal(view.wheel.last, 17);
  assert.equal(view.lastResults[0]!.net, 3500);
  const again = run(engines, final.state, 'a', 'tick', null, clock, T0 + MATCH_MS + 1);
  assert.equal(again.state.players.a!.bankroll, 4500);
});

test('join enforces the seat limit', () => {
  const engines = registry();
  const clock = host(1);
  const ids = Array.from({ length: ROULETTE_LIMIT + 1 }, (_, index) => `p${index}`);
  let state = createCasino(engines, ids, clock);
  for (let index = 0; index < ROULETTE_LIMIT; index += 1) {
    state = seat(engines, state, `p${index}`, clock, T0 + 1 + index);
  }
  assert.equal(rouletteEngine.occupants(table(state)).length, ROULETTE_LIMIT);
  assert.throws(() => seat(engines, state, `p${ROULETTE_LIMIT}`, clock, T0 + 100), /Table is full\./);
});
