/** Optional adapter. Install three in the game's workspace; the base kit never imports it. */
export function threeLifecycle(getGame: () => { renderer: { setAnimationLoop(callback: ((time: number) => void) | null): void; dispose(): void; forceContextLoss(): void; domElement: HTMLCanvasElement } }, initialize: () => void | Promise<void>, tick: (time: number) => void) {
  const stop = () => { const renderer = getGame().renderer; renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  return {
    initialize,
    start() { getGame().renderer.setAnimationLoop(tick); },
    pause() { getGame().renderer.setAnimationLoop(null); },
    resume() { getGame().renderer.setAnimationLoop(tick); },
    restart() { stop(); void Promise.resolve(initialize()).then(() => getGame().renderer.setAnimationLoop(tick)); },
    destroy() { stop(); },
  };
}