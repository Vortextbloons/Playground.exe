import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import { applyCasino, createCasino, reconcileCasino, viewCasino } from './core/casino';
import { cryptoEntropy } from './core/rng';
import type { CasinoState } from './core/types';
import { engines } from './games';

export default defineMultiplayer({
  setup({ playerIds, now }) {
    const state = createCasino(engines, playerIds, { now, entropy: cryptoEntropy() });
    return { state, phase: state.phase };
  },
  action(raw, action, payload, { playerId, now }) {
    const result = applyCasino(engines, raw as CasinoState, playerId, action, payload, { now, entropy: cryptoEntropy() });
    return { state: result.state, finished: result.finished, phase: result.state.phase };
  },
  playersChanged(raw, { playerIds, now }) {
    const result = reconcileCasino(engines, raw as CasinoState, playerIds, { now, entropy: cryptoEntropy() });
    return { state: result.state, finished: result.finished, phase: result.state.phase };
  },
  view(raw, playerId) {
    return viewCasino(engines, raw as CasinoState, playerId);
  },
});
