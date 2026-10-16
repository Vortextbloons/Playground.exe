import { createGame } from '@playground-exe/game-kit';
import { mount, unmount } from 'svelte';
import BlockPuzzle from './BlockPuzzle.svelte';
import './styles.css';

const target = document.querySelector<HTMLElement>('#game');
if (!target) throw new Error('Blockwave: #game root element is missing');

interface PuzzleHandle {
  pause(): void;
  resume(): void;
  restart(): void;
  setMuted(muted: boolean): void;
}

let handle: PuzzleHandle | undefined;
let teardown: (() => void) | undefined;

const game = createGame('block-puzzle', {
  initialize() {
    const app = mount(BlockPuzzle, {
      target,
      props: {
        storage: game.storage,
        reportScore(score: number) {
          game.score(score);
        },
      },
    });
    handle = app as unknown as PuzzleHandle;
    teardown = () => {
      void unmount(app);
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
  mute(muted) {
    handle?.setMuted(muted);
  },
});

void game.boot().catch(error => {
  console.error(error);
  game.destroy();
});
