/**
 * Pure UNO rules engine. Every function is deterministic given its rng,
 * returns brand-new state, and throws on illegal actions. The Svelte UI and
 * the multiplayer server adapter both run through these functions — rules
 * live here and nowhere else.
 */

import { DECK_SIZE, cardFromId, isColor, type Card, type Color } from './cards';
import type { Rng } from './rng';

export type Phase = 'playing' | 'color' | 'wild-four' | 'results';

export type WildFourPending = {
  by: string;
  target: string;
  /** The active color when the Wild Draw Four was played — the challenge test. */
  colorBefore: Color;
};

export type UnoState = {
  players: string[];
  hands: Record<string, number[]>;
  drawPile: number[];
  discardPile: number[];
  activeColor: Color;
  turn: string;
  direction: 1 | -1;
  phase: Phase;
  wildFour: WildFourPending | null;
  /** A just-drawn card the current player may still play; null otherwise. */
  drawnCard: number | null;
  /** Draw-Two cards stacked on the current player, who must stack another or take them all. */
  stackedDraw: number;
  /** Players who said UNO while holding exactly one card. */
  calledUno: string[];
  /** The single player who can currently be caught for a missed UNO call. */
  missedUno: string | null;
  scores: Record<string, number>;
  round: number;
  winner: string | null;
  lastGains: Record<string, number> | null;
  matchWinner: string | null;
  matchTarget: number;
};

export type UnoAction =
  | { type: 'play-card'; card: number; color?: Color; callUno?: boolean }
  | { type: 'draw-card' }
  | { type: 'pass-turn' }
  | { type: 'call-uno' }
  | { type: 'catch-uno'; target: string }
  | { type: 'choose-color'; color: Color }
  | { type: 'accept-draw-four' }
  | { type: 'challenge-draw-four' }
  | { type: 'next-round' };

/** Action-name → payload shape sent over the wire (multiplayer and solo share it). */
export type UnoActionPayloads = {
  'play-card': { card: number; color?: Color; callUno?: boolean };
  'draw-card': null;
  'pass-turn': null;
  'call-uno': null;
  'catch-uno': { target: string };
  'choose-color': { color: Color };
  'accept-draw-four': null;
  'challenge-draw-four': null;
  'next-round': null;
};

export interface MatchOptions {
  /** Traditional points race to a target (500). 0 keeps score without a target. */
  matchTarget?: number;
}

export type Difficulty = 'easy' | 'normal';

const HAND_SIZE = 7;
export const DEFAULT_MATCH_TARGET = 500;

// --------------------------------------------------------------------- deck

function shuffleIds(ids: number[], rng: Rng): number[] {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = a;
  }
  return ids;
}

export function shuffledIds(rng: Rng): number[] {
  return shuffleIds(Array.from({ length: DECK_SIZE }, (_, id) => id), rng);
}

// -------------------------------------------------------------------- views

/** A filtered, player-safe view. `hands` carries only the viewer's hand — everyone's once scoring reveals them. */
export type UnoView = {
  you: string | null;
  players: string[];
  hands: Record<string, number[]>;
  counts: Record<string, number>;
  drawPile: number;
  discardTop: number | null;
  discardCount: number;
  /** Null while the first flipped Wild awaits a color choice. */
  activeColor: Color | null;
  turn: string;
  direction: 1 | -1;
  phase: Phase;
  wildFour: { by: string; target: string } | null;
  drawnCard: number | null;
  stackedDraw: number;
  calledUno: string[];
  missedUno: string | null;
  scores: Record<string, number>;
  round: number;
  winner: string | null;
  lastGains: Record<string, number> | null;
  matchWinner: string | null;
  matchTarget: number;
};

export function toView(state: UnoState, you: string | null): UnoView {
  const finished = state.phase === 'results';
  const hands: Record<string, number[]> = {};
  const counts: Record<string, number> = {};
  for (const id of state.players) {
    counts[id] = state.hands[id]?.length ?? 0;
    if (finished || id === you) hands[id] = [...(state.hands[id] ?? [])];
  }
  const top = state.discardPile[state.discardPile.length - 1];
  return {
    you,
    players: [...state.players],
    hands,
    counts,
    drawPile: state.drawPile.length,
    discardTop: top === undefined ? null : top,
    discardCount: state.discardPile.length,
    activeColor: state.phase === 'color' ? null : state.activeColor,
    turn: state.turn,
    direction: state.direction,
    phase: state.phase,
    wildFour: state.wildFour ? { by: state.wildFour.by, target: state.wildFour.target } : null,
    drawnCard: you === state.turn ? state.drawnCard : null,
    stackedDraw: state.stackedDraw,
    calledUno: [...state.calledUno],
    missedUno: state.missedUno,
    scores: { ...state.scores },
    round: state.round,
    winner: state.winner,
    lastGains: state.lastGains ? { ...state.lastGains } : null,
    matchWinner: state.matchWinner,
    matchTarget: state.matchTarget,
  };
}

// --------------------------------------------------------------- card rules

export function topCard(state: UnoState): Card | null {
  const id = state.discardPile[state.discardPile.length - 1];
  return id === undefined ? null : cardFromId(id);
}

export function handOf(state: UnoState, playerId: string): number[] {
  return state.hands[playerId] ?? [];
}

export function canPlayCard(state: UnoState, cardId: number): boolean {
  return cardMatchesView(cardFromId(cardId), state.activeColor, topCard(state), state.stackedDraw);
}

/** View-safe twin of canPlayCard for clients that only ever see their filtered view. */
export function cardMatchesView(card: Card, activeColor: Color | null, top: Card | null, stackedDraw = 0): boolean {
  if (stackedDraw > 0) return card.kind === 'draw-two' && card.color === activeColor;
  if (card.kind === 'wild' || card.kind === 'wild-four') return true;
  if (!activeColor || !top) return false;
  if (card.color === activeColor) return true;
  if (card.kind !== 'number') return top.kind === card.kind;
  return top.kind === 'number' && top.value === card.value;
}

export function playableCards(state: UnoState, playerId: string): number[] {
  return handOf(state, playerId).filter(id => canPlayCard(state, id));
}

export function handPoints(ids: readonly number[]): number {
  return ids.reduce((sum, id) => sum + cardFromId(id).value, 0);
}

// -------------------------------------------------------------------- moves

function indexOfPlayer(state: UnoState, playerId: string): number {
  const index = state.players.indexOf(playerId);
  if (index === -1) throw new Error(`Unknown player: ${playerId}`);
  return index;
}

function seatAt(state: UnoState, from: string, offset: number): string {
  const index = indexOfPlayer(state, from);
  const length = state.players.length;
  const seat = (index + offset) % length;
  return state.players[(seat + length) % length]!;
}

function advanceTurn(state: UnoState, steps: number): void {
  state.turn = seatAt(state, state.turn, state.direction * steps);
}

function peekNext(state: UnoState): string {
  return seatAt(state, state.turn, state.direction);
}

function reshuffle(state: UnoState, rng: Rng): void {
  if (state.discardPile.length <= 1) return;
  const top = state.discardPile.pop()!;
  state.drawPile = shuffleIds(state.discardPile, rng);
  state.discardPile = [top];
}

function draw(state: UnoState, playerId: string, count: number, rng: Rng): number[] {
  const drawn: number[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) reshuffle(state, rng);
    const id = state.drawPile.pop();
    if (id === undefined) break;
    drawn.push(id);
  }
  if (drawn.length) {
    const hand = state.hands[playerId] ?? (state.hands[playerId] = []);
    hand.push(...drawn);
    state.calledUno = state.calledUno.filter(id => id !== playerId);
    if (state.missedUno === playerId && hand.length > 1) state.missedUno = null;
  }
  return drawn;
}

/** Any action by someone other than the risky player closes the catch window. */
function closeCatchWindow(state: UnoState, actorId: string): void {
  if (state.missedUno && state.missedUno !== actorId) state.missedUno = null;
}

function wildFourWasLegal(state: UnoState, pending: WildFourPending): boolean {
  const hand = state.hands[pending.by] ?? [];
  return !hand.some(id => cardFromId(id).color === pending.colorBefore);
}

function finishRound(state: UnoState, winnerId: string): UnoState {
  const gains: Record<string, number> = {};
  let pot = 0;
  for (const id of state.players) {
    if (id === winnerId) continue;
    const points = handPoints(state.hands[id] ?? []);
    gains[id] = points;
    pot += points;
  }
  state.scores[winnerId] = (state.scores[winnerId] ?? 0) + pot;
  state.winner = winnerId;
  state.lastGains = gains;
  state.phase = 'results';
  state.missedUno = null;
  state.drawnCard = null;
  state.stackedDraw = 0;
  state.wildFour = null;
  if (state.matchTarget > 0 && (state.scores[winnerId] ?? 0) >= state.matchTarget) state.matchWinner = winnerId;
  return state;
}

// -------------------------------------------------------------------- setup

/** Deals one round. Exported so tests can pin the starting player and first flip. */
export function dealRound(players: readonly string[], scores: Record<string, number>, round: number, matchTarget: number, startId: string | null, rng: Rng): UnoState {
  const drawPile = shuffledIds(rng);
  const hands: Record<string, number[]> = {};
  for (const id of players) hands[id] = [];
  for (let card = 0; card < HAND_SIZE; card++) {
    for (const id of players) {
      const id2 = drawPile.pop();
      if (id2 === undefined) throw new Error('Deck too small');
      hands[id]!.push(id2);
    }
  }
  // Flip the first discard; a Wild Draw Four goes back into the pile.
  let first = drawPile.pop()!;
  while (cardFromId(first).kind === 'wild-four') {
    drawPile.splice(Math.floor(rng() * (drawPile.length + 1)), 0, first);
    const next = drawPile.pop();
    if (next === undefined) break;
    first = next;
  }
  const firstCard = cardFromId(first);
  const state: UnoState = {
    players: [...players],
    hands,
    drawPile,
    discardPile: [first],
    activeColor: firstCard.color === 'wild' ? 'red' : firstCard.color,
    turn: startId ?? players[Math.floor(rng() * players.length)]!,
    direction: 1,
    phase: 'playing',
    wildFour: null,
    drawnCard: null,
    stackedDraw: 0,
    calledUno: [],
    missedUno: null,
    scores: { ...scores },
    round,
    winner: null,
    lastGains: null,
    matchWinner: null,
    matchTarget,
  };
  // Special cards showing as the initial discard apply their effect to the first player.
  switch (firstCard.kind) {
    case 'wild': state.phase = 'color'; break;
    case 'skip': advanceTurn(state, 1); break;
    case 'reverse':
      state.direction = -1;
      if (state.players.length === 2) advanceTurn(state, 1);
      break;
    case 'draw-two': draw(state, state.turn, 2, rng); advanceTurn(state, 1); break;
    default: break;
  }
  return state;
}

export function newMatch(players: readonly string[], options: MatchOptions = {}, rng: Rng): UnoState {
  if (players.length < 2) throw new Error('UNO needs at least two players.');
  if (new Set(players).size !== players.length) throw new Error('Players must be unique.');
  return dealRound(players, {}, 0, options.matchTarget ?? 0, null, rng);
}

/** Deal the next round; the player after the last winner starts. Scores carry over. */
export function nextRound(state: UnoState, rng: Rng): UnoState {
  if (state.phase !== 'results') throw new Error('Finish the round first.');
  if (state.matchWinner) throw new Error('The match is over.');
  if (state.players.length < 2) throw new Error('UNO needs at least two players.');
  const winnerIndex = state.players.indexOf(state.winner!);
  const startId = state.players[(winnerIndex + 1) % state.players.length]!;
  return dealRound(state.players, state.scores, state.round + 1, state.matchTarget, startId, rng);
}

// ------------------------------------------------------------------- actions

export function applyAction(raw: UnoState, playerId: string, action: UnoAction, rng: Rng): UnoState {
  const state = structuredClone(raw);

  if (action.type === 'call-uno') {
    if (state.missedUno !== playerId) throw new Error('No UNO call to make.');
    state.calledUno.push(playerId);
    state.missedUno = null;
    return state;
  }

  if (action.type === 'catch-uno') {
    if (!state.players.includes(playerId)) throw new Error('Only players can catch.');
    if (state.missedUno === null) throw new Error('Nobody missed their UNO call.');
    if (action.target !== state.missedUno) throw new Error('That player did not miss a call.');
    if (action.target === playerId) throw new Error('You cannot catch yourself.');
    draw(state, action.target, 2, rng);
    state.missedUno = null;
    return state;
  }

  if (!state.players.includes(playerId)) throw new Error('Spectators cannot act.');

  if (state.phase === 'results') {
    if (action.type !== 'next-round') throw new Error('The round is over.');
    return nextRound(state, rng);
  }

  if (action.type === 'choose-color') {
    if (state.phase !== 'color') throw new Error('There is no color to choose.');
    if (playerId !== state.turn) throw new Error('Not your turn.');
    if (!isColor(action.color)) throw new Error('Choose a real color.');
    state.activeColor = action.color;
    state.phase = 'playing';
    return state;
  }

  if (state.phase === 'color') throw new Error('Choose a color first.');

  if (state.phase === 'wild-four') {
    const pending = state.wildFour!;
    if (action.type === 'accept-draw-four') {
      if (playerId !== pending.target) throw new Error('Only the challenged player can respond.');
      draw(state, pending.target, 4, rng);
      state.wildFour = null;
      state.phase = 'playing';
      state.turn = pending.by;
      advanceTurn(state, 2);
      return state;
    }
    if (action.type === 'challenge-draw-four') {
      if (playerId !== pending.target) throw new Error('Only the challenged player can respond.');
      state.wildFour = null;
      state.phase = 'playing';
      if (wildFourWasLegal(state, pending)) {
        draw(state, pending.target, 6, rng);
        state.turn = pending.by;
        advanceTurn(state, 2);
      } else {
        draw(state, pending.by, 4, rng);
        state.turn = pending.target;
      }
      return state;
    }
    throw new Error('Respond to the Wild Draw Four first.');
  }

  if (action.type === 'draw-card') {
    if (playerId !== state.turn) throw new Error('Not your turn.');
    if (state.drawnCard !== null) throw new Error('Play or pass the card you drew.');
    closeCatchWindow(state, playerId);
    if (state.stackedDraw > 0) {
      draw(state, playerId, state.stackedDraw, rng);
      state.stackedDraw = 0;
      advanceTurn(state, 1);
      return state;
    }
    const [card] = draw(state, playerId, 1, rng);
    if (card === undefined) advanceTurn(state, 1); // every card is in someone's hand
    else if (canPlayCard(state, card)) state.drawnCard = card;
    else advanceTurn(state, 1);
    return state;
  }

  if (action.type === 'pass-turn') {
    if (playerId !== state.turn) throw new Error('Not your turn.');
    if (state.drawnCard === null) throw new Error('Draw a card before passing.');
    closeCatchWindow(state, playerId);
    state.drawnCard = null;
    advanceTurn(state, 1);
    return state;
  }

  if (action.type === 'play-card') {
    if (playerId !== state.turn) throw new Error('Not your turn.');
    if (state.drawnCard !== null && action.card !== state.drawnCard) throw new Error('Play the card you drew.');
    const hand = state.hands[playerId] ?? [];
    const index = hand.indexOf(action.card);
    if (index === -1) throw new Error('You do not have that card.');
    const card = cardFromId(action.card);
    if (!canPlayCard(state, action.card)) throw new Error('That card does not match.');
    const wild = card.kind === 'wild' || card.kind === 'wild-four';
    if (wild && !isColor(action.color)) throw new Error('Wilds need a color.');
    closeCatchWindow(state, playerId);

    const colorBefore = state.activeColor;
    hand.splice(index, 1);
    state.discardPile.push(action.card);
    state.drawnCard = null;
    state.activeColor = wild ? action.color! : (card.color as Color);

    if (hand.length === 0) return finishRound(state, playerId);
    if (hand.length === 1) {
      if (action.callUno === true) state.calledUno.push(playerId);
      else state.missedUno = playerId;
    }

    switch (card.kind) {
      case 'skip': advanceTurn(state, 2); break;
      case 'reverse':
        if (state.players.length === 2) advanceTurn(state, 2);
        else {
          state.direction = state.direction === 1 ? -1 : 1;
          advanceTurn(state, 1);
        }
        break;
      case 'draw-two': {
        state.stackedDraw += 2;
        advanceTurn(state, 1);
        break;
      }
      case 'wild-four':
        state.phase = 'wild-four';
        state.wildFour = { by: playerId, target: peekNext(state), colorBefore };
        break;
      default: advanceTurn(state, 1); break;
    }
    return state;
  }

  throw new Error(`Unknown action: ${String((action as { type?: string }).type)}`);
}

// ------------------------------------------------------------ players leaving

/** Remove a permanently-gone player; their cards leave the game with them. */
export function removePlayerFromMatch(raw: UnoState, playerId: string, _rng: Rng): UnoState {
  if (!raw.players.includes(playerId)) return raw;
  const state = structuredClone(raw);
  const removedIndex = state.players.indexOf(playerId);
  state.players = state.players.filter(id => id !== playerId);
  delete state.hands[playerId];
  state.calledUno = state.calledUno.filter(id => id !== playerId);
  if (state.missedUno === playerId) state.missedUno = null;
  state.drawnCard = null;
  if (state.players.length < 2) {
    state.phase = 'results';
    state.wildFour = null;
    return state;
  }
  if (state.wildFour && (state.wildFour.by === playerId || state.wildFour.target === playerId)) {
    state.wildFour = null;
    if (state.phase === 'wild-four') state.phase = 'playing';
  }
  if (state.turn === playerId) state.turn = state.players[removedIndex % state.players.length]!;
  return state;
}
