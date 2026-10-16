/**
 * Bot brains for solo play. Bots only ever read the public state plus their
 * own hand — never other players' cards. All randomness flows through the
 * supplied rng so bot behavior is deterministic and testable.
 */

import { COLORS, cardFromId, type Color } from '../rules/cards';
import { canPlayCard, handOf, type Difficulty, type UnoState } from '../rules/engine';
import type { Rng } from '../rules/rng';

export type BotMove =
  | { type: 'play-card'; card: number; color?: Color; callUno: boolean }
  | { type: 'draw-card' }
  | { type: 'pass-turn' }
  | { type: 'call-uno' }
  | { type: 'catch-uno'; target: string }
  | { type: 'choose-color'; color: Color }
  | { type: 'accept-draw-four' }
  | { type: 'challenge-draw-four' };

const MISS_UNO = { easy: 0.35, normal: 0.12 } as const;
const CATCH = { easy: 0.5, normal: 0.85 } as const;
const CHALLENGE = { easy: 0.2, normal: 0.4 } as const;

export function botMove(state: UnoState, playerId: string, difficulty: Difficulty, rng: Rng): BotMove {
  if (state.phase === 'wild-four' && state.wildFour?.target === playerId) {
    return rng() < CHALLENGE[difficulty] ? { type: 'challenge-draw-four' } : { type: 'accept-draw-four' };
  }
  if (state.missedUno && state.missedUno !== playerId) {
    if (rng() < CATCH[difficulty]) return { type: 'catch-uno', target: state.missedUno };
  }
  if (state.phase === 'color' && state.turn === playerId) {
    return { type: 'choose-color', color: favoriteColor(handOf(state, playerId), rng) };
  }
  if (state.missedUno === playerId) return { type: 'call-uno' };

  const hand = handOf(state, playerId);
  const playable = hand.filter(id => canPlayCard(state, id));

  if (state.drawnCard !== null) {
    if (playable.includes(state.drawnCard)) return playCard(state, playerId, state.drawnCard, difficulty, rng);
    return { type: 'pass-turn' };
  }
  if (playable.length === 0) return { type: 'draw-card' };

  const card = difficulty === 'easy' ? playable[Math.floor(rng() * playable.length)]! : bestCard(state, playerId, playable, rng);
  return playCard(state, playerId, card, difficulty, rng);
}

function playCard(state: UnoState, playerId: string, cardId: number, difficulty: Difficulty, rng: Rng): BotMove {
  const card = cardFromId(cardId);
  const wild = card.kind === 'wild' || card.kind === 'wild-four';
  const callUno = handOf(state, playerId).length === 2 && rng() >= MISS_UNO[difficulty];
  return { type: 'play-card', card: cardId, color: wild ? favoriteColor(handOf(state, playerId), rng) : undefined, callUno };
}

/** The color the bot holds most of; ties break randomly. */
function favoriteColor(hand: readonly number[], rng: Rng): Color {
  const tally: Record<Color, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const id of hand) {
    const color = cardFromId(id).color;
    if (color !== 'wild') tally[color] += 1;
  }
  let best = COLORS[0]!;
  let bestCount = -1;
  for (const color of COLORS) {
    const count = tally[color]!;
    if (count > bestCount || (count === bestCount && rng() < 0.5)) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/** Normal bots prefer shedding high points, hoarding wilds, and punishing low hands. */
function bestCard(state: UnoState, playerId: string, playable: readonly number[], rng: Rng): number {
  const hand = handOf(state, playerId);
  const nextCount = state.hands[nextPlayerId(state, playerId)]?.length ?? 7;
  let best = playable[0]!;
  let bestScore = -Infinity;
  for (const id of playable) {
    const card = cardFromId(id);
    const score = card.value / 4
      + (card.color !== 'wild' ? colorShare(hand, card.color) : 0)
      + (card.kind === 'skip' || card.kind === 'draw-two' ? (nextCount <= 2 ? 7 : 2) : 0)
      + (card.kind === 'reverse' && state.players.length > 2 && nextCount <= 2 ? 5 : 0)
      + (card.kind === 'wild' ? (hand.length <= 2 ? 9 : -5) : 0)
      + (card.kind === 'wild-four' ? (hand.length <= 3 ? 9 : -7) : 0)
      + rng() * 0.5;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function colorShare(hand: readonly number[], color: Color): number {
  return hand.filter(id => cardFromId(id).color === color).length * 0.5;
}

function nextPlayerId(state: UnoState, playerId: string): string {
  const index = state.players.indexOf(playerId);
  return state.players[(index + state.direction + state.players.length) % state.players.length]!;
}
