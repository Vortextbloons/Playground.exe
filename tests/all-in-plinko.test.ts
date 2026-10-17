import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCasino, createCasino, viewCasino } from '../games/all-in/src/core/casino.ts';
import { MATCH_MS, START_BANKROLL } from '../games/all-in/src/core/economy.ts';
import { asRecord, readInt } from '../games/all-in/src/core/parse.ts';
import type { Engine, EngineRegistry, EngineSummary, TableId } from '../games/all-in/src/core/types.ts';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import {
  PLINKO_LIMIT, PLINKO_MAX, PLINKO_MIN, PLINKO_ROWS, RISK_TABLES, plinkoEngine, simulateDrop,
  type PlinkoState, type PlinkoView, type Risk,
} from '../games/all-in/src/games/plinko.ts';

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
    blackjack: stubEngine('blackjack'), roulette: stubEngine('roulette'), slots: stubEngine('slots'),
    plinko: plinkoEngine, poker: stubEngine('poker'),
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

function fixedEntropy(seed: number): () => number {
  return () => seed;
}

function seedForSlot(slot: number): number {
  for (let seed = 0; seed < 1_000_000; seed += 1) {
    if (simulateDrop(seed, PLINKO_ROWS) === slot) return seed;
  }
  throw new Error('No seed found.');
}

function seat(engines: EngineRegistry, state: Casino, playerId: string, at: string, now: number, entropy: () => number): Casino {
  return applyCasino(engines, state, playerId, 'sit', { at } as Json, { now, entropy }).state;
}

function drop(engines: EngineRegistry, state: Casino, playerId: string, bet: number, risk: Risk, now: number, entropy: () => number) {
  return applyCasino(engines, state, playerId, 'drop', { bet, risk } as Json, { now, entropy });
}

function table(state: Casino): PlinkoState {
  return state.tables.plinko as PlinkoState;
}

test('simulateDrop is deterministic, bounded, and covers the whole board', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const first = simulateDrop(seed, PLINKO_ROWS);
    assert.equal(simulateDrop(seed, PLINKO_ROWS), first);
    assert.equal(Number.isInteger(first), true);
    assert.ok(first >= 0 && first <= PLINKO_ROWS);
  }
  const seen = new Set<number>();
  for (let seed = 0; seed < 10_000; seed += 1) seen.add(simulateDrop(seed, PLINKO_ROWS));
  assert.equal(seen.size, PLINKO_ROWS + 1);
});

test('landings pile up in the middle like a binomial board', () => {
  const counts = new Array<number>(PLINKO_ROWS + 1).fill(0);
  for (let seed = 1; seed <= 6000; seed += 1) counts[simulateDrop(seed, PLINKO_ROWS)]! += 1;
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 6000);
  assert.ok(counts[6]! > counts[3]!);
  assert.ok(counts[3]! > counts[1]!);
  assert.ok(counts[5]! > counts[2]!);
  assert.ok(counts[6]! > counts[0]! + counts[12]!);
});

test('drops pay floor(bet × multiplier) on every risk level', () => {
  const engines = registry();
  const entropy = lcg(2026);
  let state = createCasino(engines, ['a'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'plinko', T0, entropy);
  let rounds = 0;
  for (const risk of ['low', 'medium', 'high'] as const) {
    const before = state.players.a!.bankroll;
    state = drop(engines, state, 'a', 100, risk, T0 + rounds + 1, entropy).state;
    rounds += 1;
    const ball = table(state).balls.at(-1)!;
    assert.equal(ball.risk, risk);
    assert.equal(ball.bet, 100);
    assert.equal(ball.at, T0 + rounds);
    assert.ok(Number.isInteger(ball.seed) && ball.seed >= 0 && ball.seed <= 0xffffffff);
    assert.equal(ball.slot, simulateDrop(ball.seed, PLINKO_ROWS));
    assert.equal(ball.win, Math.floor(100 * RISK_TABLES[risk][ball.slot]!));
    assert.equal(state.players.a!.bankroll, before - 100 + ball.win);
    assert.equal(state.players.a!.rounds, rounds);
    assert.equal(state.players.a!.byGame.plinko, rounds);
  }
});

test('replaying the same entropy lands the same balls', () => {
  const play = () => {
    const engines = registry();
    const entropy = lcg(77);
    let state = createCasino(engines, ['a'], { now: T0, entropy });
    state = seat(engines, state, 'a', 'plinko', T0, entropy);
    for (let index = 0; index < 5; index += 1) {
      state = drop(engines, state, 'a', 10, 'high', T0 + index + 1, entropy).state;
    }
    return table(state).balls;
  };
  assert.deepEqual(play(), play());
});

test('the board keeps only the 24 most recent balls', () => {
  const engines = registry();
  const entropy = lcg(7);
  let state = createCasino(engines, ['a'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'plinko', T0, entropy);
  for (let index = 0; index < 30; index += 1) {
    state = drop(engines, state, 'a', 1, 'low', T0 + index + 1, entropy).state;
  }
  const balls = table(state).balls;
  assert.equal(balls.length, 24);
  assert.deepEqual(balls.map(ball => ball.id), Array.from({ length: 24 }, (_, index) => index + 7));
  assert.equal(table(state).nextId, 31);
});

test('big wins reach the feed and quiet drops stay out', () => {
  const engines = registry();
  let state = createCasino(engines, ['a'], { now: T0, entropy: fixedEntropy(1) });
  state = seat(engines, state, 'a', 'plinko', T0, fixedEntropy(1));
  state = drop(engines, state, 'a', 1, 'low', T0 + 1, fixedEntropy(seedForSlot(0))).state;
  state = drop(engines, state, 'a', 100, 'high', T0 + 2, fixedEntropy(seedForSlot(3))).state;
  state = drop(engines, state, 'a', 10, 'low', T0 + 3, fixedEntropy(seedForSlot(6))).state;
  const bigwins = state.feed.filter(item => item.kind === 'bigwin');
  assert.equal(bigwins.length, 2);
  assert.equal(bigwins[0]!.playerId, 'a');
  assert.equal(bigwins[0]!.amount, 10);
  assert.equal(bigwins[1]!.amount, 200);
  assert.deepEqual(table(state).balls.map(ball => ball.win), [10, 200, 5]);
});

test('invalid drops fail before any chips move', () => {
  const engines = registry();
  const entropy = lcg(3);
  let state = createCasino(engines, ['a'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'plinko', T0, entropy);
  assert.throws(() => drop(engines, state, 'a', 0, 'low', T0 + 1, entropy), /Invalid bet\./);
  assert.throws(() => drop(engines, state, 'a', PLINKO_MAX + 1, 'low', T0 + 1, entropy), /Invalid bet\./);
  assert.throws(() => drop(engines, state, 'a', 1.5, 'low', T0 + 1, entropy), /Invalid bet\./);
  assert.throws(() => drop(engines, state, 'a', 10, 'extreme' as Risk, T0 + 1, entropy), /Invalid risk\./);
  assert.throws(() => applyCasino(engines, state, 'a', 'drop', null, { now: T0 + 1, entropy }), /Invalid action\./);
  assert.throws(() => applyCasino(engines, state, 'a', 'spin', null, { now: T0 + 1, entropy }), /Unknown action\./);
  assert.equal(state.players.a!.bankroll, START_BANKROLL);
  assert.equal(table(state).balls.length, 0);
  state = drop(engines, state, 'a', PLINKO_MIN, 'low', T0 + 2, entropy).state;
  assert.equal(table(state).balls.length, 1);
});

test('drops beyond the bankroll are refused', () => {
  const engines = registry();
  const entropy = lcg(4);
  let state = createCasino(engines, ['a'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'slots', T0, entropy);
  state = applyCasino(engines, state, 'a', 'bet', { amount: 950 } as Json, { now: T0 + 1, entropy }).state;
  assert.equal(state.players.a!.bankroll, 50);
  state = seat(engines, state, 'a', 'plinko', T0 + 2, entropy);
  assert.throws(() => drop(engines, state, 'a', 51, 'low', T0 + 3, entropy), /Not enough chips\./);
  assert.equal(state.players.a!.bankroll, 50);
  assert.equal(table(state).balls.length, 0);
});

test('the plinko table caps at 16 seats and keeps join order', () => {
  const engines = registry();
  const ids = Array.from({ length: PLINKO_LIMIT + 1 }, (_, index) => `p${index}`);
  const entropy = lcg(11);
  let state = createCasino(engines, ids, { now: T0, entropy });
  for (const id of ids.slice(0, PLINKO_LIMIT)) state = seat(engines, state, id, 'plinko', T0, entropy);
  assert.deepEqual(plinkoEngine.occupants(table(state)), ids.slice(0, PLINKO_LIMIT));
  assert.throws(() => seat(engines, state, ids[PLINKO_LIMIT]!, 'plinko', T0 + 1, entropy), /Table is full\./);
  state = seat(engines, state, ids[3]!, 'floor', T0 + 2, entropy);
  state = seat(engines, state, ids[PLINKO_LIMIT]!, 'plinko', T0 + 3, entropy);
  assert.equal(plinkoEngine.occupants(table(state)).length, PLINKO_LIMIT);
  assert.equal(plinkoEngine.occupants(table(state))[PLINKO_LIMIT - 1], ids[PLINKO_LIMIT]);
  const summary = viewCasino(engines, state, 'p0').tables.plinko;
  assert.equal(summary.seats, PLINKO_LIMIT);
  assert.equal(summary.mode, 'shared');
  assert.equal(summary.limit, PLINKO_LIMIT);
});

test('the view shares every ball and marks the viewer own drops', () => {
  const engines = registry();
  const entropy = lcg(5);
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'plinko', T0, entropy);
  state = seat(engines, state, 'b', 'plinko', T0, entropy);
  state = drop(engines, state, 'a', 10, 'low', T0 + 1, entropy).state;
  state = drop(engines, state, 'b', 20, 'medium', T0 + 2, entropy).state;

  const shared = viewCasino(engines, state, 'a');
  assert.equal(shared.tables.plinko.mode, 'shared');
  assert.equal(shared.tables.plinko.seats, 2);
  assert.deepEqual(shared.tables.plinko.info, { balls: 2 });

  const viewA = plinkoEngine.view(table(state), 'a') as PlinkoView;
  assert.deepEqual(shared.table, viewA);
  assert.equal(viewA.balls.length, 2);
  assert.deepEqual(viewA.balls.map(ball => ball.playerId), ['a', 'b']);
  assert.equal(viewA.mine.length, 1);
  assert.equal(viewA.mine[0]!.playerId, 'a');
  assert.equal(viewA.limit, PLINKO_LIMIT);
  assert.equal(viewA.min, PLINKO_MIN);
  assert.equal(viewA.max, PLINKO_MAX);
  assert.equal(viewA.rows, PLINKO_ROWS);

  const spectator = plinkoEngine.view(table(state), null) as PlinkoView;
  assert.equal(spectator.balls.length, 2);
  assert.deepEqual(spectator.mine, []);
});

test('summary flips from solo to shared at two occupants', () => {
  const engines = registry();
  const entropy = lcg(6);
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy });
  assert.deepEqual(plinkoEngine.summary(table(state)), { mode: 'solo', limit: PLINKO_LIMIT, info: { balls: 0 } });
  state = seat(engines, state, 'a', 'plinko', T0, entropy);
  assert.deepEqual(plinkoEngine.summary(table(state)), { mode: 'solo', limit: PLINKO_LIMIT, info: { balls: 0 } });
  state = seat(engines, state, 'b', 'plinko', T0, entropy);
  assert.deepEqual(plinkoEngine.summary(table(state)), { mode: 'shared', limit: PLINKO_LIMIT, info: { balls: 0 } });
  state = drop(engines, state, 'a', 10, 'low', T0 + 1, entropy).state;
  assert.deepEqual(plinkoEngine.summary(table(state)), { mode: 'shared', limit: PLINKO_LIMIT, info: { balls: 1 } });
});

test('plinko never holds a player and needs no clocks', () => {
  const engines = registry();
  const entropy = lcg(9);
  let state = createCasino(engines, ['a'], { now: T0, entropy });
  state = seat(engines, state, 'a', 'plinko', T0, entropy);
  state = drop(engines, state, 'a', 10, 'high', T0 + 1, entropy).state;
  assert.equal(plinkoEngine.pending(table(state), 'a'), false);
  assert.equal(plinkoEngine.pending(table(state), 'ghost'), false);
  const before = state.tables.plinko;
  const ticked = applyCasino(engines, state, null, 'tick', null, { now: T0 + 2, entropy });
  assert.deepEqual(ticked.state.tables.plinko, before);
  const settled = applyCasino(engines, state, 'a', 'tick', null, { now: T0 + MATCH_MS, entropy });
  assert.equal(settled.finished, true);
  assert.deepEqual(settled.state.tables.plinko, before);
});

test('a full table with a full board stays under the state budget', () => {
  const engines = registry();
  const ids = Array.from({ length: PLINKO_LIMIT }, (_, index) => `player-${index}`);
  const entropy = lcg(42);
  let state = createCasino(engines, ids, { now: T0, entropy });
  for (const id of ids) state = seat(engines, state, id, 'plinko', T0, entropy);
  for (let index = 0; index < 24; index += 1) {
    state = drop(engines, state, ids[index % 8]!, 100, 'medium', T0 + index + 1, entropy).state;
  }
  assert.equal(table(state).balls.length, 24);
  const tableJson = JSON.stringify(state.tables.plinko);
  assert.ok(tableJson.length < 4096, `plinko table serializes to ${tableJson.length} bytes`);
  assert.deepEqual(JSON.parse(tableJson), state.tables.plinko);
});
