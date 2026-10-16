/** Optional adapter. Install Phaser in the game's workspace; the base kit never imports it. */
export function phaserLifecycle(getGame: () => { scene: { scenes: { sys: { settings: { key: string }; isActive(): boolean }; }[]; pause(key: string): unknown; resume(key: string): unknown; start(key: string): unknown; stop(key: string): unknown }; sound: { mute: boolean }; destroy(removeCanvas: boolean): void }, initialize: () => void | Promise<void>) {
  let paused: string[] = [];
  return {
    initialize, start() {},
    pause() { const game = getGame(); paused = game.scene.scenes.filter(scene => scene.sys.isActive()).map(scene => scene.sys.settings.key); paused.forEach(key => game.scene.pause(key)); },
    resume() { paused.forEach(key => getGame().scene.resume(key)); paused = []; },
    restart() { const game = getGame(); const first = game.scene.scenes[0]; game.scene.scenes.forEach(scene => game.scene.stop(scene.sys.settings.key)); if (first) game.scene.start(first.sys.settings.key); paused = []; },
    mute(value: boolean) { getGame().sound.mute = value; },
    destroy() { getGame().destroy(true); },
  };
}
