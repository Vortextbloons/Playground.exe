import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import { mount, unmount } from 'svelte';
import MonopolyApp from './MonopolyApp.svelte';
import type { MonoActionPayloads, MonoView } from './rules/engine';
import { sound } from './sound';
import metadata from '../game.json';
import './styles.css';

const target = document.querySelector<HTMLElement>('#game');
if (!target) throw new Error('MONOPOLY: #game root element is missing');

let teardown: (() => void) | undefined;

const game = createGame('monopoly', {
  initialize() {
    const app = mount(MonopolyApp, {
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

const session = game.multiplayer<MonoView, MonoActionPayloads>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));

void game.boot().catch(error => {
  console.error(error);
  game.destroy();
});