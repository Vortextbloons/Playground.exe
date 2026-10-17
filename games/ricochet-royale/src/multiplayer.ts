import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import { advance, createArena, type ArenaState, type Control } from './simulation';

export default defineMultiplayer({
  setup({ playerIds, now, seed }) {
    return { state: createArena([...playerIds], now, seed), phase: 'countdown' };
  },
  action(raw, action, payload, { playerId, now }) {
    if (action !== 'input' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid input.');
    const input = payload as Record<string, unknown>;
    if (![input.x, input.y, input.aim].every(value => typeof value === 'number' && Number.isFinite(value)) || typeof input.fire !== 'boolean') throw new Error('Invalid controls.');
    const state = structuredClone(raw) as ArenaState;
    advance(state, now);
    const tank = state.tanks.find(tank => tank.id === playerId);
    if (tank) {
      const control = input as Control;
      const length = Math.max(1, Math.hypot(control.x, control.y));
      tank.input = { x: control.x / length, y: control.y / length, aim: control.aim % (Math.PI * 2), fire: control.fire };
      tank.inputAt = state.time;
    }
    return { state, finished: state.phase === 'finished', phase: state.phase };
  },
  playersChanged(raw, { playerIds, now }) {
    const state = structuredClone(raw) as ArenaState;
    state.tanks = state.tanks.filter(tank => playerIds.includes(tank.id));
    advance(state, now);
    return { state, finished: state.phase === 'finished', phase: state.phase };
  },
  view(state) { return state; },
});
