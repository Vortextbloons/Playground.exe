/**
 * Server-authoritative UNO adapter. The party worker owns the true state and
 * calls into the shared rules engine for every action — clients only ever see
 * their filtered view().
 */

import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { isColor } from './rules/cards';
import {
  DEFAULT_MATCH_TARGET,
  applyAction,
  newMatch,
  removePlayerFromMatch,
  toView,
  type UnoAction,
  type UnoState,
} from './rules/engine';
import { mulberry32 } from './rules/rng';

export type MpState = {
  game: UnoState;
  seed: number;
};

const SEED_STEP = 0x6d2b79f5;

/** Fresh randomness per action while keeping the whole match reproducible from its state. */
function rngOf(state: MpState): () => number {
  state.seed = (state.seed + SEED_STEP) >>> 0;
  return mulberry32(state.seed);
}

function parseAction(action: string, payload: Json): UnoAction {
  const body = (payload ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'play-card': {
      const { card, color, callUno } = body;
      if (typeof card !== 'number' || !Number.isInteger(card)) throw new Error('Invalid card.');
      if (color !== undefined && !isColor(color)) throw new Error('Invalid color.');
      return { type: 'play-card', card, color, callUno: callUno === true };
    }
    case 'draw-card': return { type: 'draw-card' };
    case 'pass-turn': return { type: 'pass-turn' };
    case 'call-uno': return { type: 'call-uno' };
    case 'catch-uno': {
      const { target } = body;
      if (typeof target !== 'string') throw new Error('Invalid target.');
      return { type: 'catch-uno', target };
    }
    case 'choose-color': {
      const { color } = body;
      if (!isColor(color)) throw new Error('Invalid color.');
      return { type: 'choose-color', color };
    }
    case 'accept-draw-four': return { type: 'accept-draw-four' };
    case 'challenge-draw-four': return { type: 'challenge-draw-four' };
    case 'next-round': return { type: 'next-round' };
    default: throw new Error(`Unknown action: ${String(action)}`);
  }
}

export default defineMultiplayer({
  setup({ playerIds, seed }) {
    const game = newMatch(playerIds, { matchTarget: DEFAULT_MATCH_TARGET }, mulberry32(seed >>> 0));
    return { state: { game, seed: (seed + SEED_STEP) >>> 0 } as Json, phase: 'playing' };
  },

  action(raw, action, payload, { playerId }) {
    const state = structuredClone(raw) as MpState;
    state.game = applyAction(state.game, playerId, parseAction(action, payload), rngOf(state));
    return { state: state as Json, finished: state.game.matchWinner !== null, phase: state.game.phase };
  },

  view(raw, playerId) {
    return toView((raw as MpState).game, playerId);
  },

  playersChanged(raw, { playerIds }) {
    const state = structuredClone(raw) as MpState;
    for (const id of [...state.game.players]) {
      if (!playerIds.includes(id)) state.game = removePlayerFromMatch(state.game, id, rngOf(state));
    }
    return { state: state as Json, finished: state.game.players.length < 2 || state.game.matchWinner !== null, phase: state.game.phase };
  },
});
