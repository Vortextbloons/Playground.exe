import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCasino, createCasino, viewCasino } from '../games/all-in/src/core/casino.ts';
import { mulberry32 } from '../games/all-in/src/core/rng.ts';
import { MATCH_MS, START_BANKROLL } from '../games/all-in/src/core/economy.ts';
import {
  CATEGORY_NAMES, ROYAL_MULTIPLIER, VIDEO_PAYTABLE, evaluate5, handCategory, videoCoinWin,
} from '../games/all-in/src/games/poker-eval.ts';
import {
  POKER_ANTE, POKER_BET, POKER_LIMIT, POKER_MAX_RAISES, POKER_RESULTS_MS, POKER_SEATS, POKER_TURN_MS, pokerEngine,
} from '../games/all-in/src/games/poker.ts';
import type { PokerHandState, PokerState, PokerView } from '../games/all-in/src/games/poker.ts';
import type { ActionCtx, Engine, EngineRegistry, TableId } from '../games/all-in/src/core/types.ts';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';

function stubEngine(id: TableId): Engine<{ occupied: boolean }> {
  return {
    id,
    create() { return { occupied: false }; },
    join() {},
    leave() {},
    act() { throw new Error('Unknown action.'); },
    tick() {},
    settle() {},
    pending() { return false; },
    occupants() { return []; },
    view(_state, viewerId) { return { viewer: viewerId }; },
    summary() { return { mode: 'solo', limit: 8, info: { table: id } }; },
  };
}

function stubRegistry(): EngineRegistry {
  return {
    blackjack: stubEngine('blackjack'), roulette: stubEngine('roulette'), slots: stubEngine('slots'),
    plinko: stubEngine('plinko'), poker: pokerEngine,
  };
}

const T0 = 1_000_000;

type Clock = { now: number; entropy: () => number };

type Fixture = {
  engines: EngineRegistry;
  state: ReturnType<typeof createCasino>;
  clock: Clock;
};

function makeFixture(players: string[], seed = 5): Fixture {
  const rng = mulberry32(seed);
  const clock: Clock = { now: T0, entropy: () => Math.floor(rng() * 4294967296) };
  const engines = stubRegistry();
  const state = createCasino(engines, players, clock);
  return { engines, state, clock };
}

function step(f: Fixture, playerId: string | null, action: string, payload: Json = null): void {
  f.state = applyCasino(f.engines, f.state, playerId, action, payload, f.clock).state;
}

function seat(f: Fixture, playerId: string): void {
  step(f, playerId, 'sit', { at: 'poker' } as Json);
}

function table(f: Fixture): PokerState {
  return f.state.tables.poker as unknown as PokerState;
}

function hand(f: Fixture): PokerHandState {
  const current = table(f).hand;
  assert.ok(current, 'expected a poker hand');
  return current;
}

function tableView(f: Fixture, viewerId: string): PokerView {
  return viewCasino(f.engines, f.state, viewerId).table as unknown as PokerView;
}

function bankroll(f: Fixture, playerId: string): number {
  return f.state.players[playerId]!.bankroll;
}

function setStacks(f: Fixture, stacks: Record<string, number>): void {
  for (const [id, chips] of Object.entries(stacks)) f.state.players[id]!.bankroll = chips;
}

function setCards(f: Fixture, cards: Record<string, number[]>): void {
  const current = hand(f);
  for (const [id, values] of Object.entries(cards)) {
    const player = current.players.find(item => item.id === id);
    assert.ok(player, `expected ${id} in hand`);
    player.cards = values;
  }
}

const HOLD_ALL: readonly boolean[] = [true, true, true, true, true];

function playOutHand(f: Fixture, button: string, actor: string): void {
  step(f, actor, 'check');
  step(f, button, 'check');
  step(f, actor, 'draw', { holds: [...HOLD_ALL] } as Json);
  step(f, button, 'draw', { holds: [...HOLD_ALL] } as Json);
  step(f, actor, 'check');
  step(f, button, 'check');
}

function startShared(f: Fixture, ids: string[], stacks: number[]): void {
  seat(f, ids[0]!);
  seat(f, ids[1]!);
  for (const id of ids.slice(2)) seat(f, id);
  playOutHand(f, ids[0]!, ids[1]!);
  setStacks(f, Object.fromEntries(ids.map((id, index) => [id, stacks[index]!])));
  f.clock.now += POKER_RESULTS_MS;
  step(f, null, 'tick');
}

function directCtx(f: Fixture): ActionCtx {
  const state = f.state;
  return {
    now: f.clock.now,
    entropy: f.clock.entropy,
    bankroll: playerId => state.players[playerId]?.bankroll ?? 0,
    cash: (playerId, delta) => { state.players[playerId]!.bankroll += delta; },
    result: () => {},
    announce: () => {},
  };
}

const card = (rank: number, suit: number): number => (rank - 1) * 4 + suit;

const ROYAL = [card(10, 3), card(11, 3), card(12, 3), card(13, 3), card(1, 3)];
const STRAIGHT_FLUSH = [card(5, 2), card(6, 2), card(7, 2), card(8, 2), card(9, 2)];
const QUADS = [card(9, 0), card(9, 1), card(9, 2), card(9, 3), card(13, 0)];
const FULL_HOUSE = [card(4, 0), card(4, 1), card(4, 2), card(9, 0), card(9, 1)];
const FLUSH = [card(2, 1), card(5, 1), card(8, 1), card(11, 1), card(13, 1)];
const STRAIGHT = [card(2, 0), card(3, 1), card(4, 2), card(5, 3), card(6, 0)];
const TRIPS = [card(7, 0), card(7, 1), card(7, 2), card(13, 3), card(2, 0)];
const TWO_PAIR = [card(3, 0), card(3, 1), card(5, 2), card(5, 3), card(9, 0)];
const JACK_PAIR = [card(11, 0), card(11, 1), card(2, 2), card(5, 3), card(8, 0)];
const TEN_PAIR = [card(10, 0), card(10, 1), card(2, 2), card(5, 3), card(8, 0)];
const WHEEL = [card(1, 0), card(2, 1), card(3, 2), card(4, 3), card(5, 0)];
const LOW_STRAIGHT = [card(2, 0), card(3, 1), card(4, 2), card(5, 3), card(6, 0)];
const HIGH_CARD = [card(1, 0), card(13, 1), card(9, 2), card(7, 3), card(5, 0)];

test('poker-eval grades every category, kickers, wheels, and ties', () => {
  assert.equal(evaluate5(HIGH_CARD), evaluate5(HIGH_CARD));
  assert.equal(handCategory(evaluate5(HIGH_CARD)), 0);
  assert.equal(handCategory(evaluate5(JACK_PAIR)), 1);
  assert.equal(handCategory(evaluate5(TWO_PAIR)), 2);
  assert.equal(handCategory(evaluate5(TRIPS)), 3);
  assert.equal(handCategory(evaluate5(WHEEL)), 4);
  assert.equal(handCategory(evaluate5(FLUSH)), 5);
  assert.equal(handCategory(evaluate5(FULL_HOUSE)), 6);
  assert.equal(handCategory(evaluate5(QUADS)), 7);
  assert.equal(handCategory(evaluate5(STRAIGHT_FLUSH)), 8);
  assert.equal(handCategory(evaluate5(ROYAL)), 8);
  assert.deepEqual([...VIDEO_PAYTABLE], [0, 1, 2, 3, 4, 6, 9, 25, 50]);
  assert.equal(CATEGORY_NAMES.length, 9);
  assert.equal(CATEGORY_NAMES[8], 'Straight flush');

  assert.ok(evaluate5(LOW_STRAIGHT) > evaluate5(WHEEL));
  const aceHighStraight = [card(11, 0), card(12, 1), card(13, 2), card(1, 3), card(10, 0)];
  assert.ok(evaluate5(aceHighStraight) > evaluate5(LOW_STRAIGHT));
  assert.ok(evaluate5(ROYAL) > evaluate5(STRAIGHT_FLUSH));
  assert.ok(evaluate5([card(1, 0), card(13, 1), card(12, 2), card(11, 3), card(9, 0)])
    > evaluate5([card(1, 0), card(13, 1), card(12, 2), card(11, 3), card(8, 0)]));
  assert.ok(evaluate5([card(9, 0), card(9, 1), card(13, 2), card(12, 3), card(11, 0)])
    > evaluate5([card(9, 2), card(9, 3), card(13, 0), card(12, 1), card(10, 0)]));
  assert.ok(evaluate5([card(4, 0), card(4, 1), card(4, 2), card(2, 0), card(2, 1)])
    > evaluate5([card(3, 0), card(3, 1), card(3, 2), card(1, 0), card(1, 1)]));
  assert.ok(evaluate5([card(1, 0), card(1, 1), card(13, 2), card(13, 3), card(12, 0)])
    > evaluate5([card(1, 0), card(1, 1), card(13, 2), card(13, 3), card(11, 0)]));
  assert.ok(evaluate5([card(1, 1), card(13, 1), card(12, 1), card(11, 1), card(8, 1)])
    > evaluate5([card(1, 2), card(13, 2), card(12, 2), card(11, 2), card(7, 2)]));
  assert.equal(
    evaluate5([card(13, 0), card(13, 1), card(3, 0), card(3, 1), card(1, 0)]),
    evaluate5([card(13, 2), card(13, 3), card(3, 2), card(3, 3), card(1, 1)]),
  );
  assert.throws(() => evaluate5([0, 1, 2, 3]), /five cards/);
});

test('video payouts follow the 9/6 table including the royal', () => {
  assert.equal(ROYAL_MULTIPLIER, 250);
  assert.equal(videoCoinWin(TEN_PAIR, 5), 0);
  assert.equal(videoCoinWin(JACK_PAIR, 5), 5);
  assert.equal(videoCoinWin(TWO_PAIR, 5), 10);
  assert.equal(videoCoinWin(TRIPS, 5), 15);
  assert.equal(videoCoinWin(STRAIGHT, 5), 20);
  assert.equal(videoCoinWin(FLUSH, 5), 30);
  assert.equal(videoCoinWin(FULL_HOUSE, 5), 45);
  assert.equal(videoCoinWin(QUADS, 5), 125);
  assert.equal(videoCoinWin(STRAIGHT_FLUSH, 5), 250);
  assert.equal(videoCoinWin(ROYAL, 5), 1250);
  assert.equal(videoCoinWin(ROYAL, 1), 250);
  assert.equal(videoCoinWin(JACK_PAIR, 1), 1);
});

test('video hands pay the table, report results, and feed big wins', () => {
  const f = makeFixture(['a']);
  assert.equal(bankroll(f, 'a'), START_BANKROLL);
  seat(f, 'a');
  assert.deepEqual(tableView(f, 'a').actions, ['deal']);
  assert.equal(tableView(f, 'a').you.video, null);
  assert.throws(() => step(f, 'a', 'deal', { coins: 6 } as Json), /Invalid coins/);

  step(f, 'a', 'deal', { coins: 5 } as Json);
  assert.equal(bankroll(f, 'a'), 995);
  assert.equal(pokerEngine.pending(table(f), 'a'), true);
  assert.deepEqual(tableView(f, 'a').actions, ['draw']);
  const video = table(f).video.a!;
  assert.equal(video.coins, 5);
  assert.deepEqual(tableView(f, 'a').you.video!.cards, video.cards);

  video.cards = [...ROYAL];
  step(f, 'a', 'draw', { holds: [...HOLD_ALL] } as Json);
  assert.equal(bankroll(f, 'a'), 995 + 1250);
  assert.equal(f.state.players.a!.rounds, 1);
  assert.equal(f.state.players.a!.byGame.poker, 1);
  assert.equal(f.state.players.a!.biggestWin, 1245);
  assert.equal(pokerEngine.pending(table(f), 'a'), false);
  assert.equal(f.state.feed.filter(item => item.kind === 'bigwin' && item.playerId === 'a').length, 1);

  step(f, 'a', 'deal', { coins: 5 } as Json);
  table(f).video.a!.cards = [...TEN_PAIR];
  step(f, 'a', 'draw', { holds: [...HOLD_ALL] } as Json);
  assert.equal(bankroll(f, 'a'), 2240);
  assert.equal(f.state.players.a!.rounds, 2);
  assert.equal(f.state.players.a!.biggestLoss, -5);
  assert.equal(f.state.feed.filter(item => item.kind === 'bigwin').length, 1);

  step(f, 'a', 'deal', { coins: 1 } as Json);
  table(f).video.a!.cards = [...JACK_PAIR];
  step(f, 'a', 'draw', { holds: [...HOLD_ALL] } as Json);
  assert.equal(bankroll(f, 'a'), 2240);
  assert.equal(f.state.players.a!.rounds, 3);
});

test('video hands are untimed and private to their owner', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  step(f, 'a', 'deal', { coins: 5 } as Json);
  const own = table(f).video.a!.cards;
  f.clock.now += 60_000;
  seat(f, 'b');
  assert.equal(table(f).hand, null);
  assert.ok(table(f).video.a);
  const forB = tableView(f, 'b');
  assert.equal(forB.you.video, null);
  assert.equal(forB.table, null);
  assert.ok(!JSON.stringify(forB).includes(JSON.stringify(own)));
  assert.deepEqual(tableView(f, 'a').you.video!.cards, own);
  step(f, 'a', 'draw', { holds: [...HOLD_ALL] } as Json);
  assert.equal(table(f).video.a, undefined);
  assert.equal(f.state.players.a!.rounds, 1);
  assert.equal(pokerEngine.pending(table(f), 'a'), false);
});

test('video deal is rejected while a shared hand is running', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  assert.throws(() => step(f, 'a', 'deal', { coins: 1 } as Json), /poker hand/);
});

test('betting enforces turns, checks, calls, the raise cap, and folds', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  assert.equal(hand(f).phase, 'bet1');
  assert.equal(tableView(f, 'b').table!.turn, 'b');
  assert.deepEqual(tableView(f, 'b').actions, ['check', 'raise', 'fold']);
  assert.throws(() => step(f, 'a', 'check'), /not your turn/);

  step(f, 'b', 'check');
  step(f, 'a', 'raise');
  assert.equal(hand(f).currentBet, POKER_BET);
  assert.throws(() => step(f, 'b', 'check'), /bet to call/);
  step(f, 'b', 'call');
  assert.equal(bankroll(f, 'a'), 985);
  assert.equal(bankroll(f, 'b'), 985);
  assert.equal(hand(f).phase, 'draw');

  step(f, 'b', 'draw', { holds: [...HOLD_ALL] } as Json);
  step(f, 'a', 'draw', { holds: [...HOLD_ALL] } as Json);
  assert.equal(hand(f).phase, 'bet2');
  step(f, 'b', 'raise');
  step(f, 'a', 'raise');
  step(f, 'b', 'raise');
  assert.equal(hand(f).raises, POKER_MAX_RAISES);
  assert.throws(() => step(f, 'a', 'raise'), /Raise limit/);
  step(f, 'a', 'call');
  assert.deepEqual([bankroll(f, 'a'), bankroll(f, 'b')].sort((x, y) => x - y), [955, 1045]);
  assert.equal(hand(f).phase, 'results');
  const nets = hand(f).results!.map(row => row.net);
  assert.deepEqual([...nets].sort((x, y) => x - y), [-45, 45]);
});

test('fold awards the pot and ends the hand', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  step(f, 'b', 'raise');
  step(f, 'a', 'fold');
  assert.equal(hand(f).phase, 'results');
  assert.deepEqual(hand(f).results!.map(row => row.net), [-5, 5]);
  assert.deepEqual([bankroll(f, 'a'), bankroll(f, 'b')], [995, 1005]);
});

test('turn timer auto-folds a player facing a bet', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  step(f, 'b', 'raise');
  f.clock.now += POKER_TURN_MS + 1;
  step(f, null, 'tick');
  assert.equal(hand(f).phase, 'results');
  assert.equal(hand(f).players[0]!.folded, true);
  assert.deepEqual(hand(f).results!.map(row => row.net), [-5, 5]);
  assert.deepEqual([bankroll(f, 'a'), bankroll(f, 'b')], [995, 1005]);
});

test('turn timer auto-checks when there is no bet', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  f.clock.now += POKER_TURN_MS + 1;
  step(f, null, 'tick');
  assert.equal(tableView(f, 'b').table!.turn, 'a');
  f.clock.now += POKER_TURN_MS + 1;
  step(f, null, 'tick');
  assert.equal(hand(f).phase, 'draw');
  assert.deepEqual([bankroll(f, 'a'), bankroll(f, 'b')], [995, 995]);
});

test('draw deadline auto-discards and play continues to the second round', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  step(f, 'b', 'check');
  step(f, 'a', 'check');
  assert.equal(hand(f).phase, 'draw');
  const before = hand(f).players.map(player => [...player.cards]);
  f.clock.now += POKER_TURN_MS + 1;
  step(f, null, 'tick');
  assert.equal(hand(f).phase, 'bet2');
  hand(f).players.forEach((player, index) => {
    const old = before[index]!;
    assert.ok(player.cards.every(item => !old.includes(item)));
  });
  f.clock.now += POKER_TURN_MS + 1;
  step(f, null, 'tick');
  f.clock.now += POKER_TURN_MS + 1;
  step(f, null, 'tick');
  assert.equal(hand(f).phase, 'results');
  const nets = hand(f).results!.map(row => row.net);
  assert.equal(nets[0]! + nets[1]!, 0);
  assert.equal(bankroll(f, 'a') + bankroll(f, 'b'), 2000);
});

test('all-in bets build layered side pots paid by hand strength', () => {
  const f = makeFixture(['a', 'b', 'c', 'd']);
  startShared(f, ['a', 'b', 'c', 'd'], [10, 20, 40, 100]);
  assert.deepEqual(hand(f).players.map(player => player.id), ['a', 'b', 'c', 'd']);
  assert.equal(table(f).button, 'b');
  setCards(f, {
    a: [32, 33, 34, 35, 0],
    b: [28, 29, 30, 24, 25],
    c: [1, 5, 13, 17, 21],
    d: [4, 9, 14, 19, 20],
  });
  assert.deepEqual(tableView(f, 'd').you.hand!.cards, [4, 9, 14, 19, 20]);
  assert.equal(tableView(f, 'd').table!.seats.find(s => s.id === 'a')!.cards, null);

  step(f, 'c', 'raise');
  step(f, 'd', 'raise');
  step(f, 'a', 'call');
  step(f, 'b', 'call');
  step(f, 'c', 'call');
  assert.deepEqual(hand(f).players.map(player => player.contributed), [10, 20, 25, 25]);
  assert.equal(hand(f).phase, 'draw');
  assert.deepEqual(hand(f).players.map(player => player.allin), [true, true, false, false]);

  step(f, 'c', 'draw', { holds: [...HOLD_ALL] } as Json);
  step(f, 'd', 'draw', { holds: [...HOLD_ALL] } as Json);
  assert.equal(hand(f).phase, 'bet2');
  step(f, 'c', 'check');
  step(f, 'd', 'check');
  assert.equal(hand(f).phase, 'results');
  assert.deepEqual(hand(f).results!.map(row => row.net), [30, 10, -15, -25]);
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => bankroll(f, id)), [40, 30, 25, 75]);
});

test('split pots round the remainder to the earliest winner in seat order', () => {
  const f = makeFixture(['a', 'b', 'c']);
  startShared(f, ['a', 'b', 'c'], [5, 1000, 1000]);
  assert.deepEqual(hand(f).players.map(player => player.id), ['a', 'b', 'c']);
  setCards(f, {
    a: [4, 11, 14, 17, 24],
    b: [card(1, 1), card(11, 1), card(12, 1), card(13, 1), card(9, 1)],
    c: [card(1, 2), card(11, 2), card(12, 2), card(13, 2), card(9, 2)],
  });
  step(f, 'c', 'raise');
  step(f, 'b', 'raise');
  step(f, 'c', 'call');
  assert.deepEqual(hand(f).players.map(player => player.contributed), [5, 25, 25]);
  step(f, 'b', 'draw', { holds: [...HOLD_ALL] } as Json);
  step(f, 'c', 'draw', { holds: [...HOLD_ALL] } as Json);
  step(f, 'c', 'check');
  step(f, 'b', 'check');
  assert.equal(hand(f).phase, 'results');
  assert.deepEqual(hand(f).results!.map(row => row.net), [-5, 3, 2]);
  assert.deepEqual(['a', 'b', 'c'].map(id => bankroll(f, id)), [0, 1003, 1002]);
});

test('privacy hides hole cards until showdown results', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  const aCards = hand(f).players.find(player => player.id === 'a')!.cards;
  const bCards = hand(f).players.find(player => player.id === 'b')!.cards;
  const forB = tableView(f, 'b');
  assert.deepEqual(forB.you.hand!.cards, bCards);
  const seatA = forB.table!.seats.find(entry => entry.id === 'a')!;
  assert.equal(seatA.cards, null);
  assert.equal(seatA.cardCount, 5);
  assert.equal(forB.results, null);
  assert.ok(!JSON.stringify(forB.table).includes(JSON.stringify(aCards)));
  playOutHand(f, 'a', 'b');
  const after = tableView(f, 'b');
  assert.equal(after.results!.length, 2);
  assert.deepEqual(after.table!.seats.find(entry => entry.id === 'a')!.cards, aCards);
  assert.deepEqual(after.table!.seats.find(entry => entry.id === 'b')!.cards, bCards);
});

test('a third player waits for the next hand and the button rotates', () => {
  const f = makeFixture(['a', 'b', 'c']);
  seat(f, 'a');
  seat(f, 'b');
  seat(f, 'c');
  assert.deepEqual(hand(f).players.map(player => player.id), ['a', 'b']);
  assert.equal(pokerEngine.pending(table(f), 'c'), false);
  assert.equal(pokerEngine.pending(table(f), 'a'), true);
  playOutHand(f, 'a', 'b');
  f.clock.now += POKER_RESULTS_MS;
  step(f, null, 'tick');
  assert.deepEqual(hand(f).players.map(player => player.id), ['a', 'b', 'c']);
  assert.equal(pokerEngine.pending(table(f), 'c'), true);
  assert.equal(table(f).button, 'b');
  assert.equal(tableView(f, 'c').table!.turn, 'c');
});

test('players without the ante spectate but keep their machines', () => {
  const f = makeFixture(['a', 'b', 'c']);
  startShared(f, ['a', 'b', 'c'], [1000, 1000, 3]);
  assert.deepEqual(hand(f).players.map(player => player.id), ['a', 'b']);
  assert.deepEqual(pokerEngine.occupants(table(f)), ['a', 'b', 'c']);
  assert.equal(pokerEngine.summary(table(f)).limit, POKER_LIMIT);
  assert.equal(pokerEngine.summary(table(f)).mode, 'shared');
  step(f, 'c', 'deal', { coins: 3 } as Json);
  assert.ok(table(f).video.c);
  assert.equal(bankroll(f, 'c'), 0);
  assert.equal(pokerEngine.pending(table(f), 'c'), true);
});

test('summary reports solo and shared modes with the pot', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  assert.deepEqual(pokerEngine.occupants(table(f)), ['a']);
  assert.equal(pokerEngine.summary(table(f)).mode, 'solo');
  assert.deepEqual(pokerEngine.summary(table(f)).info, { phase: 'idle', pot: 0 });
  seat(f, 'b');
  assert.equal(pokerEngine.summary(table(f)).mode, 'shared');
  assert.deepEqual(pokerEngine.summary(table(f)).info, { phase: 'bet1', pot: POKER_ANTE * 2 });
  const view = tableView(f, 'a');
  assert.deepEqual(view.limits, { ante: POKER_ANTE, bet: POKER_BET, maxRaises: POKER_MAX_RAISES, coins: 5 });
  assert.deepEqual(view.actions, []);
});

test('settle skips betting, auto-draws, pays once, and is idempotent', () => {
  const f = makeFixture(['a', 'b']);
  seat(f, 'a');
  seat(f, 'b');
  step(f, 'b', 'raise');
  assert.equal(hand(f).phase, 'bet1');
  const ctx = directCtx(f);
  pokerEngine.settle(table(f), ctx);
  assert.equal(hand(f).phase, 'results');
  assert.deepEqual(hand(f).players.map(player => player.contributed), [POKER_ANTE, POKER_ANTE]);
  const nets = hand(f).results!.map(row => row.net);
  assert.deepEqual([...nets].sort((x, y) => x - y), [-5, 5]);
  const before = [bankroll(f, 'a'), bankroll(f, 'b')];
  pokerEngine.settle(table(f), ctx);
  assert.deepEqual([bankroll(f, 'a'), bankroll(f, 'b')], before);
});

test('settle auto-resolves unfinished video hands at the match deadline', () => {
  const f = makeFixture(['a']);
  seat(f, 'a');
  step(f, 'a', 'deal', { coins: 5 } as Json);
  const video = table(f).video.a!;
  video.cards = [...TEN_PAIR];
  video.deck = [...ROYAL];
  f.clock.now = T0 + MATCH_MS;
  step(f, null, 'tick');
  assert.equal(f.state.phase, 'results');
  assert.equal(table(f).video.a, undefined);
  assert.equal(pokerEngine.pending(table(f), 'a'), false);
  assert.equal(bankroll(f, 'a'), 995 + 1250);
  assert.equal(f.state.players.a!.rounds, 1);
  assert.equal(f.state.players.a!.biggestWin, 1245);
  const settled = bankroll(f, 'a');
  pokerEngine.settle(table(f), directCtx(f));
  assert.equal(bankroll(f, 'a'), settled);
});

test('leaving with a video hand auto-resolves it as a discard draw', () => {
  const f = makeFixture(['a']);
  seat(f, 'a');
  step(f, 'a', 'deal', { coins: 2 } as Json);
  const video = table(f).video.a!;
  video.cards = [...TEN_PAIR];
  video.deck = [...ROYAL];
  step(f, 'a', 'sit', { at: 'floor' } as Json);
  assert.equal(table(f).video.a, undefined);
  assert.equal(pokerEngine.occupants(table(f)).length, 0);
  assert.equal(bankroll(f, 'a'), 998 + 500);
  assert.equal(f.state.players.a!.rounds, 1);
});

test('leaving folds the hand and advances the turn', () => {
  const f = makeFixture(['a', 'b', 'c']);
  startShared(f, ['a', 'b', 'c'], [1000, 1000, 1000]);
  assert.deepEqual(hand(f).players.map(player => player.id), ['a', 'b', 'c']);
  assert.equal(tableView(f, 'a').table!.turn, 'c');
  step(f, 'c', 'sit', { at: 'floor' } as Json);
  assert.equal(hand(f).players[2]!.folded, true);
  assert.equal(tableView(f, 'a').table!.turn, 'a');
  assert.deepEqual(pokerEngine.occupants(table(f)), ['a', 'b']);
  step(f, 'b', 'sit', { at: 'floor' } as Json);
  assert.equal(hand(f).phase, 'results');
  assert.deepEqual(hand(f).results!.map(row => row.net), [10, -5, -5]);
  assert.deepEqual(pokerEngine.occupants(table(f)), ['a']);
});

test('six-player draws reshuffle discards when the deck runs out', () => {
  const f = makeFixture(['a', 'b', 'c', 'd', 'e', 'f']);
  startShared(f, ['a', 'b', 'c', 'd', 'e', 'f'], [1000, 1000, 1000, 1000, 1000, 1000]);
  assert.equal(hand(f).players.length, 6);
  const order = ['c', 'd', 'e', 'f', 'a', 'b'];
  for (const id of order) step(f, id, 'check');
  assert.equal(hand(f).phase, 'draw');
  for (const id of order) step(f, id, 'draw', { holds: [false, false, false, false, false] } as Json);
  assert.equal(hand(f).phase, 'bet2');
  const all = hand(f).players.flatMap(player => player.cards);
  assert.equal(new Set(all).size, 30);
  for (const id of order) step(f, id, 'check');
  assert.equal(hand(f).phase, 'results');
});

test('the table caps at six seats', () => {
  const f = makeFixture(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) seat(f, id);
  assert.equal(pokerEngine.occupants(table(f)).length, POKER_SEATS);
  assert.throws(() => seat(f, 'g'), /Table is full\./);
  assert.equal(pokerEngine.occupants(table(f)).length, POKER_SEATS);
});
