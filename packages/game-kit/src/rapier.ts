/** Optional adapter. Install @dimforge/rapier3d-compat in the game's workspace; the base kit never imports it. */
export function rapierLifecycle(getGame: () => { world: { timestep: number; step(): void; free(): void } }, initialize: () => void | Promise<void>, tick: (dt: number) => void) {
  let raf = 0; let last = 0;
  const loop = (time: number) => { raf = requestAnimationFrame(loop); const world = getGame().world; const dt = Math.min((time - last) / 1000, 0.1); last = time; world.timestep = dt; world.step(); tick(dt); };
  const run = () => { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
  return {
    initialize,
    start() { run(); },
    pause() { cancelAnimationFrame(raf); },
    resume() { run(); },
    restart() { cancelAnimationFrame(raf); getGame().world.free(); void Promise.resolve(initialize()).then(run); },
    destroy() { cancelAnimationFrame(raf); getGame().world.free(); },
  };
}