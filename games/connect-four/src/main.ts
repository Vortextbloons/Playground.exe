import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import type { ConnectActionPayloads, ConnectState } from './multiplayer';
import metadata from '../game.json';
import './styles.css';

const target = document.querySelector<HTMLElement>('#game');
if (!target) throw new Error('Connect Four: #game root element is missing');

interface ConnectHandle {
  restart(): void;
  pause(): void;
  resume(): void;
}

let handle: ConnectHandle | undefined;
let teardown: (() => void) | undefined;

const game = createGame('connect-four', {
  initialize() {
    const app = mount(App, {
      target,
      props: { session, menuElement: partyMenu.element },
    });
    handle = app as unknown as ConnectHandle;
    teardown = () => {
      void unmount(app);
      partyMenu.destroy();
    };
  },
  start() {
    target.focus();
  },
  pause() {
    handle?.pause();
  },
  resume() {
    handle?.resume();
  },
  restart() {
    handle?.restart();
  },
  destroy() {
    handle = undefined;
    const release = teardown;
    teardown = undefined;
    release?.();
  },
});

const session = game.multiplayer<ConnectState, ConnectActionPayloads>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));

void game.boot().catch(error => {
  console.error(error);
  game.destroy();
});
