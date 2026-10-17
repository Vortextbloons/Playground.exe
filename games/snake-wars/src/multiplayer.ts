import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { advanceClock, createInitial, setDirection, activatePower, type ArenaState, type Dir } from './sim';

const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

function asState(raw: Json): ArenaState {
  return structuredClone(raw) as ArenaState;
}

function parseDir(payload: Json): Dir | null {
  return typeof payload === 'string' && (DIRS as string[]).includes(payload) ? (payload as Dir) : null;
}

export type SnakeWarsState = ArenaState;

export default defineMultiplayer({
  setup({ playerIds, seed }) {
    return { phase: 'shared', state: createInitial([...playerIds], seed, Date.now()) };
  },
  action(raw, action, payload, { playerId, now }) {
    const state = asState(raw);
    advanceClock(state, now);
    if (state.finished) return { state, finished: true, phase: 'results' };
    const snake = state.snakes.find((s) => s.id === playerId);
    if (!snake || !snake.alive) throw new Error('You are out. Spectate the survivors.');
    if (action === 'turn') {
      const dir = parseDir(payload);
      if (!dir) throw new Error('Turn needs a direction.');
      if (!setDirection(state, playerId, dir)) throw new Error('No sharp U-turns.');
      return state.finished ? { state, finished: true, phase: 'results' } : { state };
    }
    if (action === 'heartbeat') {
      if (typeof payload === 'string' && payload) {
        const dir = parseDir(payload);
        if (dir) setDirection(state, playerId, dir);
      }
      return state.finished ? { state, finished: true, phase: 'results' } : { state };
    }
    if (action === 'powerup') {
      if (!activatePower(state, playerId)) throw new Error('No power-up held.');
      return { state };
    }
    throw new Error('Unknown game action.');
  },
  playersChanged(raw, { playerIds, now }) {
    const state = asState(raw);
    advanceClock(state, now);
    let removed = false;
    for (const snake of state.snakes) {
      if (snake.alive && !playerIds.includes(snake.id)) {
        snake.alive = false;
        removed = true;
      }
    }
    if (removed) {
      const alive = state.snakes.filter((s) => s.alive);
      if (!state.finished && state.snakes.length > 1 && alive.length <= 1) {
        state.finished = true;
        state.winner = alive[0]?.id ?? null;
        return { state, finished: true, phase: 'results' };
      }
    }
    return { state };
  },
  view(raw): Json {
    return raw;
  },
});
