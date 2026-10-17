import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCasino, createCasino, reconcileCasino, viewCasino } from '../games/all-in/src/core/casino.ts';
import type { Engine, EngineRegistry, EngineSummary, TableId } from '../games/all-in/src/core/types.ts';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { asRecord, readInt } from '../games/all-in/src/core/parse.ts';
import { MATCH_MS, START_BANKROLL } from '../games/all-in/src/core/economy.ts';

type StubState = { occupants: string[]; locked: number };

function stubEngine(id: TableId): Engine<StubState> {
  return {
    id,
    create() { return { occupants: [], locked: 0 }; },
    join(state, playerId) { if (!state.occupants.includes(playerId)) state.occupants.push(playerId); },
    leave(state, playerId) { state.occupants = state.occupants.filter(item => item !== playerId); },
    act(state, playerId, name, payload, ctx) {
      if (name !== 'bet') throw new Error('Unknown action.');
      const amount = readInt(asRecord(payload), 'amount', 1, 100000);
      if (amount > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
      ctx.cash(playerId, -amount);
      state.locked += amount;
      ctx.result(playerId, id, -amount);
    },
    tick() {},
    settle() {},
    pending(state, playerId) { return state.locked > 0 && state.occupants.includes(playerId); },
    occupants(state) { return [...state.occupants]; },
    view(state, viewerId) { return { ...state, viewer: viewerId }; },
    summary(state): EngineSummary { return { mode: state.occupants.length > 1 ? 'shared' : 'solo', limit: 8, info: { locked: state.locked } }; },
  };
}

function stubRegistry(): EngineRegistry {
  return {
    blackjack: stubEngine('blackjack'), roulette: stubEngine('roulette'), slots: stubEngine('slots'),
    plinko: stubEngine('plinko'), poker: stubEngine('poker'),
  };
}

const T0 = 1_000_000;

function seat(engines: EngineRegistry, state: ReturnType<typeof createCasino>, playerId: string, at: string, now = T0) {
  return applyCasino(engines, state, playerId, 'sit', { at } as Json, { now, entropy: () => 7 }).state;
}

test('createCasino initializes bankrolls, deadline, and view', () => {
  const engines = stubRegistry();
  const state = createCasino(engines, ['a', 'b'], { now: T0, entropy: () => 1 });
  assert.equal(state.players.a!.bankroll, START_BANKROLL);
  assert.equal(state.deadline, T0 + MATCH_MS);
  const view = viewCasino(engines, state, 'a');
  assert.equal(view.you, 'a');
  assert.equal(view.players.length, 2);
  assert.equal(view.tables.blackjack.seats, 0);
  assert.equal(view.table, null);
  assert.equal(view.vault!.bankroll, START_BANKROLL);
});

test('sitting and betting updates bankroll and leaderboard order', () => {
  const engines = stubRegistry();
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy: () => 1 });
  state = seat(engines, state, 'b', 'blackjack');
  assert.equal(viewCasino(engines, state, 'b').table !== null, true);
  state = applyCasino(engines, state, 'b', 'bet', { amount: 100 } as Json, { now: T0 + 1, entropy: () => 1 }).state;
  assert.equal(state.players.b!.bankroll, 900);
  assert.equal(state.players.b!.rounds, 1);
  assert.equal(state.players.b!.biggestLoss, -100);
  const view = viewCasino(engines, state, 'a');
  assert.equal(view.players[0]!.id, 'a');
  assert.equal(view.players[1]!.id, 'b');
  assert.equal(view.players[1]!.bankroll, 900);
});

test('bankruptcy offers bailout, accept grants chips, penalty, and time cut', () => {
  const engines = stubRegistry();
  let state = createCasino(engines, ['a'], { now: T0, entropy: () => 1 });
  state = seat(engines, state, 'a', 'slots');
  state = applyCasino(engines, state, 'a', 'bet', { amount: 1000 } as Json, { now: T0 + 1, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'sit', { at: 'floor' } as Json, { now: T0 + 2, entropy: () => 1 }).state;
  assert.equal(state.players.a!.status, 'offered');
  assert.equal(state.players.a!.bankroll, 0);
  const accepted = applyCasino(engines, state, 'a', 'bailout', { accept: true } as Json, { now: T0 + 3, entropy: () => 1 }).state;
  assert.equal(accepted.players.a!.status, 'active');
  assert.equal(accepted.players.a!.bankroll, 100);
  assert.equal(accepted.players.a!.penalty, 200);
  assert.equal(accepted.players.a!.personalDeadline, accepted.deadline - 60_000);
});

test('declined bailout ends the run and second bankruptcy busts', () => {
  const engines = stubRegistry();
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy: () => 1 });
  state = seat(engines, state, 'a', 'slots');
  state = seat(engines, state, 'b', 'slots');
  state = applyCasino(engines, state, 'a', 'bet', { amount: 1000 } as Json, { now: T0 + 1, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'sit', { at: 'floor' } as Json, { now: T0 + 2, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'b', 'bet', { amount: 1000 } as Json, { now: T0 + 3, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'b', 'sit', { at: 'floor' } as Json, { now: T0 + 4, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'bailout', { accept: false } as Json, { now: T0 + 5, entropy: () => 1 }).state;
  assert.equal(state.players.a!.status, 'out');
  assert.equal(state.players.a!.outReason, 'declined');
  assert.throws(() => applyCasino(engines, state, 'a', 'bet', { amount: 1 } as Json, { now: T0 + 6, entropy: () => 1 }));
  state = applyCasino(engines, state, 'b', 'bailout', { accept: true } as Json, { now: T0 + 7, entropy: () => 1 }).state;
  assert.equal(state.players.b!.bankroll, 100);
  state = applyCasino(engines, state, 'b', 'sit', { at: 'slots' } as Json, { now: T0 + 8, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'b', 'bet', { amount: 100 } as Json, { now: T0 + 9, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'b', 'sit', { at: 'floor' } as Json, { now: T0 + 10, entropy: () => 1 }).state;
  assert.equal(state.players.b!.status, 'out');
  assert.equal(state.players.b!.outReason, 'bust');
  assert.equal(state.players.b!.bankruptcies, 2);
});

test('deadline finalizes once and results rank by adjusted score', () => {
  const engines = stubRegistry();
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy: () => 1 });
  state = seat(engines, state, 'a', 'poker');
  state = applyCasino(engines, state, 'a', 'bet', { amount: 1000 } as Json, { now: T0 + 1, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'sit', { at: 'floor' } as Json, { now: T0 + 2, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'bailout', { accept: true } as Json, { now: T0 + 3, entropy: () => 1 }).state;
  assert.equal(state.players.a!.status, 'active');
  const result = applyCasino(engines, state, 'b', 'tick', null, { now: T0 + MATCH_MS, entropy: () => 1 });
  assert.equal(result.finished, true);
  assert.equal(result.state.phase, 'results');
  const view = viewCasino(engines, result.state, 'b');
  assert.equal(view.phase, 'results');
  assert.equal(view.results!.length, 2);
  assert.equal(view.results![0]!.id, 'b');
  assert.equal(view.results![1]!.id, 'a');
  assert.equal(view.results![1]!.adjusted, 0);
  assert.throws(() => applyCasino(engines, result.state, 'b', 'bet', { amount: 1 } as Json, { now: T0 + MATCH_MS + 1, entropy: () => 1 }));
});

test('reconcile marks leavers out and welcomes late joiners', () => {
  const engines = stubRegistry();
  let state = createCasino(engines, ['a', 'b'], { now: T0, entropy: () => 1 });
  state = seat(engines, state, 'b', 'roulette');
  let next = reconcileCasino(engines, state, ['a', 'c'], { now: T0 + 60_000, entropy: () => 1 });
  assert.equal(next.state.players.b!.status, 'out');
  assert.equal(next.state.players.b!.outReason, 'left');
  assert.equal(next.state.players.c!.bankroll, START_BANKROLL);
  assert.equal(viewCasino(engines, next.state, 'c').vault!.bankroll, START_BANKROLL);
  next = reconcileCasino(engines, next.state, ['a', 'c', 'd'], { now: T0 + 61_000, entropy: () => 1 });
  assert.equal(next.state.players.d!.bankroll, START_BANKROLL);
  assert.equal(engines.blackjack.occupants(next.state.tables.blackjack).length, 0);
  assert.equal(state.players.b!.status, 'active');
});

test('a broke player can spectate tables but never re-enters a betting seat', () => {
  const engines = stubRegistry();
  let state = createCasino(engines, ['a'], { now: T0, entropy: () => 1 });
  state = seat(engines, state, 'a', 'slots');
  state = applyCasino(engines, state, 'a', 'bet', { amount: 1000 } as Json, { now: T0 + 1, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'sit', { at: 'floor' } as Json, { now: T0 + 2, entropy: () => 1 }).state;
  state = applyCasino(engines, state, 'a', 'bailout', { accept: false } as Json, { now: T0 + 3, entropy: () => 1 }).state;
  assert.equal(state.players.a!.status, 'out');
  state = applyCasino(engines, state, 'a', 'sit', { at: 'blackjack' } as Json, { now: T0 + 4, entropy: () => 1 }).state;
  assert.equal(state.players.a!.at, 'blackjack');
  const view = viewCasino(engines, state, 'a');
  assert.equal(view.table !== null, true);
  assert.equal(view.tables.blackjack.occupants.includes('a'), true);
  assert.equal(view.tables.blackjack.seats, 1);
  assert.throws(() => applyCasino(engines, state, 'a', 'bet', { amount: 1 } as Json, { now: T0 + 5, entropy: () => 1 }));
});

test('an out player holding chips cannot take a betting seat', () => {
  const engines = stubRegistry();
  const state = createCasino(engines, ['a', 'b'], { now: T0, entropy: () => 1 });
  const left = reconcileCasino(engines, state, ['a'], { now: T0 + 1, entropy: () => 1 }).state;
  assert.equal(left.players.b!.status, 'out');
  assert.ok(left.players.b!.bankroll > 0);
  assert.throws(() => applyCasino(engines, left, 'b', 'sit', { at: 'roulette' } as Json, { now: T0 + 2, entropy: () => 1 }), /out of the match/);
});
