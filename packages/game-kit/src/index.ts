import { createBridge } from './bridge';
import { createStorage } from './storage';
import { createAudio } from './assets';
import { createMultiplayer } from './multiplayer/client';
import type { Json } from './multiplayer/protocol';
export { createMultiplayer } from './multiplayer/client';
export * from './bridge'; export * from './storage'; export * from './input'; export * from './assets'; export * from './canvas';
export interface GameLifecycle {
  initialize(): void | Promise<void>; start(): void; pause(): void; resume(): void; restart(): void; destroy(): void; mute?(muted: boolean): void;
}
/** Hooks own engine-specific behavior. Destroy must release engine resources. */
export function createGame(id: string, hooks: GameLifecycle) {
  let state: 'new' | 'ready' | 'running' | 'paused' | 'destroyed' = 'new';
  let pending: Promise<void> | undefined;
  const audio = createAudio(); const storage = createStorage(id);
  const sessions: { destroy(): void }[] = [];
  const api = {
    audio, storage, get state() { return state; },
    multiplayer<State extends Json = Json, Actions extends Record<string, Json> = Record<string, Json>>() {
      const session = createMultiplayer<State, Actions>(id); sessions.push(session); return session;
    },
    initialize(): Promise<void> {
      if (state === 'destroyed') return Promise.reject(new Error('Game is destroyed'));
      if (state !== 'new') return Promise.resolve();
      return pending ??= Promise.resolve().then(() => hooks.initialize()).then(() => { if (state !== 'destroyed') state = 'ready'; }).catch(error => { pending = undefined; throw error; });
    },
    start() { if (state === 'ready') { hooks.start(); state = 'running'; } },
    pause() { if (state === 'running') { hooks.pause(); audio.pause(); state = 'paused'; } },
    resume() { if (state === 'paused') { hooks.resume(); state = 'running'; } },
    restart() { if (state === 'running' || state === 'paused') { audio.pause(); hooks.restart(); state = 'running'; } },
    score(value: number) { const best = storage.highScore(value); bridge.score(best); return best; },
    requestPause() { api.pause(); bridge.requestPause(); },
    requestFullscreen() { bridge.requestFullscreen(); },
    destroy() { if (state !== 'destroyed') { state = 'destroyed'; for (const session of sessions) session.destroy(); bridge.destroy(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', api.destroy); audio.destroy(); hooks.destroy(); } },
  };
  const bridge = createBridge(message => { if (message.type === 'mute') { audio.mute(message.muted!); hooks.mute?.(message.muted!); } else api[message.type](); });
  const visibility = () => { if (document.hidden) api.pause(); };
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', api.destroy);
  return { ...api, get state() { return state; }, async boot() { await api.initialize(); api.start(); bridge.ready(); } };
}
