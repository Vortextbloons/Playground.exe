import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { applyMove, newGame, type GameState, type Player } from './rules/engine';

export type TicState = {
  game: GameState;
  /** Slot 0 is X and moves first; slot 1 is O. */
  players: [string, string];
};

export type TicActionPayloads = { place: { index: number } };

const asJson = (state: TicState): Json => state as unknown as Json;

export default defineMultiplayer({
  setup({ playerIds, seed }) {
    if (new Set(playerIds).size < 2) throw new Error('Tic-Tac-Toe needs two players.');
    const offset = seed % 2;
    const players: [string, string] = [playerIds[offset]!, playerIds[1 - offset]!];
    return { state: asJson({ game: newGame(), players }), phase: 'playing' };
  },

  action(raw, action, payload, { playerId }) {
    const state = raw as TicState;
    if (action !== 'place') throw new Error('Unknown game action.');
    if (typeof payload !== 'object' || payload === null) throw new Error('Choose a cell index from 0 to 8.');
    const index = (payload as { index?: unknown }).index;
    if (typeof index !== 'number' || !Number.isInteger(index)) throw new Error('Choose a cell index from 0 to 8.');
    const slot = state.players.indexOf(playerId);
    if (slot === -1) throw new Error('Only the two players can place a mark.');
    if (state.game.phase !== 'playing') throw new Error('This game is already over.');
    if (slot !== state.game.turn) throw new Error('Wait for your turn.');

    const game = applyMove(state.game, index);
    const finished = game.phase !== 'playing';
    return { state: asJson({ ...state, game }), finished, phase: finished ? 'finished' : 'playing' };
  },

  playersChanged(raw, { playerIds }) {
    const state = raw as TicState;
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