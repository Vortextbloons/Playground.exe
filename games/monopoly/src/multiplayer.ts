/**
 * Server-authoritative Monopoly adapter. The party worker owns the true state
 * and calls into the shared rules engine for every action — clients only ever
 * see their filtered view().
 */

import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { TURN_MS } from './rules/board';
import { applyAction, newMatch, removePlayer, toView, type MonoAction, type MonoState } from './rules/engine';
import { mulberry32, type Rng } from './rules/rng';

export type MpState = {
  game: MonoState;
  seed: number;
};

const SEED_STEP = 0x6d2b79f5;

/** Fresh randomness per action while keeping the whole match reproducible from its state. */
function rngOf(state: MpState): Rng {
  state.seed = (state.seed + SEED_STEP) >>> 0;
  return mulberry32(state.seed);
}

function spaceOf(body: Record<string, unknown>): number {
  const value = body.space;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 40) throw new Error('Invalid space.');
  return value;
}

function parseAction(action: string, payload: Json): MonoAction {
  const body = (payload ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'roll': return { type: 'roll' };
    case 'jail-fine': return { type: 'jail-fine' };
    case 'jail-card': return { type: 'jail-card' };
    case 'jail-roll': return { type: 'jail-roll' };
    case 'buy': return { type: 'buy' };
    case 'decline': return { type: 'decline' };
    case 'bid': {
      const amount = body.amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount)) throw new Error('Invalid bid.');
      return { type: 'bid', amount };
    }
    case 'pass-bid': return { type: 'pass-bid' };
    case 'build': return { type: 'build', space: spaceOf(body) };
    case 'sell': return { type: 'sell', space: spaceOf(body) };
    case 'mortgage': return { type: 'mortgage', space: spaceOf(body) };
    case 'unmortgage': return { type: 'unmortgage', space: spaceOf(body) };
    case 'propose-trade': {
      const to = body.to;
      if (typeof to !== 'string') throw new Error('Invalid trade target.');
      const cash = body.cash;
      const wantCash = body.wantCash;
      if (typeof cash !== 'number' || !Number.isInteger(cash) || cash < 0) throw new Error('Invalid cash offer.');
      if (typeof wantCash !== 'number' || !Number.isInteger(wantCash) || wantCash < 0) throw new Error('Invalid cash request.');
      const list = (value: unknown): number[] => {
        if (!Array.isArray(value) || value.some(item => typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= 40)) throw new Error('Invalid trade properties.');
        return value as number[];
      };
      return { type: 'propose-trade', to, cash, properties: list(body.properties), wantCash, wantProperties: list(body.wantProperties) };
    }
    case 'accept-trade': return { type: 'accept-trade' };
    case 'reject-trade': return { type: 'reject-trade' };
    case 'end-turn': return { type: 'end-turn' };
    case 'pay-debt': return { type: 'pay-debt' };
    case 'declare-bankrupt': return { type: 'declare-bankrupt' };
    default: throw new Error(`Unknown action: ${String(action)}`);
  }
}

export default defineMultiplayer({
  setup({ playerIds, seed, now }) {
    const game = newMatch(playerIds, seed >>> 0);
    game.turnStartedAt = now;
    return { state: { game, seed: (seed + SEED_STEP) >>> 0 } as Json, phase: game.phase };
  },

  action(raw, action, payload, { playerId, now }) {
    const state = structuredClone(raw) as MpState;
    if (action === 'timeout') {
      if (now - state.game.turnStartedAt < TURN_MS) throw new Error('There is still time to act.');
      state.game = applyAction(state.game, playerId, { type: 'timeout' }, rngOf(state));
    } else {
      state.game = applyAction(state.game, playerId, parseAction(action, payload), rngOf(state));
    }
    state.game.turnStartedAt = now;
    return { state: state as Json, finished: state.game.phase === 'results', phase: state.game.phase };
  },

  view(raw, playerId) {
    return toView((raw as MpState).game, playerId) as Json;
  },

  playersChanged(raw, { playerIds, now }) {
    const state = structuredClone(raw) as MpState;
    for (const id of Object.keys(state.game.players)) {
      if (!playerIds.includes(id)) state.game = removePlayer(state.game, id);
    }
    state.game.turnStartedAt = now;
    return { state: state as Json, finished: state.game.phase === 'results', phase: state.game.phase };
  },
});