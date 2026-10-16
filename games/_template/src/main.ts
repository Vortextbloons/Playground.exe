import { createGame, createInput, fitCanvas } from '@playground-exe/game-kit';
import './style.css';
const container = document.querySelector<HTMLElement>('#game')!;
const canvas = container.querySelector('canvas')!;
const input = createInput(container);
const sizing = fitCanvas(canvas, container);
const game = createGame('__GAME_ID__', {
  initialize() { /* Load assets and initialize your engine here. */ },
  start() { container.focus(); /* Start your engine or animation loop. */ },
  pause() { input.clear(); /* Stop updates. */ },
  resume() { /* Resume updates and any desired audio. */ },
  restart() { input.clear(); /* Reset game state and resume updates. */ },
  destroy() { input.destroy(); sizing.destroy(); /* Cancel loops and release engine resources. */ },
});
void game.boot().catch(error => { console.error(error); game.destroy(); });
