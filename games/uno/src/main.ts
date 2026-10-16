import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import { mount, unmount } from 'svelte';
import UnoApp from './UnoApp.svelte';
import type { UnoActionPayloads, UnoView } from './rules/engine';
import { sound } from './sound';
import metadata from '../game.json';
import './styles.css';

const target = document.querySelector<HTMLElement>('#game');
if (!target) throw new Error('UNO: #game root element is missing');

let teardown: (() => void) | undefined;

const game = createGame('uno', {
  initialize() {
    const app = mount(UnoApp, {
      target,
      props: { session, menuElement: partyMenu.element },
    });
    teardown = () => {
      void unmount(app);
      partyMenu.destroy();
    };
  },
  start() {
    target.focus();
  },
  pause() {},
  resume() {},
  restart() {},
  mute(muted) {
    sound.setEnabled(!muted);
  },
  destroy() {
    const release = teardown;
    teardown = undefined;
    release?.();
  },
});

const session = game.multiplayer<UnoView, UnoActionPayloads>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));

void game.boot().catch(error => {
  console.error(error);
  game.destroy();
});
