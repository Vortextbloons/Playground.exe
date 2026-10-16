/**
 * Server-authoritative Connect Four adapter. The party worker owns the true
 * board and validates every drop here; clients only ever render the broadcast
 * state. All information is public, so the view is the state itself.
 */

import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { applyDrop, newGame, type GameState, type Player } from './rules/engine';

export type ConnectState = {
  game: GameState;
  /** Slot 0 is red and moves first; slot 1 is yellow. */
  players: [string, string];
};

export type ConnectActionPayloads = { drop: number };

const asJson = (state: ConnectState): Json => state as unknown as Json;

export default defineMultiplayer({
  setup({ playerIds, seed }) {
    if (new Set(playerIds).size < 2) throw new Error('Connect Four needs two players.');
    const offset = seed % 2;
    const players: [string, string] = [playerIds[offset]!, playerIds[1 - offset]!];
    return { state: asJson({ game: newGame(), players }), phase: 'playing' };
  },

  action(raw, action, payload, { playerId }) {
    const state = raw as ConnectState;
    if (action !== 'drop') throw new Error('Unknown game action.');
    if (typeof payload !== 'number' || !Number.isInteger(payload)) throw new Error('Choose a column.');
    const slot = state.players.indexOf(playerId);
    if (slot === -1) throw new Error('Only the two players can drop a disc.');
    if (state.game.phase !== 'playing') throw new Error('This round is over.');
    if (slot !== state.game.turn) throw new Error('Wait for your turn.');

    const game = applyDrop(state.game, payload);
    const finished = game.phase !== 'playing';
    return { state: asJson({ ...state, game }), finished, phase: finished ? 'finished' : 'playing' };
  },

  playersChanged(raw, { playerIds }) {
    const state = raw as ConnectState;
    if (state.game.phase !== 'playing') return { state: asJson(state) };
    const remaining = state.players.filter(id => playerIds.includes(id));
    if (remaining.length === state.players.length) return { state: asJson(state) };
    const survivor = remaining[0];
    const game: GameState = { ...state.game, phase: 'won', winner: survivor === undefined ? null : (state.players.indexOf(survivor) as Player) };
    return { state: asJson({ ...state, game }), finished: true, phase: 'finished' };
  },

  view(raw) {
    return raw as Json;
  },
});
