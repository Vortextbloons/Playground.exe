import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { cardRank, freshDeck } from '../core/cards';
import { BIG_WIN } from '../core/economy';
import { asRecord, readInt } from '../core/parse';
import { shuffled } from '../core/rng';
import type { ActionCtx, Engine, EngineSummary } from '../core/types';

export const BLACKJACK_SEATS = 5;
export const BLACKJACK_MIN = 1;
export const BLACKJACK_MAX = 10_000;
export const BLACKJACK_BETTING_MS = 10_000;
export const BLACKJACK_DECISION_MS = 20_000;
export const BLACKJACK_RESULTS_MS = 4_000;

export type BlackjackPhase = 'idle' | 'betting' | 'playing' | 'dealer' | 'results';
export type BlackjackHandStatus = 'playing' | 'stood' | 'busted' | 'blackjack' | 'doubled';
export type BlackjackOutcome = 'win' | 'lose' | 'push';

export type BlackjackHand = {
  cards: number[];
  bet: number;
  status: BlackjackHandStatus;
  outcome: BlackjackOutcome | null;
  payout: number | null;
};

export type BlackjackSeat = { hands: BlackjackHand[] };

export type BlackjackState = {
  phase: BlackjackPhase;
  occupants: string[];
  watching: string[];
  betting: Record<string, number>;
  order: string[];
  seats: Record<string, BlackjackSeat>;
  dealer: number[];
  deck: number[];
  turn: number;
  deadline: number;
};

export type BlackjackViewHand = {
  cards: number[];
  bet: number;
  status: BlackjackHandStatus;
  outcome: BlackjackOutcome | null;
  payout: number | null;
};

export type BlackjackViewSeat = {
  id: string | null;
  bet: number;
  hands: BlackjackViewHand[];
};

export type BlackjackView = {
  phase: BlackjackPhase;
  mode: 'solo' | 'shared';
  dealer: { cards: number[]; value: number };
  seats: BlackjackViewSeat[];
  turn: string | null;
  deadline: number;
  actions: string[];
  min: number;
  max: number;
};

export function handValue(cards: readonly number[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = cardRank(card);
    if (rank === 1) {
      aces += 1;
      total += 11;
    } else {
      total += Math.min(rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function bettable(state: BlackjackState): string[] {
  return state.occupants.filter(id => !state.watching.includes(id));
}

function modeOf(state: BlackjackState): 'solo' | 'shared' {
  return bettable(state).length >= 2 ? 'shared' : 'solo';
}

function syncWatching(state: BlackjackState, ctx: ActionCtx): void {
  state.watching = state.occupants.filter(id => ctx.bankroll(id) < BLACKJACK_MIN);
}

function activeHand(seat: BlackjackSeat): BlackjackHand | undefined {
  return seat.hands.find(hand => hand.status === 'playing');
}

function dealHand(cards: number[], bet: number): BlackjackHand {
  return { cards, bet, status: 'playing', outcome: null, payout: null };
}

function drawCard(state: BlackjackState, ctx: ActionCtx): number {
  if (state.deck.length === 0) state.deck = shuffled(freshDeck(), ctx.entropy);
  return state.deck.shift()!;
}

function drawHit(state: BlackjackState, hand: BlackjackHand, ctx: ActionCtx): void {
  hand.cards.push(drawCard(state, ctx));
  if (handValue(hand.cards) > 21) hand.status = 'busted';
}

function finishRound(state: BlackjackState, ctx: ActionCtx): void {
  state.phase = 'dealer';
  while (handValue(state.dealer) < 17) state.dealer.push(drawCard(state, ctx));
  const house = handValue(state.dealer);
  const houseNatural = state.dealer.length === 2 && house === 21;
  for (const id of state.order) {
    const seat = state.seats[id]!;
    let staked = 0;
    let returned = 0;
    for (const hand of seat.hands) {
      staked += hand.bet;
      const total = handValue(hand.cards);
      let outcome: BlackjackOutcome;
      let payout: number;
      if (hand.status === 'busted') {
        outcome = 'lose';
        payout = 0;
      } else if (hand.status === 'blackjack') {
        if (houseNatural) {
          outcome = 'push';
          payout = hand.bet;
        } else {
          outcome = 'win';
          payout = hand.bet + Math.floor(hand.bet * 1.5);
        }
      } else if (house > 21 || total > house) {
        outcome = 'win';
        payout = hand.bet * 2;
      } else if (total < house) {
        outcome = 'lose';
        payout = 0;
      } else {
        outcome = 'push';
        payout = hand.bet;
      }
      hand.outcome = outcome;
      hand.payout = payout;
      returned += payout;
    }
    if (returned > 0) ctx.cash(id, returned);
    const net = returned - staked;
    ctx.result(id, 'blackjack', net);
    if (net >= BIG_WIN) ctx.announce('bigwin', id, net);
  }
  state.phase = 'results';
  state.deadline = ctx.now + BLACKJACK_RESULTS_MS;
}

function advance(state: BlackjackState, ctx: ActionCtx): void {
  while (state.turn < state.order.length) {
    const seat = state.seats[state.order[state.turn]!];
    if (seat !== undefined && activeHand(seat) !== undefined) {
      state.deadline = ctx.now + BLACKJACK_DECISION_MS;
      return;
    }
    state.turn += 1;
  }
  finishRound(state, ctx);
}

function startRound(state: BlackjackState, ctx: ActionCtx): void {
  state.betting = {};
  state.order = [];
  state.seats = {};
  state.dealer = [];
  state.deck = [];
  state.turn = -1;
  if (modeOf(state) === 'shared') {
    state.phase = 'betting';
    state.deadline = ctx.now + BLACKJACK_BETTING_MS;
  } else {
    state.phase = 'idle';
    state.deadline = 0;
  }
}

function dealRound(state: BlackjackState, ctx: ActionCtx): void {
  const seated = state.occupants.filter(id => state.betting[id] !== undefined);
  const departed = Object.keys(state.betting).filter(id => !state.occupants.includes(id));
  state.order = [...seated, ...departed];
  state.seats = {};
  state.dealer = [];
  state.deck = shuffled(freshDeck(), ctx.entropy);
  for (const id of state.order) {
    state.seats[id] = { hands: [dealHand([drawCard(state, ctx)], state.betting[id]!)] };
  }
  state.dealer.push(drawCard(state, ctx));
  for (const id of state.order) state.seats[id]!.hands[0]!.cards.push(drawCard(state, ctx));
  state.dealer.push(drawCard(state, ctx));
  for (const id of state.order) {
    const hand = state.seats[id]!.hands[0]!;
    if (handValue(hand.cards) === 21) hand.status = 'blackjack';
    else if (departed.includes(id)) hand.status = 'stood';
  }
  state.betting = {};
  state.phase = 'playing';
  state.turn = 0;
  advance(state, ctx);
}

function standHand(hand: BlackjackHand): void {
  if (hand.status === 'playing') hand.status = 'stood';
}

function doubleHand(state: BlackjackState, playerId: string, hand: BlackjackHand, ctx: ActionCtx): void {
  if (hand.cards.length !== 2) throw new Error('You can only double on two cards.');
  if (hand.bet > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
  ctx.cash(playerId, -hand.bet);
  hand.bet *= 2;
  drawHit(state, hand, ctx);
  if (hand.status !== 'busted') hand.status = 'doubled';
  advance(state, ctx);
}

function splitHand(state: BlackjackState, playerId: string, seat: BlackjackSeat, hand: BlackjackHand, ctx: ActionCtx): void {
  if (hand.cards.length !== 2 || cardRank(hand.cards[0]!) !== cardRank(hand.cards[1]!)) throw new Error('You can only split a pair.');
  if (seat.hands.length > 1) throw new Error('You can only split once.');
  if (hand.bet > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
  ctx.cash(playerId, -hand.bet);
  const moved = hand.cards.pop()!;
  const status: BlackjackHandStatus = cardRank(moved) === 1 ? 'stood' : 'playing';
  hand.cards.push(drawCard(state, ctx));
  hand.status = status;
  seat.hands.push(dealHand([moved, drawCard(state, ctx)], hand.bet));
  seat.hands[1]!.status = status;
  advance(state, ctx);
}

function placeBet(state: BlackjackState, playerId: string, payload: Json, ctx: ActionCtx): void {
  if (state.phase !== 'idle' && state.phase !== 'betting') throw new Error('Wait for the next round.');
  if (state.betting[playerId] !== undefined) throw new Error('You already placed a bet.');
  const amount = readInt(asRecord(payload), 'amount', BLACKJACK_MIN, BLACKJACK_MAX);
  if (amount > ctx.bankroll(playerId)) throw new Error('Not enough chips.');
  ctx.cash(playerId, -amount);
  state.betting[playerId] = amount;
  if (state.phase === 'betting') return;
  if (modeOf(state) === 'shared') {
    state.phase = 'betting';
    state.deadline = ctx.now + BLACKJACK_BETTING_MS;
    return;
  }
  dealRound(state, ctx);
}

function joinTable(state: BlackjackState, playerId: string, ctx: ActionCtx): void {
  if (state.occupants.includes(playerId)) return;
  if (state.occupants.length >= BLACKJACK_SEATS) throw new Error('Table is full.');
  state.occupants.push(playerId);
  syncWatching(state, ctx);
  if (state.phase === 'idle' && modeOf(state) === 'shared') {
    state.phase = 'betting';
    state.deadline = ctx.now + BLACKJACK_BETTING_MS;
  }
}

function leaveTable(state: BlackjackState, playerId: string, ctx: ActionCtx): void {
  const index = state.occupants.indexOf(playerId);
  if (index < 0) return;
  state.occupants.splice(index, 1);
  syncWatching(state, ctx);
  if (state.phase === 'betting') {
    if (state.occupants.length === 0 && Object.keys(state.betting).length > 0) dealRound(state, ctx);
    return;
  }
  if (state.phase !== 'playing') return;
  const seat = state.seats[playerId];
  if (seat === undefined) return;
  for (const hand of seat.hands) standHand(hand);
  if (state.order[state.turn] === playerId) advance(state, ctx);
}

function actTable(state: BlackjackState, playerId: string, name: string, payload: Json, ctx: ActionCtx): void {
  syncWatching(state, ctx);
  if (!state.occupants.includes(playerId)) throw new Error('You are not seated at this table.');
  if (name === 'bet') {
    placeBet(state, playerId, payload, ctx);
    return;
  }
  if (state.phase !== 'playing') throw new Error('No hand is in play.');
  if (state.order[state.turn] !== playerId) throw new Error('Wait for your turn.');
  const seat = state.seats[playerId];
  const hand = seat === undefined ? undefined : activeHand(seat);
  if (seat === undefined || hand === undefined) throw new Error('No hand is in play.');
  if (name === 'hit') {
    drawHit(state, hand, ctx);
    advance(state, ctx);
    return;
  }
  if (name === 'stand') {
    hand.status = 'stood';
    advance(state, ctx);
    return;
  }
  if (name === 'double') {
    doubleHand(state, playerId, hand, ctx);
    return;
  }
  if (name === 'split') {
    splitHand(state, playerId, seat, hand, ctx);
    return;
  }
  throw new Error('Unknown action.');
}

function tickTable(state: BlackjackState, ctx: ActionCtx): void {
  syncWatching(state, ctx);
  if (state.phase === 'results') {
    if (state.deadline > 0 && ctx.now >= state.deadline) startRound(state, ctx);
    return;
  }
  if (state.phase === 'betting') {
    if (ctx.now < state.deadline) return;
    if (Object.keys(state.betting).length === 0) {
      state.phase = 'idle';
      state.deadline = 0;
      return;
    }
    dealRound(state, ctx);
    return;
  }
  if (state.phase !== 'playing' || ctx.now < state.deadline) return;
  const seat = state.seats[state.order[state.turn]!];
  if (seat !== undefined) for (const hand of seat.hands) standHand(hand);
  advance(state, ctx);
}

function settleTable(state: BlackjackState, ctx: ActionCtx): void {
  syncWatching(state, ctx);
  if (state.phase === 'idle') return;
  if (state.phase === 'results') {
    state.deadline = 0;
    return;
  }
  if (state.phase === 'betting') {
    if (Object.keys(state.betting).length === 0) {
      state.phase = 'idle';
      state.deadline = 0;
      return;
    }
    dealRound(state, ctx);
  }
  if (state.phase === 'playing') {
    for (const id of state.order) {
      const seat = state.seats[id];
      if (seat === undefined) continue;
      for (const hand of seat.hands) standHand(hand);
    }
    finishRound(state, ctx);
  }
  state.deadline = 0;
}

function isPending(state: BlackjackState, playerId: string): boolean {
  if (state.betting[playerId] !== undefined) return true;
  if (state.phase !== 'playing' && state.phase !== 'dealer') return false;
  return state.seats[playerId] !== undefined;
}

function viewerActions(state: BlackjackState, viewerId: string | null): string[] {
  if (viewerId === null || !state.occupants.includes(viewerId)) return [];
  if (state.phase === 'idle' || state.phase === 'betting') return state.betting[viewerId] === undefined ? ['bet'] : [];
  if (state.phase !== 'playing' || state.order[state.turn] !== viewerId) return [];
  const seat = state.seats[viewerId];
  if (seat === undefined) return [];
  const hand = activeHand(seat);
  if (hand === undefined) return [];
  const actions = ['hit', 'stand', 'double'];
  if (seat.hands.length === 1 && hand.cards.length === 2 && cardRank(hand.cards[0]!) === cardRank(hand.cards[1]!)) actions.push('split');
  return actions;
}

function viewTable(state: BlackjackState, viewerId: string | null): BlackjackView {
  const revealed = state.phase === 'playing' ? 1 : state.phase === 'dealer' || state.phase === 'results' ? state.dealer.length : 0;
  const dealer = state.dealer.slice(0, revealed);
  const seats: BlackjackViewSeat[] = [];
  for (let index = 0; index < BLACKJACK_SEATS; index += 1) {
    const id = state.occupants[index] ?? null;
    if (id === null) {
      seats.push({ id: null, bet: 0, hands: [] });
      continue;
    }
    const seat = state.seats[id];
    const hands = seat === undefined ? [] : seat.hands.map(hand => ({
      cards: [...hand.cards], bet: hand.bet, status: hand.status, outcome: hand.outcome, payout: hand.payout,
    }));
    seats.push({ id, bet: hands.reduce((sum, hand) => sum + hand.bet, state.betting[id] ?? 0), hands });
  }
  return {
    phase: state.phase,
    mode: modeOf(state),
    dealer: { cards: dealer, value: handValue(dealer) },
    seats,
    turn: state.phase === 'playing' ? state.order[state.turn] ?? null : null,
    deadline: state.deadline,
    actions: viewerActions(state, viewerId),
    min: BLACKJACK_MIN,
    max: BLACKJACK_MAX,
  };
}

function summarise(state: BlackjackState): EngineSummary {
  return {
    mode: modeOf(state),
    limit: BLACKJACK_SEATS,
    info: { phase: state.phase, turn: state.phase === 'playing' ? state.order[state.turn] ?? null : null },
  };
}

export const blackjackEngine: Engine<BlackjackState> = {
  id: 'blackjack',
  create: () => ({
    phase: 'idle', occupants: [], watching: [], betting: {}, order: [],
    seats: {}, dealer: [], deck: [], turn: -1, deadline: 0,
  }),
  join: joinTable,
  leave: leaveTable,
  act: actTable,
  tick: tickTable,
  settle: settleTable,
  pending: isPending,
  occupants: state => [...state.occupants],
  view: viewTable,
  summary: summarise,
};
