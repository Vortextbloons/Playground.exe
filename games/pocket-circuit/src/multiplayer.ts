import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';

export type CircuitState = {
  round: 'practice' | 'race' | 'finished'; scores: Record<string, number>;
  warm: Record<string, boolean>; turn: string; winner: string | null; target: number;
};
export default defineMultiplayer({
  setup({ playerIds, seed }) {
    return { phase: 'solo', state: {
      round: 'practice', scores: Object.fromEntries(playerIds.map(id => [id, 0])),
      warm: Object.fromEntries(playerIds.map(id => [id, false])),
      turn: playerIds[seed % playerIds.length]!, winner: null, target: 24,
    } };
  },
  action(raw, action, payload, { playerId, playerIds, mode }) {
    const state = structuredClone(raw) as CircuitState;
    if (state.round === 'practice' && action === 'warm') {
      state.warm[playerId] = true;
      if (playerIds.every(id => state.warm[id])) { state.round = 'race'; return { state, phase: 'shared' }; }
      return { state };
    }
    if (state.round !== 'race') throw new Error('Finish practice before the shared round.');
    if (mode.preset === 'turn-based' && state.turn !== playerId) throw new Error('Wait for your turn.');
    let delta = 1;
    if (mode.preset === 'live') {
      if (action !== 'move' || (payload !== -1 && payload !== 1)) throw new Error('Move one step left or right.');
      delta = payload;
    } else if (action !== 'advance') throw new Error('Unknown game action.');
    state.scores[playerId] = Math.max(0, (state.scores[playerId] ?? 0) + delta);
    const index = playerIds.indexOf(playerId);
    state.turn = playerIds[(index + 1) % playerIds.length]!;
    if (state.scores[playerId]! >= state.target) {
      state.round = 'finished'; state.winner = playerId;
      return { state, finished: true, phase: 'results' };
    }
    return { state };
  },
  playersChanged(raw, { playerIds }) {
    const state = structuredClone(raw) as CircuitState;
    if (!playerIds.includes(state.turn)) state.turn = playerIds[0]!;
    if (state.round === 'practice' && playerIds.every(id => state.warm[id])) {
      state.round = 'race'; return { state, phase: 'shared' };
    }
    return { state };
  },
  view(raw, playerId): Json {
    const state = raw as CircuitState;
    // Each player sees only their own score during individual practice.
    return state.round === 'practice' ? { ...state, scores: playerId ? { [playerId]: state.scores[playerId] ?? 0 } : {} } : state;
  },
});


