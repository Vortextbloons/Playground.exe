import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { BIG_WIN } from '../core/economy';
import { freshDeck } from '../core/cards';
import { asRecord, readInt, readList } from '../core/parse';
import { shuffled } from '../core/rng';
import type { ActionCtx, Engine, EngineSummary } from '../core/types';
import { evaluate5, videoCoinWin } from './poker-eval';

export const POKER_SEATS = 6;
export const POKER_LIMIT = 6;
export const POKER_ANTE = 5;
export const POKER_BET = 10;
export const POKER_MAX_RAISES = 3;
export const POKER_TURN_MS = 30_000;
export const POKER_RESULTS_MS = 6_000;

export const POKER_COINS = 1000;

export type PokerVideo = { cards: number[]; coins: number; deck: number[] };

export type PokerResult = { id: string; net: number; hand: number[] };

export type PokerPhase = 'idle' | 'bet1' | 'draw' | 'bet2' | 'results';

export type PokerPlayerState = {
  id: string;
  cards: number[];
  contributed: number;
  roundBet: number;
  folded: boolean;
  allin: boolean;
  acted: boolean;
  drawn: boolean;
  holds: boolean[] | null;
};

export type PokerHandState = {
  phase: Exclude<PokerPhase, 'idle'>;
  players: PokerPlayerState[];
  deck: number[];
  button: number;
  currentBet: number;
  raises: number;
  turn: number | null;
  deadline: number;
  results: PokerResult[] | null;
};

export type PokerState = {
  seats: string[];
  button: string | null;
  video: Record<string, PokerVideo>;
  hand: PokerHandState | null;
};

export type PokerSeatView = {
  id: string;
  status: 'active' | 'allin' | 'folded';
  contributed: number;
  roundBet: number;
  cardCount: number;
  cards: number[] | null;
};

export type PokerView = {
  phase: PokerPhase;
  mode: 'solo' | 'shared';
  you: {
    video: { cards: number[]; coins: number } | null;
    hand: {
      cards: number[];
      folded: boolean;
      allin: boolean;
      contributed: number;
      roundBet: number;
      drawn: boolean;
      turn: boolean;
    } | null;
  };
  table: {
    seats: PokerSeatView[];
    pot: number;
    currentBet: number;
    raises: number;
    turn: string | null;
    deadline: number;
    button: string | null;
  } | null;
  results: PokerResult[] | null;
  limits: { ante: number; bet: number; maxRaises: number; coins: number };
  actions: string[];
};

function takeCard(deck: number[]): number {
  const card = deck.pop();
  if (card === undefined) throw new Error('The deck is empty.');
  return card;
}

function noHolds(): boolean[] {
  return [false, false, false, false, false];
}

function readHolds(payload: Json): boolean[] {
  const list = readList(asRecord(payload), 'holds', 5);
  if (list.length !== 5) throw new Error('Invalid holds.');
  return list.map(value => {
    if (typeof value !== 'boolean') throw new Error('Invalid holds.');
    return value;
  });
}

function resolveVideo(state: PokerState, playerId: string, holds: readonly boolean[], ctx: ActionCtx): void {
  const video = state.video[playerId];
  if (!video) return;
  for (let index = 0; index < 5; index += 1) {
    if (holds[index] !== true) video.cards[index] = takeCard(video.deck);
  }
  const win = videoCoinWin(video.cards, video.coins);
  ctx.cash(playerId, win);
  const net = win - video.coins;
  ctx.result(playerId, 'poker', net);
  if (net >= BIG_WIN) ctx.announce('bigwin', playerId, net);
  delete state.video[playerId];
}

function needsAction(player: PokerPlayerState, currentBet: number): boolean {
  return !player.folded && !player.allin && (!player.acted || player.roundBet < currentBet);
}

function nextTurn(hand: PokerHandState, from: number): number | null {
  const count = hand.players.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (from + step) % count;
    if (needsAction(hand.players[index]!, hand.currentBet)) return index;
  }
  return null;
}

function commit(player: PokerPlayerState, amount: number, ctx: ActionCtx): number {
  const paid = Math.min(amount, ctx.bankroll(player.id));
  if (paid <= 0) return 0;
  ctx.cash(player.id, -paid);
  player.contributed += paid;
  player.roundBet += paid;
  if (ctx.bankroll(player.id) === 0) player.allin = true;
  return paid;
}

function returnUncalled(hand: PokerHandState, ctx: ActionCtx): void {
  let top = -1;
  let second = 0;
  let holder: PokerPlayerState | null = null;
  let ties = 0;
  for (const player of hand.players) {
    if (player.contributed > top) {
      second = top;
      top = player.contributed;
      holder = player;
      ties = 1;
    } else if (player.contributed === top) {
      ties += 1;
    } else if (player.contributed > second) {
      second = player.contributed;
    }
  }
  if (holder !== null && ties === 1 && top > second) {
    const refund = top - second;
    holder.contributed -= refund;
    ctx.cash(holder.id, refund);
  }
}

type PotLayer = { amount: number; eligible: PokerPlayerState[] };

function buildLayers(players: readonly PokerPlayerState[]): PotLayer[] {
  const levels = [...new Set(players.map(player => player.contributed))].sort((a, b) => a - b);
  const layers: PotLayer[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    const eligible: PokerPlayerState[] = [];
    for (const player of players) {
      amount += Math.max(0, Math.min(player.contributed, level) - previous);
      if (player.contributed >= level && !player.folded) eligible.push(player);
    }
    previous = level;
    if (amount > 0) layers.push({ amount, eligible });
  }
  const merged: PotLayer[] = [];
  for (const layer of layers) {
    const below = merged[merged.length - 1];
    if (layer.eligible.length === 0 && below !== undefined) below.amount += layer.amount;
    else merged.push(layer);
  }
  return merged;
}

function finishHand(hand: PokerHandState, payouts: Map<string, number>, ctx: ActionCtx): void {
  hand.results = hand.players.map(player => {
    const paid = payouts.get(player.id) ?? 0;
    if (paid > 0) ctx.cash(player.id, paid);
    const net = paid - player.contributed;
    ctx.result(player.id, 'poker', net);
    if (net >= BIG_WIN) ctx.announce('bigwin', player.id, net);
    return { id: player.id, net, hand: [...player.cards] };
  });
  hand.phase = 'results';
  hand.turn = null;
  hand.deadline = ctx.now + POKER_RESULTS_MS;
}

function resolveFold(hand: PokerHandState, winner: PokerPlayerState, ctx: ActionCtx): void {
  returnUncalled(hand, ctx);
  const pot = hand.players.reduce((sum, player) => sum + player.contributed, 0);
  finishHand(hand, new Map([[winner.id, pot]]), ctx);
}

function resolveShowdown(hand: PokerHandState, ctx: ActionCtx): void {
  returnUncalled(hand, ctx);
  const payouts = new Map<string, number>();
  for (const layer of buildLayers(hand.players)) {
    let best = -1;
    let winners: PokerPlayerState[] = [];
    for (const player of layer.eligible) {
      const score = evaluate5(player.cards);
      if (score > best) {
        best = score;
        winners = [player];
      } else if (score === best) {
        winners.push(player);
      }
    }
    const share = Math.floor(layer.amount / winners.length);
    let remainder = layer.amount - share * winners.length;
    for (const winner of winners) {
      let paid = share;
      if (remainder > 0) {
        paid += 1;
        remainder -= 1;
      }
      payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + paid);
    }
  }
  finishHand(hand, payouts, ctx);
}

function drawCard(hand: PokerHandState, ctx: ActionCtx): number {
  if (hand.deck.length === 0) {
    const held = new Set<number>();
    for (const player of hand.players) {
      for (const card of player.cards) held.add(card);
    }
    hand.deck = shuffled(freshDeck().filter(card => !held.has(card)), ctx.entropy);
  }
  return takeCard(hand.deck);
}

function dealDraws(hand: PokerHandState, ctx: ActionCtx): void {
  for (const player of hand.players) {
    if (player.folded || player.allin) continue;
    const holds = player.holds ?? [];
    for (let index = 0; index < 5; index += 1) {
      if (holds[index] === true) continue;
      player.cards[index] = drawCard(hand, ctx);
    }
  }
}

function beginBetting(hand: PokerHandState, ctx: ActionCtx): void {
  hand.currentBet = 0;
  hand.raises = 0;
  hand.turn = null;
  hand.deadline = ctx.now + POKER_TURN_MS;
  for (const player of hand.players) {
    player.acted = false;
    player.roundBet = 0;
  }
  const first = nextTurn(hand, hand.button);
  if (first === null) {
    endBetting(hand, ctx);
    return;
  }
  hand.turn = first;
}

function finishDraw(hand: PokerHandState, ctx: ActionCtx): void {
  dealDraws(hand, ctx);
  hand.phase = 'bet2';
  beginBetting(hand, ctx);
}

function endBetting(hand: PokerHandState, ctx: ActionCtx): void {
  if (hand.phase === 'bet1') {
    hand.phase = 'draw';
    hand.turn = null;
    hand.deadline = ctx.now + POKER_TURN_MS;
    for (const player of hand.players) {
      player.drawn = player.folded || player.allin;
      player.holds = player.drawn ? [true, true, true, true, true] : null;
    }
    if (hand.players.every(player => player.drawn)) finishDraw(hand, ctx);
    return;
  }
  resolveShowdown(hand, ctx);
}

function advance(hand: PokerHandState, from: number, ctx: ActionCtx): void {
  const live = hand.players.filter(player => !player.folded);
  if (live.length === 1) {
    resolveFold(hand, live[0]!, ctx);
    return;
  }
  const next = nextTurn(hand, from);
  if (next === null) {
    endBetting(hand, ctx);
    return;
  }
  hand.turn = next;
  hand.deadline = ctx.now + POKER_TURN_MS;
}

function eligibleIds(state: PokerState, ctx: ActionCtx): string[] {
  return state.seats.filter(id => !state.video[id] && ctx.bankroll(id) >= POKER_ANTE);
}

function startHand(state: PokerState, ctx: ActionCtx): void {
  const ready = eligibleIds(state, ctx);
  if (ready.length < 2) return;
  const readySet = new Set(ready);
  let buttonId = ready[0]!;
  if (state.button !== null) {
    const at = state.seats.indexOf(state.button);
    if (at >= 0) {
      for (let step = 1; step <= state.seats.length; step += 1) {
        const candidate = state.seats[(at + step) % state.seats.length]!;
        if (readySet.has(candidate)) {
          buttonId = candidate;
          break;
        }
      }
    }
  }
  const deck = shuffled(freshDeck(), ctx.entropy);
  const players: PokerPlayerState[] = ready.map(id => ({
    id,
    cards: Array.from({ length: 5 }, () => takeCard(deck)),
    contributed: 0,
    roundBet: 0,
    folded: false,
    allin: false,
    acted: false,
    drawn: false,
    holds: null,
  }));
  state.hand = {
    phase: 'bet1',
    players,
    deck,
    button: players.findIndex(player => player.id === buttonId),
    currentBet: 0,
    raises: 0,
    turn: null,
    deadline: ctx.now + POKER_TURN_MS,
    results: null,
  };
  state.button = buttonId;
  for (const player of players) {
    ctx.cash(player.id, -POKER_ANTE);
    player.contributed = POKER_ANTE;
    player.allin = ctx.bankroll(player.id) === 0;
  }
  beginBetting(state.hand, ctx);
}

function dealVideo(state: PokerState, playerId: string, payload: Json, ctx: ActionCtx): void {
  if (state.video[playerId]) throw new Error('Finish your current hand first.');
  const hand = state.hand;
  if (hand && hand.phase !== 'results' && hand.players.some(player => player.id === playerId)) {
    throw new Error('You are in a poker hand.');
  }
  const coins = readInt(asRecord(payload), 'coins', 1, POKER_COINS);
  if (ctx.bankroll(playerId) < coins) throw new Error('Not enough chips.');
  ctx.cash(playerId, -coins);
  const deck = shuffled(freshDeck(), ctx.entropy);
  state.video[playerId] = { cards: deck.splice(0, 5), coins, deck };
}

function drawVideo(state: PokerState, playerId: string, payload: Json, ctx: ActionCtx): void {
  resolveVideo(state, playerId, readHolds(payload), ctx);
}

function drawHand(state: PokerState, playerId: string, payload: Json, ctx: ActionCtx): void {
  const hand = state.hand;
  if (!hand || hand.phase !== 'draw') throw new Error('There is nothing to draw.');
  const player = hand.players.find(item => item.id === playerId);
  if (!player) throw new Error('You are not in this hand.');
  if (player.folded || player.allin) throw new Error('You cannot draw.');
  if (player.drawn) throw new Error('You have already drawn.');
  player.holds = readHolds(payload);
  player.drawn = true;
  if (hand.players.every(item => item.drawn)) finishDraw(hand, ctx);
}

function bet(state: PokerState, playerId: string, name: string, ctx: ActionCtx): void {
  const hand = state.hand;
  if (!hand || (hand.phase !== 'bet1' && hand.phase !== 'bet2')) throw new Error('No bet is open.');
  const index = hand.players.findIndex(player => player.id === playerId);
  if (index < 0) throw new Error('You are not in this hand.');
  if (hand.turn !== index) throw new Error('It is not your turn.');
  const player = hand.players[index]!;
  if (player.folded || player.allin) throw new Error('You cannot bet.');
  if (name === 'fold') {
    player.folded = true;
    player.acted = true;
    advance(hand, index, ctx);
    return;
  }
  if (name === 'check') {
    if (player.roundBet < hand.currentBet) throw new Error('There is a bet to call.');
    player.acted = true;
    advance(hand, index, ctx);
    return;
  }
  const needed = hand.currentBet - player.roundBet;
  if (name === 'call') {
    if (needed <= 0) throw new Error('Nothing to call.');
    commit(player, needed, ctx);
    player.acted = true;
    advance(hand, index, ctx);
    return;
  }
  if (hand.raises >= POKER_MAX_RAISES) throw new Error('Raise limit reached.');
  if (ctx.bankroll(playerId) <= needed) throw new Error('Call or fold.');
  commit(player, needed + POKER_BET, ctx);
  if (player.roundBet > hand.currentBet) {
    hand.currentBet = player.roundBet;
    hand.raises += 1;
  }
  player.acted = true;
  advance(hand, index, ctx);
}

function potOf(state: PokerState): number {
  const hand = state.hand;
  if (!hand) return 0;
  return hand.players.reduce((sum, player) => sum + player.contributed, 0);
}

function modeOf(state: PokerState): 'solo' | 'shared' {
  return state.seats.filter(id => !state.video[id]).length >= 2 ? 'shared' : 'solo';
}

function availableActions(state: PokerState, viewerId: string | null, hand: PokerHandState | null): string[] {
  if (viewerId === null || !state.seats.includes(viewerId)) return [];
  if (state.video[viewerId]) return ['draw'];
  if (hand === null || hand.phase === 'results') return ['deal'];
  const own = hand.players.find(player => player.id === viewerId);
  if (!own) return ['deal'];
  if (hand.phase === 'draw') {
    if (!own.folded && !own.allin && !own.drawn) return ['draw'];
    return [];
  }
  if (hand.turn === null || hand.players[hand.turn]!.id !== viewerId) return [];
  if (own.folded || own.allin) return [];
  const actions = [own.roundBet < hand.currentBet ? 'call' : 'check'];
  if (hand.raises < POKER_MAX_RAISES) actions.push('raise');
  actions.push('fold');
  return actions;
}

function buildView(state: PokerState, viewerId: string | null): PokerView {
  const hand = state.hand;
  const turnId = hand !== null && hand.turn !== null ? hand.players[hand.turn]!.id : null;
  const video = viewerId !== null ? state.video[viewerId] ?? null : null;
  const own = hand !== null && viewerId !== null ? hand.players.find(player => player.id === viewerId) ?? null : null;
  return {
    phase: hand === null ? 'idle' : hand.phase,
    mode: modeOf(state),
    you: {
      video: video === null ? null : { cards: [...video.cards], coins: video.coins },
      hand: own === null ? null : {
        cards: [...own.cards],
        folded: own.folded,
        allin: own.allin,
        contributed: own.contributed,
        roundBet: own.roundBet,
        drawn: own.drawn,
        turn: turnId === viewerId,
      },
    },
    table: hand === null ? null : {
      seats: hand.players.map(player => ({
        id: player.id,
        status: player.folded ? 'folded' : player.allin ? 'allin' : 'active',
        contributed: player.contributed,
        roundBet: player.roundBet,
        cardCount: player.cards.length,
        cards: hand.results === null ? null : [...player.cards],
      })),
      pot: potOf(state),
      currentBet: hand.currentBet,
      raises: hand.raises,
      turn: turnId,
      deadline: hand.deadline,
      button: state.button,
    },
    results: hand === null || hand.results === null ? null : hand.results.map(row => ({ id: row.id, net: row.net, hand: [...row.hand] })),
    limits: { ante: POKER_ANTE, bet: POKER_BET, maxRaises: POKER_MAX_RAISES, coins: POKER_COINS },
    actions: availableActions(state, viewerId, hand),
  };
}

function buildSummary(state: PokerState): EngineSummary {
  return {
    mode: modeOf(state),
    limit: POKER_LIMIT,
    info: { phase: state.hand === null ? 'idle' : state.hand.phase, pot: potOf(state) },
  };
}

export const pokerEngine: Engine<PokerState> = {
  id: 'poker',

  create() {
    return { seats: [], button: null, video: {}, hand: null };
  },

  join(state, playerId, ctx) {
    if (state.seats.includes(playerId)) return;
    if (state.seats.length >= POKER_SEATS) throw new Error('Table is full.');
    state.seats.push(playerId);
    if (state.hand === null) startHand(state, ctx);
  },

  leave(state, playerId, ctx) {
    const at = state.seats.indexOf(playerId);
    if (at < 0) return;
    if (state.video[playerId]) resolveVideo(state, playerId, noHolds(), ctx);
    const hand = state.hand;
    if (hand && hand.phase !== 'results') {
      const index = hand.players.findIndex(player => player.id === playerId);
      if (index >= 0) {
        const player = hand.players[index]!;
        player.folded = true;
        player.acted = true;
        const live = hand.players.filter(item => !item.folded);
        if (live.length === 1) {
          resolveFold(hand, live[0]!, ctx);
        } else if (hand.phase === 'bet1' || hand.phase === 'bet2') {
          if (hand.turn === index) {
            const next = nextTurn(hand, index);
            if (next === null) endBetting(hand, ctx);
            else {
              hand.turn = next;
              hand.deadline = ctx.now + POKER_TURN_MS;
            }
          }
        } else if (hand.players.every(item => item.drawn || item.folded)) {
          finishDraw(hand, ctx);
        }
      }
    }
    state.seats.splice(at, 1);
  },

  act(state, playerId, name, payload, ctx) {
    if (!state.seats.includes(playerId)) throw new Error('You are not at this table.');
    if (name === 'deal') {
      dealVideo(state, playerId, payload, ctx);
      return;
    }
    if (name === 'draw') {
      if (state.video[playerId]) {
        drawVideo(state, playerId, payload, ctx);
        return;
      }
      drawHand(state, playerId, payload, ctx);
      return;
    }
    if (name === 'check' || name === 'call' || name === 'raise' || name === 'fold') {
      bet(state, playerId, name, ctx);
      return;
    }
    throw new Error('Unknown action.');
  },

  tick(state, ctx) {
    const hand = state.hand;
    if (hand === null) {
      startHand(state, ctx);
      return;
    }
    if (hand.phase === 'results') {
      if (ctx.now >= hand.deadline) {
        state.hand = null;
        startHand(state, ctx);
      }
      return;
    }
    if (hand.phase === 'draw') {
      if (ctx.now >= hand.deadline) {
        for (const player of hand.players) {
          if (!player.drawn) {
            player.holds = noHolds();
            player.drawn = true;
          }
        }
        finishDraw(hand, ctx);
      }
      return;
    }
    if (hand.turn !== null && ctx.now >= hand.deadline) {
      const index = hand.turn;
      const player = hand.players[index]!;
      if (player.roundBet < hand.currentBet) player.folded = true;
      player.acted = true;
      advance(hand, index, ctx);
    }
  },

  settle(state, ctx) {
    for (const playerId of Object.keys(state.video)) resolveVideo(state, playerId, noHolds(), ctx);
    const hand = state.hand;
    if (hand === null || hand.phase === 'results') return;
    for (const player of hand.players) {
      if (player.folded || player.allin) continue;
      if (!player.drawn) {
        player.holds = noHolds();
        player.drawn = true;
      }
    }
    dealDraws(hand, ctx);
    resolveShowdown(hand, ctx);
  },

  pending(state, playerId) {
    if (state.video[playerId]) return true;
    const hand = state.hand;
    if (hand === null || hand.phase === 'results') return false;
    return hand.players.some(player => player.id === playerId);
  },

  occupants(state) {
    return [...state.seats];
  },

  view(state, viewerId) {
    return buildView(state, viewerId);
  },

  summary(state) {
    return buildSummary(state);
  },
};
