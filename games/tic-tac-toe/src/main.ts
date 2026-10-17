import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import type { TicActionPayloads, TicState } from './multiplayer';
import metadata from '../game.json';
import './styles.css';

const target = document.querySelector<HTMLElement>('#game');
if (!target) throw new Error('Tic-Tac-Toe: #game root element is missing');

interface TicHandle {
  restart(): void;
  pause(): void;
  resume(): void;
}

let handle: TicHandle | undefined;
let teardown: (() => void) | undefined;

const game = createGame('tic-tac-toe', {
  initialize() {
    const app = mount(App, {
      target,
      props: { session, menuElement: partyMenu.element },
    });
    handle = app as unknown as TicHandle;
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

const session = game.multiplayer<TicState, TicActionPayloads>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));

void game.boot().catch(error => {
  console.error(error);
  game.destroy();
});