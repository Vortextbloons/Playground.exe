import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { applyCasino, createCasino, reconcileCasino, viewCasino } from '../games/all-in/src/core/casino.ts';
import { MIN_BET } from '../games/all-in/src/core/economy.ts';
import { LOCATIONS, TABLE_IDS, type CasinoState, type Location, type PlayerView, type TableId } from '../games/all-in/src/core/types.ts';
import { engines } from '../games/all-in/src/games/index.ts';
import type { BlackjackState } from '../games/all-in/src/games/blackjack.ts';
import { POKER_RESULTS_MS, POKER_TURN_MS, type PokerHandState, type PokerState } from '../games/all-in/src/games/poker.ts';
import type { PlinkoState } from '../games/all-in/src/games/plinko.ts';
import type { RouletteState } from '../games/all-in/src/games/roulette.ts';
import type { SlotsState } from '../games/all-in/src/games/slots.ts';

const T0 = 1_000_000;

type Clock = { now: number; entropy: () => number };

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[rng() % items.length]!;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK = range(1, 36).filter(value => !RED.includes(value));
const ODD = range(1, 36).filter(value => value % 2 === 1);
const EVEN = range(1, 36).filter(value => value % 2 === 0);
const LOW = range(1, 18);
const HIGH = range(19, 36);
const MIDDLE = range(13, 24);

function isJson(value: unknown): value is Json {
  if (value === null) return true;
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).every(key => isJson(record[key]));
  }
  return false;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (Array.isArray(left) || Array.isArray(right)) return false;
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return left === right;
}

function cardKey(cards: readonly number[]): string {
  return [...cards].sort((a, b) => a - b).join(',');
}

function fiveCardArrays(value: unknown): number[][] {
  if (Array.isArray(value)) {
    if (value.length === 5 && value.every(item => typeof item === 'number')) return [value as number[]];
    return value.flatMap(fiveCardArrays);
  }
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(fiveCardArrays);
  return [];
}

function pokerOf(state: CasinoState): PokerState {
  return state.tables.poker as PokerState;
}

function blackjackOf(state: CasinoState): BlackjackState {
  return state.tables.blackjack as BlackjackState;
}

function checkState(state: CasinoState, previous: CasinoState | null, label: string): void {
  assert.ok(isJson(state), `${label}: state is not JSON`);
  assert.ok(jsonEqual(JSON.parse(JSON.stringify(state)), state), `${label}: state does not round-trip`);
  const size = JSON.stringify(state).length;
  assert.ok(size < 32768, `${label}: state serializes to ${size} bytes`);

  for (const playerId of state.order) {
    const ledger = state.players[playerId]!;
    assert.ok(Number.isInteger(ledger.bankroll) && ledger.bankroll >= 0, `${label}: ${playerId} bankroll ${ledger.bankroll}`);
    assert.ok(Number.isInteger(ledger.peak) && ledger.peak >= ledger.bankroll, `${label}: ${playerId} peak ${ledger.peak}`);
    assert.ok(Number.isInteger(ledger.penalty) && ledger.penalty >= 0, `${label}: ${playerId} penalty ${ledger.penalty}`);
    assert.ok(Number.isInteger(ledger.bailouts) && ledger.bailouts >= 0, `${label}: ${playerId} bailouts`);
    assert.ok(Number.isInteger(ledger.bankruptcies) && ledger.bankruptcies >= 0, `${label}: ${playerId} bankruptcies`);
    assert.ok(Number.isInteger(ledger.rounds) && ledger.rounds >= 0, `${label}: ${playerId} rounds`);
    assert.ok(ledger.biggestWin >= 0 && ledger.biggestLoss <= 0, `${label}: ${playerId} extremes`);
    let byGameTotal = 0;
    for (const tableId of TABLE_IDS) {
      assert.ok(Number.isInteger(ledger.byGame[tableId]) && ledger.byGame[tableId] >= 0, `${label}: ${playerId} byGame`);
      byGameTotal += ledger.byGame[tableId];
    }
    assert.equal(byGameTotal, ledger.rounds, `${label}: ${playerId} rounds/byGame mismatch`);
    if (ledger.status === 'out') assert.ok(ledger.outReason !== null, `${label}: ${playerId} out without reason`);
    else assert.equal(ledger.outReason, null, `${label}: ${playerId} reason without out`);

    if (ledger.status === 'offered') {
      assert.ok(ledger.bankroll < MIN_BET, `${label}: ${playerId} offered with bankroll ${ledger.bankroll}`);
      for (const tableId of TABLE_IDS) {
        assert.equal(engines[tableId].pending(state.tables[tableId], playerId), false, `${label}: offered ${playerId} pending at ${tableId}`);
      }
    }
    if (previous !== null) {
      const before = previous.players[playerId];
      if (before !== undefined && before.status === 'out' && before.bankroll !== ledger.bankroll) {
        const committed = TABLE_IDS.some(tableId => engines[tableId].pending(previous.tables[tableId], playerId));
        assert.ok(committed, `${label}: out ${playerId} bankroll moved ${before.bankroll} -> ${ledger.bankroll} without a committed wager`);
      }
    }
  }

  assert.ok(state.feed.length <= 12, `${label}: feed overflow`);
  assert.equal(new Set(state.order).size, state.order.length, `${label}: duplicate players`);
  for (const item of state.feed) {
    assert.ok(Number.isInteger(item.id) && item.id < state.nextId, `${label}: feed id`);
    assert.ok(Number.isInteger(item.amount) && item.amount >= 0, `${label}: feed amount`);
    assert.ok(item.playerId === null || state.players[item.playerId] !== undefined, `${label}: feed player`);
  }

  const views: Array<{ id: string; view: PlayerView }> = [];
  for (const playerId of state.order) {
    const ledger = state.players[playerId]!;
    const view = viewCasino(engines, state, playerId);
    views.push({ id: playerId, view });
    assert.ok(isJson(view), `${label}: view of ${playerId} is not JSON`);
    assert.ok(jsonEqual(JSON.parse(JSON.stringify(view)), view), `${label}: view of ${playerId} does not round-trip`);
    assert.equal(view.you, playerId, `${label}: you`);
    assert.equal(view.now, state.now, `${label}: now`);
    assert.equal(view.deadline, state.deadline, `${label}: deadline`);
    assert.equal(view.phase, state.phase, `${label}: phase`);
    assert.equal(view.at, ledger.at, `${label}: at`);
    assert.deepEqual(view.vault, {
      bankroll: ledger.bankroll, penalty: ledger.penalty, personalDeadline: ledger.personalDeadline,
      status: ledger.status, outReason: ledger.outReason, bankruptcies: ledger.bankruptcies,
      bailouts: ledger.bailouts, peak: ledger.peak, biggestWin: ledger.biggestWin,
      biggestLoss: ledger.biggestLoss, rounds: ledger.rounds, byGame: ledger.byGame,
    }, `${label}: vault of ${playerId}`);
    assert.deepEqual(view.feed, state.feed, `${label}: feed`);
    assert.equal(view.players.length, state.order.length, `${label}: players length`);
    for (const row of view.players) {
      const other = state.players[row.id]!;
      assert.equal(row.bankroll, other.bankroll, `${label}: ${row.id} row bankroll`);
      assert.equal(row.penalty, other.penalty, `${label}: ${row.id} row penalty`);
      assert.equal(row.adjusted, Math.max(0, other.bankroll - other.penalty), `${label}: ${row.id} row adjusted`);
      assert.equal(row.status, other.status, `${label}: ${row.id} row status`);
      assert.equal(row.outReason, other.outReason, `${label}: ${row.id} row reason`);
      assert.equal(row.bankruptcies, other.bankruptcies, `${label}: ${row.id} row bankruptcies`);
      assert.equal(row.bailouts, other.bailouts, `${label}: ${row.id} row bailouts`);
      assert.equal(row.at, other.at, `${label}: ${row.id} row at`);
    }
    if (state.phase === 'results') {
      assert.ok(view.results !== null && view.results.length === state.order.length, `${label}: results length`);
      view.results.forEach((row, index) => assert.equal(row.placement, index + 1, `${label}: placement`));
      for (const row of view.results) {
        const other = state.players[row.id]!;
        assert.equal(row.peak, other.peak, `${label}: ${row.id} results peak`);
        assert.equal(row.biggestWin, other.biggestWin, `${label}: ${row.id} results biggestWin`);
        assert.equal(row.biggestLoss, other.biggestLoss, `${label}: ${row.id} results biggestLoss`);
        assert.equal(row.rounds, other.rounds, `${label}: ${row.id} results rounds`);
        assert.deepEqual(row.byGame, other.byGame, `${label}: ${row.id} results byGame`);
      }
    } else {
      assert.equal(view.results, null, `${label}: results before finish`);
    }
    if (ledger.at === 'floor') assert.equal(view.table, null, `${label}: floor table`);
    else assert.deepEqual(view.table, engines[ledger.at].view(state.tables[ledger.at], playerId), `${label}: table of ${playerId}`);
    for (const tableId of TABLE_IDS) {
      const summary = engines[tableId].summary(state.tables[tableId]);
      assert.equal(view.tables[tableId].seats, engines[tableId].occupants(state.tables[tableId]).length, `${label}: ${tableId} seats`);
      assert.equal(view.tables[tableId].limit, summary.limit, `${label}: ${tableId} limit`);
      assert.equal(view.tables[tableId].mode, summary.mode, `${label}: ${tableId} mode`);
      assert.deepEqual(view.tables[tableId].info, summary.info, `${label}: ${tableId} info`);
    }
  }
  const spectator = viewCasino(engines, state, null);
  assert.equal(spectator.you, null, `${label}: spectator you`);
  assert.equal(spectator.vault, null, `${label}: spectator vault`);
  assert.equal(spectator.table, null, `${label}: spectator table`);

  const poker = pokerOf(state);
  if (poker.hand !== null) {
    if (poker.hand.phase === 'results') {
      assert.ok(poker.hand.results !== null, `${label}: poker results missing`);
      assert.equal(poker.hand.results.reduce((sum, row) => sum + row.net, 0), 0, `${label}: poker showdown is not zero sum`);
    } else {
      assert.equal(poker.hand.results, null, `${label}: live poker hand already has results`);
    }
  }

  const secrets: Array<{ owner: string; key: string }> = [];
  if (poker.hand !== null && poker.hand.phase !== 'results') {
    for (const player of poker.hand.players) secrets.push({ owner: player.id, key: cardKey(player.cards) });
  }
  for (const [owner, video] of Object.entries(poker.video)) secrets.push({ owner, key: cardKey(video.cards) });
  for (const secret of secrets) {
    for (const { id, view } of views) {
      if (id === secret.owner) continue;
      for (const candidate of fiveCardArrays(view)) {
        assert.notEqual(cardKey(candidate), secret.key, `${label}: poker cards of ${secret.owner} leaked to ${id}`);
      }
    }
    for (const candidate of fiveCardArrays(spectator)) {
      assert.notEqual(cardKey(candidate), secret.key, `${label}: poker cards of ${secret.owner} leaked to spectators`);
    }
  }

  const blackjack = blackjackOf(state);
  if (blackjack.dealer.length >= 2 && blackjack.phase !== 'dealer' && blackjack.phase !== 'results') {
    const hole = blackjack.dealer[1]!;
    for (const { id, view } of views) {
      if (view.table === null) continue;
      const dealer = (view.table as { dealer?: { cards?: number[] } }).dealer;
      const cards = dealer?.cards;
      if (!cards) continue;
      assert.ok(!cards.includes(hole), `${label}: blackjack hole card ${hole} leaked to ${id}`);
    }
  }
}

function checkContracts(state: CasinoState, label: string): void {
  const raw: Record<TableId, string[]> = {
    blackjack: blackjackOf(state).occupants,
    roulette: (state.tables.roulette as RouletteState).occupants,
    slots: (state.tables.slots as SlotsState).occupants,
    plinko: (state.tables.plinko as PlinkoState).occupants,
    poker: pokerOf(state).seats,
  };
  for (const tableId of TABLE_IDS) {
    const listed = engines[tableId].occupants(state.tables[tableId]);
    assert.deepEqual(listed, [...raw[tableId]], `${label}: ${tableId} occupants contract`);
    assert.equal(new Set(listed).size, listed.length, `${label}: ${tableId} duplicate occupants`);
    for (const playerId of listed) {
      assert.equal(state.players[playerId]!.at, tableId, `${label}: ${playerId} seated at ${tableId} but located elsewhere`);
    }
    const summary = engines[tableId].summary(state.tables[tableId]);
    assert.ok(isJson(summary), `${label}: ${tableId} summary is not JSON`);
    assert.ok(jsonEqual(JSON.parse(JSON.stringify(summary)), summary), `${label}: ${tableId} summary does not round-trip`);
    assert.ok(summary.mode === 'solo' || summary.mode === 'shared', `${label}: ${tableId} summary mode`);
    assert.ok(Number.isInteger(summary.limit) && summary.limit > 0, `${label}: ${tableId} summary limit`);
  }
  for (const playerId of state.order) {
    const at = state.players[playerId]!.at;
    if (at !== 'floor') {
      assert.ok(engines[at].occupants(state.tables[at]).includes(playerId), `${label}: ${playerId} at ${at} but not seated`);
    }
  }
}

type Generated = { action: string; payload: Json };

const BOGUS: Record<TableId, readonly Generated[]> = {
  blackjack: [
    { action: 'bet', payload: { amount: 0 } },
    { action: 'bet', payload: { amount: 501 } },
    { action: 'bet', payload: { amount: 2.5 } },
    { action: 'bet', payload: { amount: '10' } },
    { action: 'bet', payload: {} },
    { action: 'bet', payload: null },
    { action: 'spin', payload: null },
    { action: 'wager', payload: { amount: 1 } },
  ],
  roulette: [
    { action: 'bet', payload: { kind: 'straight', numbers: [37], amount: 1 } },
    { action: 'bet', payload: { kind: 'straight', numbers: [], amount: 1 } },
    { action: 'bet', payload: { kind: 'split', numbers: [1, 3], amount: 1 } },
    { action: 'bet', payload: { kind: 'wild', numbers: [1], amount: 1 } },
    { action: 'bet', payload: { kind: 'straight', numbers: [1], amount: 0 } },
    { action: 'bet', payload: { kind: 'red', numbers: [1], amount: 1 } },
    { action: 'bet', payload: null },
    { action: 'drop', payload: { bet: 1 } },
  ],
  slots: [
    { action: 'spin', payload: { bet: 2 } },
    { action: 'spin', payload: { bet: 0 } },
    { action: 'spin', payload: { bet: 11 } },
    { action: 'spin', payload: { bet: 1.5 } },
    { action: 'spin', payload: {} },
    { action: 'spin', payload: null },
    { action: 'deal', payload: { coins: 1 } },
  ],
  plinko: [
    { action: 'drop', payload: { bet: 0, risk: 'low' } },
    { action: 'drop', payload: { bet: 101, risk: 'low' } },
    { action: 'drop', payload: { bet: 1, risk: 'extreme' } },
    { action: 'drop', payload: { bet: 1 } },
    { action: 'drop', payload: null },
    { action: 'spin', payload: { bet: 1 } },
  ],
  poker: [
    { action: 'deal', payload: { coins: 0 } },
    { action: 'deal', payload: { coins: 6 } },
    { action: 'deal', payload: {} },
    { action: 'draw', payload: { holds: [true] } },
    { action: 'draw', payload: { holds: [1, 0, 0, 0, 0] } },
    { action: 'draw', payload: {} },
    { action: 'wager', payload: null },
    { action: 'spin', payload: null },
  ],
};

function rouletteBet(rng: () => number, amount: number | null): Json {
  const options: Array<{ kind: string; numbers: number[] }> = [
    { kind: 'straight', numbers: [rng() % 37] },
    { kind: 'split', numbers: [16, 17] },
    { kind: 'street', numbers: [16, 17, 18] },
    { kind: 'corner', numbers: [14, 15, 17, 18] },
    { kind: 'sixline', numbers: [13, 14, 15, 16, 17, 18] },
    { kind: 'column', numbers: MIDDLE },
    { kind: 'dozen', numbers: MIDDLE },
    { kind: 'red', numbers: RED },
    { kind: 'black', numbers: BLACK },
    { kind: 'odd', numbers: ODD },
    { kind: 'even', numbers: EVEN },
    { kind: 'low', numbers: LOW },
    { kind: 'high', numbers: HIGH },
  ];
  const option = options[rng() % options.length]!;
  return { kind: option.kind, numbers: [...option.numbers], amount: amount ?? pick(rng, [1, 10, 25, 50, 100]) };
}

function validAction(rng: () => number, state: CasinoState, playerId: string, at: TableId): Generated {
  const allIn = rng() % 6 === 0;
  const bankroll = state.players[playerId]!.bankroll;
  if (at === 'blackjack') {
    if (rng() % 2 === 0) return { action: 'bet', payload: { amount: allIn ? Math.max(1, Math.min(500, bankroll)) : pick(rng, [1, 2, 5, 10, 25, 50, 100]) } };
    return { action: pick(rng, ['hit', 'stand', 'double', 'split']), payload: null };
  }
  if (at === 'roulette') {
    const roll = rng() % 4;
    if (roll === 0) return { action: 'spin', payload: null };
    if (roll === 1) return { action: 'clear', payload: null };
    return { action: 'bet', payload: rouletteBet(rng, allIn ? Math.max(1, Math.min(100, bankroll)) : null) };
  }
  if (at === 'slots') return { action: 'spin', payload: { bet: pick(rng, [1, 5, 10]) } };
  if (at === 'plinko') return { action: 'drop', payload: { bet: allIn ? Math.max(1, Math.min(100, bankroll)) : pick(rng, [1, 10, 25, 50, 100]), risk: pick(rng, ['low', 'medium', 'high']) } };
  const roll = rng() % 6;
  if (roll === 0) return { action: 'deal', payload: { coins: 1 + rng() % 5 } };
  if (roll === 1) return { action: 'draw', payload: { holds: Array.from({ length: 5 }, () => rng() % 2 === 0) } };
  return { action: pick(rng, ['check', 'call', 'raise', 'fold']), payload: null };
}

function biasedLocation(rng: () => number): Location {
  return pick(rng, ['poker', 'blackjack', 'blackjack', 'roulette', 'roulette', 'slots', 'plinko', 'floor'] as const);
}

function chooseAction(rng: () => number, state: CasinoState, playerId: string): Generated {
  const ledger = state.players[playerId]!;
  const roll = rng() % 1000;
  if (ledger.status === 'offered' && roll < 700) return { action: 'bailout', payload: { accept: rng() % 4 !== 0 } };
  if (roll < 30) return { action: 'bailout', payload: { accept: true } };
  if (roll < 90) return { action: 'sit', payload: { at: pick(rng, LOCATIONS) } };
  if (roll < 130) return { action: 'tick', payload: null };
  if (ledger.status !== 'active') return { action: 'sit', payload: { at: rng() % 2 === 0 ? 'floor' : biasedLocation(rng) } };
  if (ledger.at === 'floor') return { action: 'sit', payload: { at: biasedLocation(rng) } };
  if (roll >= 900) return pick(rng, BOGUS[ledger.at]);
  return validAction(rng, state, playerId, ledger.at);
}

type Coverage = {
  success: number; rejected: number; bailouts: number; videos: number; pokerHands: number;
  blackjackRounds: number; rouletteSpins: number; slotSpins: number; plinkoDrops: number; reconciles: number;
};

function newCoverage(): Coverage {
  return { success: 0, rejected: 0, bailouts: 0, videos: 0, pokerHands: 0, blackjackRounds: 0, rouletteSpins: 0, slotSpins: 0, plinkoDrops: 0, reconciles: 0 };
}

function applyGenerated(state: CasinoState, actor: string, generated: Generated, clock: Clock): CasinoState {
  return applyCasino(engines, state, actor, generated.action, generated.payload, clock).state;
}

function runSeededFuzz(seed: number, playerCount: number, presentCount: number, steps: number): Coverage {
  const rng = lcg(seed);
  const clock: Clock = { now: T0, entropy: () => rng() };
  const allIds = Array.from({ length: playerCount }, (_, index) => `p${index}`);
  let state = createCasino(engines, allIds.slice(0, presentCount), clock);
  checkState(state, null, `seed ${seed} start`);
  checkContracts(state, `seed ${seed} start`);
  const coverage = newCoverage();
  for (const [id, at] of [[allIds[0]!, 'poker'], [allIds[1]!, 'poker'], [allIds[2]!, 'blackjack'], [allIds[3]!, 'blackjack']] as Array<[string, Location]>) {
    if (state.players[id] === undefined) continue;
    clock.now += 10;
    state = applyCasino(engines, state, id, 'sit', { at } as Json, clock).state;
  }
  if (pokerOf(state).hand !== null) coverage.pokerHands += 1;

  for (let step = 0; step < steps; step += 1) {
    clock.now += rng() % 1_500;
    const before = structuredClone(state);
    const roll = rng() % 1000;
    let actionLabel = 'reconcile';
    let actor = '';
    try {
      if (roll < 25 && step > 20) {
        const present = allIds.filter(() => rng() % 2 === 0);
        if (present.length < 2) present.push(allIds[0]!, allIds[1]!);
        state = reconcileCasino(engines, state, present, clock).state;
        coverage.reconciles += 1;
      } else {
        const ghost = rng() % 100 < 3;
        actor = ghost ? 'ghost-player' : pick(rng, state.order);
        const generated = ghost
          ? { action: pick(rng, ['bet', 'spin', 'clear', 'drop', 'deal', 'draw', 'check', 'call', 'raise', 'fold', 'hit', 'stand', 'double', 'split', 'wager', 'bailout']), payload: null }
          : chooseAction(rng, state, actor);
        actionLabel = generated.action;
        state = applyGenerated(state, actor, generated, clock);
        coverage.success += 1;
        if (actionLabel === 'bailout') coverage.bailouts += 1;
        if (actionLabel === 'deal') coverage.videos += 1;
        if (actor !== 'ghost-player') {
          const at = before.players[actor]!.at;
          if (at === 'slots' && actionLabel === 'spin') coverage.slotSpins += 1;
          if (at === 'plinko' && actionLabel === 'drop') coverage.plinkoDrops += 1;
          if (at === 'roulette' && actionLabel === 'spin') coverage.rouletteSpins += 1;
        }
        const beforePoker = pokerOf(before).hand;
        const afterPoker = pokerOf(state).hand;
        if (afterPoker !== null && afterPoker.phase !== 'results' && (beforePoker === null || beforePoker.phase === 'results')) coverage.pokerHands += 1;
        const beforeBlackjack = blackjackOf(before).phase;
        const afterBlackjack = blackjackOf(state).phase;
        if (afterBlackjack === 'playing' && beforeBlackjack !== 'playing') coverage.blackjackRounds += 1;
      }
    } catch (error) {
      assert.ok(error instanceof Error, `seed ${seed} step ${step}: non-Error throw`);
      assert.deepStrictEqual(state, before, `seed ${seed} step ${step}: state mutated by rejected ${actionLabel} (${actor})`);
      coverage.rejected += 1;
    }
    checkState(state, before, `seed ${seed} step ${step} after ${actionLabel}`);
    checkContracts(state, `seed ${seed} step ${step}`);
  }
  return coverage;
}

test('fuzz: 4 players over 300 steps keeps every core invariant', () => {
  const coverage = runSeededFuzz(11, 4, 4, 300);
  assert.ok(coverage.success >= 150, `only ${coverage.success} successful steps`);
  assert.ok(coverage.rejected >= 20, `only ${coverage.rejected} rejected steps`);
  assert.ok(coverage.pokerHands >= 1, `only ${coverage.pokerHands} poker hands`);
  assert.ok(coverage.blackjackRounds >= 1, `only ${coverage.blackjackRounds} blackjack rounds`);
  assert.ok(coverage.slotSpins >= 3, `only ${coverage.slotSpins} slot spins`);
  assert.ok(coverage.reconciles >= 1, `only ${coverage.reconciles} reconciles`);
});

test('fuzz: 6 players with roster churn over 300 steps keeps every core invariant', () => {
  const coverage = runSeededFuzz(1337, 6, 5, 300);
  assert.ok(coverage.success >= 150, `only ${coverage.success} successful steps`);
  assert.ok(coverage.rejected >= 20, `only ${coverage.rejected} rejected steps`);
  assert.ok(coverage.videos >= 1, `only ${coverage.videos} video hands`);
  assert.ok(coverage.pokerHands >= 1, `only ${coverage.pokerHands} poker hands`);
  assert.ok(coverage.blackjackRounds >= 1, `only ${coverage.blackjackRounds} blackjack rounds`);
  assert.ok(coverage.rouletteSpins >= 1, `only ${coverage.rouletteSpins} roulette spins`);
  assert.ok(coverage.reconciles >= 2, `only ${coverage.reconciles} reconciles`);
});

test('fuzz: 8 players over 300 steps keeps every core invariant', () => {
  const coverage = runSeededFuzz(909090, 8, 8, 300);
  assert.ok(coverage.success >= 150, `only ${coverage.success} successful steps`);
  assert.ok(coverage.rejected >= 20, `only ${coverage.rejected} rejected steps`);
  assert.ok(coverage.pokerHands >= 2, `only ${coverage.pokerHands} poker hands`);
  assert.ok(coverage.blackjackRounds >= 1, `only ${coverage.blackjackRounds} blackjack rounds`);
  assert.ok(coverage.plinkoDrops >= 5, `only ${coverage.plinkoDrops} plinko drops`);
});

test('fuzz: crossing the shared deadline settles every engine exactly once', () => {
  const seed = 5150;
  const rng = lcg(seed);
  const clock: Clock = { now: T0, entropy: () => rng() };
  const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
  let state = createCasino(engines, ids, clock);
  checkState(state, null, 'deadline start');
  checkContracts(state, 'deadline start');
  for (let step = 0; step < 150 && clock.now < state.deadline - 10_000; step += 1) {
    clock.now += rng() % 2_000;
    const before = structuredClone(state);
    const actor = pick(rng, state.order);
    const generated = chooseAction(rng, state, actor);
    try {
      state = applyGenerated(state, actor, generated, clock);
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.deepStrictEqual(state, before, 'state mutated by rejected action');
    }
    checkState(state, before, `deadline step ${step}`);
  }

  assert.ok(clock.now < state.deadline, 'random play must not reach the deadline yet');
  const ready = state.order.filter(id => state.players[id]!.status === 'active' && pokerOf(state).video[id] === undefined);
  assert.ok(ready.length >= 4, `only ${ready.length} ready players`);
  for (const id of ready.slice(0, 4)) state.players[id]!.bankroll = Math.max(state.players[id]!.bankroll, 200);
  const seats: Array<[string, Location]> = [
    [ready[0]!, 'poker'], [ready[1]!, 'poker'], [ready[2]!, 'blackjack'], [ready[3]!, 'roulette'],
  ];
  for (const [id, at] of seats) {
    clock.now += 10;
    state = applyCasino(engines, state, id, 'sit', { at } as Json, clock).state;
  }
  clock.now += 10;
  try {
    state = applyCasino(engines, state, ready[2]!, 'bet', { amount: 50 } as Json, clock).state;
  } catch {}
  clock.now += 10;
  try {
    state = applyCasino(engines, state, ready[3]!, 'bet', { kind: 'red', numbers: RED, amount: 100 } as Json, clock).state;
  } catch {}
  assert.ok(pokerOf(state).hand !== null, 'expected a live poker hand at the deadline');
  const pendingBefore = state.order.filter(id => TABLE_IDS.some(tableId => engines[tableId].pending(state.tables[tableId], id)));
  assert.ok(pendingBefore.length >= 2, `expected live wagers before the deadline, got ${pendingBefore.length}`);

  clock.now = Math.max(clock.now, state.deadline);
  const result = applyCasino(engines, state, null, 'tick', null, clock);
  assert.equal(result.finished, true, 'deadline tick must finish');
  assert.equal(result.state.phase, 'results');
  for (const playerId of result.state.order) {
    for (const tableId of TABLE_IDS) {
      assert.equal(engines[tableId].pending(result.state.tables[tableId], playerId), false, `${playerId} pending at ${tableId} after deadline`);
    }
  }
  const poker = pokerOf(result.state);
  assert.ok(poker.hand === null || poker.hand.phase === 'results');
  const view = viewCasino(engines, result.state, result.state.order[0]!);
  assert.equal(view.phase, 'results');
  assert.ok(view.results !== null && view.results.length === result.state.order.length);
  assert.throws(() => applyCasino(engines, result.state, result.state.order[0]!, 'sit', { at: 'slots' } as Json, clock), /closed/);
  assert.throws(() => applyCasino(engines, result.state, result.state.order[0]!, 'bet', { amount: 1 } as Json, clock), /closed/);
  const again = applyCasino(engines, result.state, null, 'tick', null, clock);
  assert.equal(again.finished, true);
  assert.deepStrictEqual(again.state.players, result.state.players, 'results must be frozen');
  checkState(result.state, state, 'deadline results');
  checkContracts(result.state, 'deadline results');
});

type Fixture = { clock: Clock; state: CasinoState };

function makeFixture(ids: string[], seed: number): Fixture {
  const entropy = lcg(seed);
  const clock: Clock = { now: T0, entropy };
  return { clock, state: createCasino(engines, ids, clock) };
}

function stepFixture(fixture: Fixture, playerId: string | null, action: string, payload: Json = null): void {
  fixture.state = applyCasino(engines, fixture.state, playerId, action, payload, fixture.clock).state;
}

function fixtureHand(fixture: Fixture): PokerHandState {
  const hand = pokerOf(fixture.state).hand;
  assert.ok(hand !== null, 'expected a poker hand');
  return hand;
}

function seatAllAtPoker(fixture: Fixture, ids: readonly string[]): void {
  for (const id of ids) stepFixture(fixture, id, 'sit', { at: 'poker' } as Json);
}

test('poker showdown returns every chip when the top layer folds', () => {
  const fixture = makeFixture(['a', 'b', 'c', 'd'], 21);
  stepFixture(fixture, 'a', 'sit', { at: 'poker' } as Json);
  stepFixture(fixture, 'b', 'sit', { at: 'poker' } as Json);
  assert.equal(fixtureHand(fixture).phase, 'bet1');
  fixture.clock.now += POKER_TURN_MS + 1;
  stepFixture(fixture, null, 'tick');
  fixture.clock.now += POKER_TURN_MS + 1;
  stepFixture(fixture, null, 'tick');
  assert.equal(fixtureHand(fixture).phase, 'draw');
  stepFixture(fixture, 'c', 'sit', { at: 'poker' } as Json);
  stepFixture(fixture, 'd', 'sit', { at: 'poker' } as Json);
  fixture.clock.now += POKER_TURN_MS + 1;
  stepFixture(fixture, null, 'tick');
  fixture.clock.now += POKER_TURN_MS + 1;
  stepFixture(fixture, null, 'tick');
  fixture.clock.now += POKER_TURN_MS + 1;
  stepFixture(fixture, null, 'tick');
  assert.equal(fixtureHand(fixture).phase, 'results');
  fixture.clock.now += POKER_RESULTS_MS + 1;
  stepFixture(fixture, null, 'tick');
  assert.deepEqual(fixtureHand(fixture).players.map(player => player.id), ['a', 'b', 'c', 'd']);

  fixture.state.players.a!.bankroll = 1000;
  fixture.state.players.b!.bankroll = 1000;
  fixture.state.players.c!.bankroll = 10;
  fixture.state.players.d!.bankroll = 10;
  const totalBefore = ['a', 'b', 'c', 'd'].reduce((sum, id) => sum + fixture.state.players[id]!.bankroll, 0)
    + fixtureHand(fixture).players.reduce((sum, player) => sum + player.contributed, 0);

  while (fixtureHand(fixture).phase === 'bet1') {
    const current = fixtureHand(fixture);
    const index = current.turn;
    assert.ok(index !== null);
    const player = current.players[index]!;
    const needed = current.currentBet - player.roundBet;
    if (player.id === 'a' || player.id === 'b') {
      stepFixture(fixture, player.id, current.raises < 3 ? 'raise' : needed > 0 ? 'call' : 'check');
    } else {
      stepFixture(fixture, player.id, needed > 0 ? 'call' : 'check');
    }
  }
  assert.equal(fixtureHand(fixture).phase, 'draw');
  assert.deepEqual(fixtureHand(fixture).players.map(player => [player.id, player.contributed, player.allin]),
    [['a', 35, false], ['b', 35, false], ['c', 15, true], ['d', 15, true]]);

  while (fixtureHand(fixture).phase === 'draw') {
    const target = fixtureHand(fixture).players.find(player => !player.folded && !player.allin && !player.drawn);
    assert.ok(target !== undefined);
    stepFixture(fixture, target.id, 'draw', { holds: [true, true, true, true, true] } as Json);
  }
  assert.equal(fixtureHand(fixture).phase, 'bet2');
  while (fixtureHand(fixture).phase === 'bet2') {
    const current = fixtureHand(fixture);
    const index = current.turn;
    assert.ok(index !== null);
    stepFixture(fixture, current.players[index]!.id, 'fold');
  }

  const results = fixtureHand(fixture).results;
  assert.ok(results !== null);
  const netOf = (id: string): number => results.find(row => row.id === id)!.net;
  assert.equal(results.reduce((sum, row) => sum + row.net, 0), 0, 'folded layer chips must not vanish');
  assert.equal(netOf('a'), -35);
  assert.equal(netOf('b'), -35);
  assert.equal(netOf('c') + netOf('d'), 70, 'the folded top layer must stay in the pot');
  const totalAfter = ['a', 'b', 'c', 'd'].reduce((sum, id) => sum + fixture.state.players[id]!.bankroll, 0);
  assert.equal(totalAfter, totalBefore, 'poker chips must be conserved');
  checkState(fixture.state, null, 'poker conservation');
  checkContracts(fixture.state, 'poker conservation');
});

test('a rejoined out player cannot buy back in through sit', () => {
  const fixture = makeFixture(['a', 'b'], 33);
  seatAllAtPoker(fixture, ['a', 'b']);
  fixture.state = reconcileCasino(engines, fixture.state, ['b'], fixture.clock).state;
  assert.equal(fixture.state.players.a!.status, 'out');
  assert.equal(fixture.state.players.a!.outReason, 'left');
  const bankroll = fixture.state.players.a!.bankroll;
  fixture.state = reconcileCasino(engines, fixture.state, ['a', 'b'], fixture.clock).state;
  assert.equal(fixture.state.players.a!.status, 'out');
  assert.throws(() => stepFixture(fixture, 'a', 'sit', { at: 'poker' } as Json), /out of the match/);
  assert.equal(fixture.state.players.a!.bankroll, bankroll);
  checkState(fixture.state, null, 'out player sit');
  checkContracts(fixture.state, 'out player sit');
});

test('real engines only offer a bailout when nothing is pending and freeze a busted run', () => {
  const fixture = makeFixture(['a'], 44);
  stepFixture(fixture, 'a', 'sit', { at: 'slots' } as Json);
  let spins = 0;
  while (fixture.state.players.a!.status !== 'offered' && spins < 50) {
    fixture.state.players.a!.bankroll = 1;
    stepFixture(fixture, 'a', 'spin', { bet: 1 } as Json);
    spins += 1;
  }
  assert.equal(fixture.state.players.a!.status, 'offered');
  assert.ok(fixture.state.players.a!.bankroll < MIN_BET);
  for (const tableId of TABLE_IDS) {
    assert.equal(engines[tableId].pending(fixture.state.tables[tableId], 'a'), false);
  }
  checkState(fixture.state, null, 'offered');
  checkContracts(fixture.state, 'offered');

  stepFixture(fixture, 'a', 'bailout', { accept: true } as Json);
  assert.equal(fixture.state.players.a!.status, 'active');
  assert.equal(fixture.state.players.a!.bankroll, 100);
  assert.equal(fixture.state.players.a!.penalty, 200);
  assert.equal(fixture.state.players.a!.personalDeadline, fixture.state.deadline - 60_000);
  checkState(fixture.state, null, 'bailed out');

  fixture.state.players.a!.bankroll = 0;
  stepFixture(fixture, null, 'tick');
  assert.equal(fixture.state.players.a!.status, 'out');
  assert.equal(fixture.state.players.a!.outReason, 'bust');
  assert.equal(fixture.state.players.a!.bankruptcies, 2);
  const frozen = fixture.state.players.a!.bankroll;
  assert.throws(() => stepFixture(fixture, 'a', 'spin', { bet: 1 } as Json), /cannot bet/);
  fixture.clock.now += 30_000;
  stepFixture(fixture, null, 'tick');
  assert.equal(fixture.state.players.a!.bankroll, frozen);
  checkState(fixture.state, null, 'busted');
  checkContracts(fixture.state, 'busted');
});


