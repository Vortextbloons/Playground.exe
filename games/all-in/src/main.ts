import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { mount, unmount } from 'svelte';
import metadata from '../game.json';
import App from './ui/App.svelte';
import type { PlayerView } from './core/types';
import { createHybridHost } from './host/hybrid';
import { createMusic } from './music';
import { sound } from './sound';
import type { HostStatus } from './host/types';
import './style.css';

const container = document.querySelector<HTMLElement>('#game')!;
container.replaceChildren();

const toast = document.createElement('p');
toast.style.cssText = 'position:fixed;left:50%;bottom:4.5rem;transform:translateX(-50%);z-index:60;max-width:min(90vw,28rem);padding:0.6rem 1rem;border-radius:0.75rem;background:#181e32;border:1px solid #f4c95d;color:#f4c95d;font-size:0.9rem;text-align:center;box-shadow:0 0 24px rgba(244,201,93,0.25)';
toast.setAttribute('role', 'alert');
toast.hidden = true;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showError(message: string) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

let app: ReturnType<typeof mount> | null = null;
let menu: ReturnType<typeof createMultiplayerMenu> | null = null;
let host: ReturnType<typeof createHybridHost> | null = null;
let reported = false;
let intensityTimer: ReturnType<typeof setInterval> | undefined;

const music = createMusic();
let latest: HostStatus | null = null;
let latestAt = 0;

function syncIntensity(): void {
  if (!latest || latest.view.deadline <= 0) {
    music.setIntense(false);
    return;
  }
  const remaining = latest.view.deadline - (latest.view.now + (Date.now() - latestAt));
  music.setIntense(latest.view.phase === 'playing' && remaining <= 60_000);
}

const game = createGame('all-in', {
  initialize() {
    const session = game.multiplayer<PlayerView, Record<string, Json>>();
    host = createHybridHost(session);
    menu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));
    session.onError(showError);
    host.subscribe(status => {
      latest = status;
      latestAt = Date.now();
      syncIntensity();
      if (status.view.phase === 'results' && status.view.vault) {
        if (!reported) {
          reported = true;
          game.score(Math.max(0, status.view.vault.bankroll - status.view.vault.penalty));
        }
      } else {
        reported = false;
      }
    });
    intensityTimer = setInterval(syncIntensity, 5_000);
    container.append(toast);
    app = mount(App, { target: container, props: { host, menu: menu.element } });
  },
  start() {
    container.focus();
    music.start();
  },
  pause() { music.stop(); },
  resume() { music.start(); },
  restart() { host?.send('again', null); },
  destroy() {
    if (app) void unmount(app);
    app = null;
    menu?.destroy();
    menu = null;
    host = null;
    clearTimeout(toastTimer);
    clearInterval(intensityTimer);
    intensityTimer = undefined;
    latest = null;
    sound.destroy();
    music.destroy();
  },
  mute(muted) {
    sound.setEnabled(!muted);
    music.setEnabled(!muted);
  },
});

void game.boot().catch(error => {
  showError(String(error));
  game.destroy();
});
