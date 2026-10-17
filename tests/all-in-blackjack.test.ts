import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { applyCasino, createCasino, viewCasino } from '../games/all-in/src/core/casino.ts';
import { cardRank, freshDeck } from '../games/all-in/src/core/cards.ts';
import { MATCH_MS, START_BANKROLL } from '../games/all-in/src/core/economy.ts';
import { shuffled } from '../games/all-in/src/core/rng.ts';
import type {
  ActionCtx, CasinoState, Engine, EngineRegistry, EngineSummary, HostClock, TableId,
} from '../games/all-in/src/core/types.ts';
import {
  BLACKJACK_BETTING_MS, BLACKJACK_DECISION_MS, BLACKJACK_RESULTS_MS, BLACKJACK_SEATS,
  blackjackEngine, handValue, type BlackjackState, type BlackjackView,
} from '../games/all-in/src/games/blackjack.ts';

type StubState = { occupants: string[] };

function stubEngine(id: TableId): Engine<StubState> {
  return {
    id,
    create() { return { occupants: [] }; },
    join(state, playerId) { state.occupants.push(playerId); },
    leave(state, playerId) { state.occupants = state.occupants.filter(item => item !== playerId); },
    act() { throw new Error('Unavailable.'); },
    tick() {},
    settle() {},
    pending() { return false; },
    occupants(state) { return [...state.occupants]; },
    view(state, viewerId) { return { occupants: [...state.occupants], viewer: viewerId }; },
    summary(state): EngineSummary { return { mode: 'solo', limit: 8, info: { seated: state.occupants.length } }; },
  };
}

function testRegistry(): EngineRegistry {
  return {
    blackjack: blackjackEngine,
    roulette: stubEngine('roulette'), slots: stubEngine('slots'),
    plinko: stubEngine('plinko'), poker: stubEngine('poker'),
  };
}

const T0 = 1_000_000;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0);
}

function host(now: number, seed = 1): HostClock {
  return { now, entropy: lcg(seed) };
}

function play(engines: EngineRegistry, state: CasinoState, playerId: string | null, action: string, payload: Json, now: number, seed = 1): CasinoState {
  return applyCasino(engines, state, playerId, action, payload, host(now, seed)).state;
}

function seat(engines: EngineRegistry, state: CasinoState, playerId: string, at: string, now: number): CasinoState {
  return play(engines, state, playerId, 'sit', { at }, now);
}

function table(state: CasinoState): BlackjackState {
  return state.tables.blackjack as BlackjackState;
}

function tableView(engines: EngineRegistry, state: CasinoState, viewerId: string): BlackjackView {
  return viewCasino(engines, state, viewerId).table as BlackjackView;
}

type Deal = { players: number[][]; dealer: number[] };

function dealFrom(seed: number, count: number): { deck: number[]; deal: Deal } {
  const deck = shuffled(freshDeck(), lcg(seed));
  let at = 0;
  const players = Array.from({ length: count }, () => [deck[at++]!]);
  const dealer = [deck[at++]!];
  for (const hand of players) hand.push(deck[at++]!);
  dealer.push(deck[at++]!);
  return { deck, deal: { players, dealer } };
}

function dealerFinal(seed: number, count: number): number[] {
  const { deck, deal } = dealFrom(seed, count);
  let at = 2 * count + 2;
  while (handValue(deal.dealer) < 17) deal.dealer.push(deck[at++]!);
  return deal.dealer;
}

function findSeed(count: number, match: (seed: number, deal: Deal) => boolean): number {
  for (let seed = 1; seed <= 1_000_000; seed += 1) {
    const { deal } = dealFrom(seed, count);
    if (match(seed, deal)) return seed;
  }
  throw new Error('No matching shuffle.');
}

function directCtx(casino: CasinoState, now: number): ActionCtx {
  return {
    now,
    entropy: lcg(1),
    bankroll: playerId => casino.players[playerId]?.bankroll ?? 0,
    cash: (playerId, delta) => {
      const ledger = casino.players[playerId]!;
      ledger.bankroll += delta;
      if (ledger.bankroll > ledger.peak) ledger.peak = ledger.bankroll;
    },
    result: (playerId, game, net) => {
      const ledger = casino.players[playerId]!;
      ledger.rounds += 1;
      ledger.byGame[game] += 1;
      if (net > ledger.biggestWin) ledger.biggestWin = net;
      if (net < ledger.biggestLoss) ledger.biggestLoss = net;
    },
    announce: () => {},
  };
}

test('handValue counts aces soft and hard', () => {
  assert.equal(handValue([0, 20]), 17);
  assert.equal(handValue([0, 20, 36]), 17);
  assert.equal(handValue([0, 0]), 12);
  assert.equal(handValue([0, 0, 32]), 21);
  assert.equal(handValue([0, 0, 0, 0, 16]), 19);
  assert.equal(handValue([48, 36]), 20);
  assert.equal(handValue([0, 48]), 21);
  assert.equal(handValue([]), 0);
});

test('solo bet deals at once and a natural pays 3:2 with floored odds', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) === 21 && handValue(deal.dealer) !== 21);
  const dealt = dealFrom(seed, 1).deal;
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  assert.equal(tableView(engines, state, 'a').phase, 'idle');
  assert.deepEqual(tableView(engines, state, 'a').actions, ['bet']);
  state = play(engines, state, 'a', 'bet', { amount: 7 }, T0 + 2, seed);
  const view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'results');
  assert.equal(view.mode, 'solo');
  assert.equal(view.seats[0]!.id, 'a');
  assert.deepEqual(view.dealer.cards.slice(0, 2), dealt.dealer);
  const hand = view.seats[0]!.hands[0]!;
  assert.equal(hand.status, 'blackjack');
  assert.equal(hand.outcome, 'win');
  assert.equal(hand.payout, 17);
  assert.equal(state.players.a!.bankroll, START_BANKROLL + 10);
  assert.equal(state.players.a!.rounds, 1);
  assert.equal(state.players.a!.byGame.blackjack, 1);
  assert.equal(state.players.a!.biggestWin, 10);
  assert.equal(viewCasino(engines, state, 'a').feed.some(item => item.kind === 'bigwin'), false);
});

test('a natural against a dealer natural pushes the stake', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) === 21 && handValue(deal.dealer) === 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 2, seed);
  const view = tableView(engines, state, 'a');
  assert.equal(view.dealer.cards.length, 2);
  const hand = view.seats[0]!.hands[0]!;
  assert.equal(hand.status, 'blackjack');
  assert.equal(hand.outcome, 'push');
  assert.equal(hand.payout, 5);
  assert.equal(state.players.a!.bankroll, START_BANKROLL);
  assert.equal(state.players.a!.rounds, 1);
});

test('double doubles the stake, draws one card, then stands', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21 && cardRank(deal.players[0]![0]!) !== cardRank(deal.players[0]![1]!));
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 10 }, T0 + 2, seed);
  let view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'playing');
  assert.equal(view.turn, 'a');
  assert.deepEqual(view.actions, ['hit', 'stand', 'double']);
  assert.equal(view.deadline, T0 + 2 + BLACKJACK_DECISION_MS);
  state = play(engines, state, 'a', 'double', null, T0 + 3, seed);
  view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'results');
  const hand = view.seats[0]!.hands[0]!;
  assert.equal(hand.cards.length, 3);
  assert.equal(hand.bet, 20);
  assert.ok(hand.status === 'doubled' || hand.status === 'busted');
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 20 + hand.payout!);
  const house = handValue(view.dealer.cards);
  const total = handValue(hand.cards);
  const expected = hand.status === 'busted' ? 'lose' : house > 21 || total > house ? 'win' : total < house ? 'lose' : 'push';
  assert.equal(hand.outcome, expected);
  assert.equal(hand.payout, hand.outcome === 'win' ? 40 : hand.outcome === 'push' ? 20 : 0);
});

test('double and split are rejected when the cards do not allow them', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) <= 8);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 2, seed);
  state = play(engines, state, 'a', 'hit', null, T0 + 3, seed);
  const view = tableView(engines, state, 'a');
  assert.equal(view.seats[0]!.hands[0]!.cards.length, 3);
  assert.equal(view.phase, 'playing');
  assert.throws(() => play(engines, state, 'a', 'double', null, T0 + 4, seed), /You can only double on two cards\./);
  assert.throws(() => play(engines, state, 'a', 'split', null, T0 + 4, seed), /You can only split a pair\./);
});

test('split plays two hands and matches the dealt pair', () => {
  const seed = findSeed(1, (_seed, deal) => cardRank(deal.players[0]![0]!) === cardRank(deal.players[0]![1]!) && cardRank(deal.players[0]![0]!) > 1);
  const dealt = dealFrom(seed, 1).deal;
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 10 }, T0 + 2, seed);
  assert.ok(tableView(engines, state, 'a').actions.includes('split'));
  state = play(engines, state, 'a', 'split', null, T0 + 3, seed);
  let view = tableView(engines, state, 'a');
  assert.equal(view.seats[0]!.hands.length, 2);
  assert.equal(view.seats[0]!.hands[0]!.cards.length, 2);
  assert.equal(view.seats[0]!.hands[1]!.cards.length, 2);
  assert.equal(view.seats[0]!.hands[0]!.cards[0], dealt.players[0]![0]);
  assert.equal(view.seats[0]!.hands[1]!.cards[0], dealt.players[0]![1]);
  assert.equal(view.seats[0]!.hands[0]!.bet, 10);
  assert.equal(view.seats[0]!.hands[1]!.bet, 10);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 20);
  assert.equal(view.turn, 'a');
  assert.deepEqual(view.actions, ['hit', 'stand', 'double']);
  state = play(engines, state, 'a', 'stand', null, T0 + 4, seed);
  assert.equal(tableView(engines, state, 'a').turn, 'a');
  state = play(engines, state, 'a', 'stand', null, T0 + 5, seed);
  view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'results');
  for (const hand of view.seats[0]!.hands) assert.ok(hand.outcome !== null);
  const returned = view.seats[0]!.hands.reduce((sum, hand) => sum + (hand.payout ?? 0), 0);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 20 + returned);
  assert.equal(state.players.a!.rounds, 1);
});

test('split aces take one card each and stand automatically', () => {
  const seed = findSeed(1, (_seed, deal) => cardRank(deal.players[0]![0]!) === 1 && cardRank(deal.players[0]![1]!) === 1);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 10 }, T0 + 2, seed);
  assert.ok(tableView(engines, state, 'a').actions.includes('split'));
  state = play(engines, state, 'a', 'split', null, T0 + 3, seed);
  const view = tableView(engines, state, 'a');
  assert.equal(view.seats[0]!.hands.length, 2);
  for (const hand of view.seats[0]!.hands) {
    assert.equal(hand.cards.length, 2);
    assert.equal(hand.status, 'stood');
  }
  assert.equal(view.phase, 'results');
  assert.equal(view.turn, null);
  const returned = view.seats[0]!.hands.reduce((sum, hand) => sum + (hand.payout ?? 0), 0);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 20 + returned);
});

test('tick auto-stands a hand once its decision deadline passes', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 2, seed);
  const deadline = T0 + 2 + BLACKJACK_DECISION_MS;
  state = play(engines, state, null, 'tick', null, deadline - 1);
  assert.equal(table(state).phase, 'playing');
  state = play(engines, state, null, 'tick', null, deadline);
  const done = table(state);
  assert.equal(done.phase, 'results');
  assert.equal(done.seats.a!.hands[0]!.status, 'stood');
  assert.equal(state.players.a!.rounds, 1);
  assert.equal(done.deadline, deadline + BLACKJACK_RESULTS_MS);
});

test('a shared table bets for 10s and deals to every bettor in seat order', () => {
  const seed = findSeed(2, (_seed, deal) => deal.players.every(hand => handValue(hand) < 21));
  const dealt = dealFrom(seed, 2).deal;
  const engines = testRegistry();
  let state = createCasino(engines, ['a', 'b'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  assert.equal(tableView(engines, state, 'a').phase, 'idle');
  state = seat(engines, state, 'b', 'blackjack', T0 + 2);
  let view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'betting');
  assert.equal(view.mode, 'shared');
  assert.equal(view.deadline, T0 + 2 + BLACKJACK_BETTING_MS);
  assert.deepEqual(view.actions, ['bet']);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 3, seed);
  state = play(engines, state, 'b', 'bet', { amount: 10 }, T0 + 4, seed);
  view = tableView(engines, state, 'b');
  assert.equal(view.phase, 'betting');
  assert.equal(view.deadline, T0 + 2 + BLACKJACK_BETTING_MS);
  assert.deepEqual(view.actions, []);
  assert.throws(() => play(engines, state, 'b', 'bet', { amount: 5 }, T0 + 5, seed), /You already placed a bet\./);
  state = play(engines, state, null, 'tick', null, T0 + 2 + BLACKJACK_BETTING_MS - 1);
  assert.equal(table(state).phase, 'betting');
  state = play(engines, state, null, 'tick', null, T0 + 2 + BLACKJACK_BETTING_MS, seed);
  view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'playing');
  assert.equal(view.turn, 'a');
  assert.equal(view.deadline, T0 + 2 + BLACKJACK_BETTING_MS + BLACKJACK_DECISION_MS);
  assert.deepEqual(view.seats[0]!.hands[0]!.cards, dealt.players[0]);
  assert.deepEqual(view.seats[1]!.hands[0]!.cards, dealt.players[1]);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 5);
  assert.equal(state.players.b!.bankroll, START_BANKROLL - 10);
  assert.deepEqual(view.actions, ['hit', 'stand', 'double']);
  assert.throws(() => play(engines, state, 'b', 'hit', null, T0 + 6, seed), /Wait for your turn\./);
  state = play(engines, state, 'a', 'stand', null, T0 + 6, seed);
  assert.equal(tableView(engines, state, 'a').turn, 'b');
  state = play(engines, state, 'b', 'stand', null, T0 + 7, seed);
  view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'results');
  assert.equal(state.players.a!.rounds, 1);
  assert.equal(state.players.b!.rounds, 1);
});

test('an empty shared window closes and reopens on the next bet', () => {
  const engines = testRegistry();
  let state = createCasino(engines, ['a', 'b'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = seat(engines, state, 'b', 'blackjack', T0 + 2);
  const deadline = T0 + 2 + BLACKJACK_BETTING_MS;
  state = play(engines, state, null, 'tick', null, deadline);
  const closed = tableView(engines, state, 'a');
  assert.equal(closed.phase, 'idle');
  assert.equal(closed.deadline, 0);
  assert.equal(closed.mode, 'shared');
  assert.deepEqual(closed.actions, ['bet']);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, deadline + 1);
  const open = tableView(engines, state, 'a');
  assert.equal(open.phase, 'betting');
  assert.equal(open.deadline, deadline + 1 + BLACKJACK_BETTING_MS);
});

test('leaving during the betting window keeps the wager and settles it', () => {
  const seed = findSeed(2, (_seed, deal) => deal.players.every(hand => handValue(hand) < 21));
  const engines = testRegistry();
  let state = createCasino(engines, ['a', 'b'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = seat(engines, state, 'b', 'blackjack', T0 + 2);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 3, seed);
  state = play(engines, state, 'a', 'sit', { at: 'floor' }, T0 + 4, seed);
  assert.equal(table(state).phase, 'betting');
  assert.equal(table(state).betting.a, 5);
  state = play(engines, state, 'b', 'bet', { amount: 10 }, T0 + 5, seed);
  state = play(engines, state, 'b', 'sit', { at: 'floor' }, T0 + 6, seed);
  const done = table(state);
  assert.equal(done.phase, 'results');
  assert.deepEqual(done.occupants, []);
  for (const hand of done.seats.a!.hands) assert.equal(hand.status, 'stood');
  for (const hand of done.seats.b!.hands) assert.equal(hand.status, 'stood');
  assert.equal(state.players.a!.rounds, 1);
  assert.equal(state.players.b!.rounds, 1);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 5 + done.seats.a!.hands[0]!.payout!);
  assert.equal(state.players.b!.bankroll, START_BANKROLL - 10 + done.seats.b!.hands[0]!.payout!);
});

test('leaving mid-hand auto-stands and settles the committed wager', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 25 }, T0 + 2, seed);
  assert.equal(table(state).phase, 'playing');
  state = play(engines, state, 'a', 'sit', { at: 'floor' }, T0 + 3, seed);
  const done = table(state);
  assert.equal(done.phase, 'results');
  assert.deepEqual(done.occupants, []);
  assert.equal(done.seats.a!.hands[0]!.status, 'stood');
  assert.equal(state.players.a!.at, 'floor');
  assert.equal(state.players.a!.rounds, 1);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 25 + done.seats.a!.hands[0]!.payout!);
});

test('settle resolves a live round and stays idempotent', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 40 }, T0 + 2, seed);
  const live = table(state);
  assert.equal(live.phase, 'playing');
  const ctx = directCtx(state, T0 + MATCH_MS);
  blackjackEngine.settle(live, ctx);
  const payout = live.seats.a!.hands[0]!.payout!;
  assert.equal(live.phase, 'results');
  assert.equal(state.players.a!.rounds, 1);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 40 + payout);
  blackjackEngine.settle(live, ctx);
  assert.equal(state.players.a!.bankroll, START_BANKROLL - 40 + payout);
  assert.equal(state.players.a!.rounds, 1);
});

test('the match deadline settles an outstanding round through the casino', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 60 }, T0 + MATCH_MS - 1_000, seed);
  assert.equal(table(state).phase, 'playing');
  const result = applyCasino(engines, state, null, 'tick', null, host(T0 + MATCH_MS, seed));
  assert.equal(result.finished, true);
  const done = table(result.state);
  assert.equal(done.phase, 'results');
  assert.equal(done.deadline, 0);
  const hand = done.seats.a!.hands[0]!;
  assert.equal(hand.status, 'stood');
  assert.equal(result.state.players.a!.rounds, 1);
  assert.equal(result.state.players.a!.bankroll, START_BANKROLL - 60 + hand.payout!);
  const again = applyCasino(engines, result.state, null, 'tick', null, host(T0 + MATCH_MS + 5_000, seed));
  assert.equal(again.state.players.a!.bankroll, result.state.players.a!.bankroll);
  assert.equal(again.state.players.a!.rounds, 1);
});

test('the hole card stays hidden until the dealer reveals', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const dealt = dealFrom(seed, 1).deal;
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 2, seed);
  const view = tableView(engines, state, 'a');
  assert.equal(view.phase, 'playing');
  assert.deepEqual(view.dealer.cards, [dealt.dealer[0]]);
  assert.equal(view.dealer.value, handValue([dealt.dealer[0]!]));
  assert.ok(!JSON.stringify(view).includes(`[${dealt.dealer[0]},${dealt.dealer[1]}]`));
  const publicView = blackjackEngine.view(table(state), null) as BlackjackView;
  assert.deepEqual(publicView.dealer.cards, [dealt.dealer[0]]);
  assert.deepEqual(publicView.actions, []);
  state = play(engines, state, 'a', 'stand', null, T0 + 3, seed);
  assert.deepEqual(tableView(engines, state, 'a').dealer.cards.slice(0, 2), dealt.dealer);
});

test('a broke occupant watches but is never dealt in', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a', 'b'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  assert.equal(tableView(engines, state, 'a').phase, 'idle');
  state = play(engines, state, 'a', 'bet', { amount: 25 }, T0 + 2, seed);
  assert.equal(table(state).phase, 'playing');
  state = seat(engines, state, 'b', 'blackjack', T0 + 3);
  assert.equal(table(state).seats.b, undefined);
  state.players.b!.bankroll = 0;
  state = play(engines, state, 'a', 'stand', null, T0 + 4, seed);
  assert.equal(state.players.b!.status, 'offered');
  const round = table(state);
  assert.equal(round.phase, 'results');
  assert.deepEqual(round.order, ['a']);
  assert.equal(round.seats.b, undefined);
  state = play(engines, state, null, 'tick', null, T0 + 4 + BLACKJACK_RESULTS_MS, seed);
  const next = tableView(engines, state, 'a');
  assert.equal(next.phase, 'idle');
  assert.equal(next.mode, 'solo');
  assert.equal(next.seats[1]!.id, 'b');
  assert.deepEqual(next.seats[1]!.hands, []);
  state = play(engines, state, 'a', 'bet', { amount: 25 }, T0 + 9, seed);
  assert.equal(table(state).phase, 'playing');
  assert.equal(table(state).seats.b, undefined);
  state = play(engines, state, 'b', 'sit', { at: 'roulette' }, T0 + 10, seed);
  assert.deepEqual(table(state).occupants, ['a']);
});

test('a committed player is pending until the round settles', () => {
  const seed = findSeed(1, (candidate, deal) => {
    const player = handValue(deal.players[0]!);
    const house = handValue(dealerFinal(candidate, 1));
    return player <= 16 && house <= 21 && house > player;
  });
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 10 }, T0 + 2, seed);
  state.players.a!.bankroll = 0;
  state = play(engines, state, null, 'tick', null, T0 + 3);
  assert.equal(state.players.a!.status, 'active');
  state = play(engines, state, 'a', 'stand', null, T0 + 4, seed);
  assert.equal(state.players.a!.bankroll, 0);
  assert.equal(state.players.a!.status, 'offered');
});

test('a round net of at least 150 announces a bigwin', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) === 21 && handValue(deal.dealer) !== 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  state = play(engines, state, 'a', 'bet', { amount: 100 }, T0 + 2, seed);
  assert.equal(tableView(engines, state, 'a').seats[0]!.hands[0]!.payout, 250);
  const win = viewCasino(engines, state, 'a').feed.find(item => item.kind === 'bigwin' && item.playerId === 'a');
  assert.ok(win !== undefined);
  assert.equal(win.amount, 150);
});

test('the table seats five and invalid bets change nothing', () => {
  const engines = testRegistry();
  let state = createCasino(engines, ['a', 'b', 'c', 'd', 'e', 'f'], host(T0));
  for (const id of ['a', 'b', 'c', 'd', 'e']) state = seat(engines, state, id, 'blackjack', T0 + 1);
  assert.equal(viewCasino(engines, state, 'a').tables.blackjack.seats, BLACKJACK_SEATS);
  assert.throws(() => seat(engines, state, 'f', 'blackjack', T0 + 2), /Table is full\./);
  assert.deepEqual(blackjackEngine.occupants(table(state)), ['a', 'b', 'c', 'd', 'e']);
  assert.throws(() => play(engines, state, 'a', 'bet', { amount: 0 }, T0 + 3), /Invalid amount\./);
  assert.throws(() => play(engines, state, 'a', 'bet', { amount: 10_001 }, T0 + 3), /Invalid amount\./);
  assert.throws(() => play(engines, state, 'a', 'bet', { amount: 2.5 }, T0 + 3), /Invalid amount\./);
  assert.throws(() => play(engines, state, 'a', 'stand', null, T0 + 3), /No hand is in play\./);
});

test('solo betting stays immediate after a round and rejects unaffordable bets', () => {
  const seed = findSeed(1, (_seed, deal) => handValue(deal.players[0]!) < 21);
  const engines = testRegistry();
  let state = createCasino(engines, ['a'], host(T0));
  state = seat(engines, state, 'a', 'blackjack', T0 + 1);
  assert.deepEqual(blackjackEngine.summary(table(state)), { mode: 'solo', limit: BLACKJACK_SEATS, info: { phase: 'idle', turn: null } });
  state = play(engines, state, 'a', 'bet', { amount: 7 }, T0 + 2, seed);
  assert.throws(() => play(engines, state, 'a', 'bet', { amount: 7 }, T0 + 3, seed), /Wait for the next round\./);
  state = play(engines, state, null, 'tick', null, T0 + 2 + BLACKJACK_DECISION_MS, seed);
  assert.equal(table(state).phase, 'results');
  state = play(engines, state, null, 'tick', null, T0 + 2 + BLACKJACK_DECISION_MS + BLACKJACK_RESULTS_MS, seed);
  assert.equal(tableView(engines, state, 'a').phase, 'idle');
  state.players.a!.bankroll = 3;
  assert.throws(() => play(engines, state, 'a', 'bet', { amount: 5 }, T0 + 30_000, seed), /Not enough chips\./);
  state = play(engines, state, 'a', 'bet', { amount: 3 }, T0 + 30_000, seed);
  assert.equal(table(state).phase, 'playing');
  assert.equal(state.players.a!.bankroll, 0);
  assert.deepEqual(viewCasino(engines, state, 'a').tables.blackjack, {
    seats: 1, limit: BLACKJACK_SEATS, mode: 'solo', info: { phase: 'playing', turn: 'a' }, occupants: ['a'],
  });
});
