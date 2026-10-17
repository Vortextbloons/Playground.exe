import { moveTank, type ArenaState, type Control, type Tank } from './simulation';

export function createMovementPrediction() {
  let tank: Tank | null = null;
  let state: ArenaState | null = null;
  let receivedAt = 0, lastFrame = 0, offsetX = 0, offsetY = 0;
  return {
    reset() { tank = null; state = null; offsetX = offsetY = 0; },
    receive(snapshot: ArenaState, playerId: string | null, now: number, continuous: boolean) {
      const next = snapshot.tanks.find(item => item.id === playerId);
      const preserve = continuous && tank?.alive && next?.alive && tank.id === next.id;
      offsetX = preserve ? tank!.x + offsetX - next.x : 0;
      offsetY = preserve ? tank!.y + offsetY - next.y : 0;
      if (Math.hypot(offsetX, offsetY) > 60) offsetX = offsetY = 0;
      tank = next ? { ...next, input: { ...next.input } } : null;
      state = snapshot; receivedAt = lastFrame = now;
    },
    sample(input: Control, now: number, active: boolean) {
      const elapsed = Math.max(0, Math.min(now, receivedAt + 300) - lastFrame);
      lastFrame = now;
      if (!tank || !state) return null;
      let remaining = active && tank.alive && state.phase === 'battle' ? Math.min(elapsed / 1000, .05) : 0;
      while (remaining > .000001) {
        const dt = Math.min(remaining, 1 / 120); remaining -= dt;
        moveTank(tank, input, state.tanks, state.map, dt);
      }
      const decay = Math.exp(-elapsed / 80);
      offsetX *= decay; offsetY *= decay;
      return { x: tank.x + offsetX, y: tank.y + offsetY };
    },
  };
}
