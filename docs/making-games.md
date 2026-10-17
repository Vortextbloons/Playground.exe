# Making games for Playground.exe

A game is an npm workspace under `games/<id>/` built by Vite and embedded by the arcade in a same-origin iframe. Shared code lives in `packages/game-kit` (`@playground-exe/game-kit`); networking is documented separately in `docs/multiplayer.md`. Requires Node 22.22 or newer.

## Create a game

```sh
npm run new:game my-game        # add `-- --multiplayer` for networking
npm install
npm run dev:game my-game
```

The id must be kebab-case (`lowercase-words`) and match the directory name. Scaffolding copies `games/_template` (plus `games/_multiplayer-template` when networking) into `games/my-game/`, fills the `__GAME_ID__`, `__GAME_TITLE__` and `__DATE__` placeholders, and links `@playground-exe/game-kit` as a file dependency. Do not hand-create game directories; directories starting with `_` are scaffolds, not games.

```
games/my-game/
  game.json      Arcade metadata (discovered from here)
  game.html      Vite entry point — never index.html; Astro reserves that path
  package.json   Workspace `@playground-exe/my-game` with dev/build/preview scripts
  tsconfig.json
  vite.config.ts  base './', builds game.html, dev redirect / → /game.html
  src/main.ts    Game entry: wires the kit and boots the game
  src/style.css
  src/multiplayer.ts   Multiplayer server rules (multiplayer template only)
  public/        Optional: cover and other copied-as-is assets
```

## Metadata (`game.json`)

```json
{
  "id": "my-game",
  "title": "My Game",
  "description": "One or two sentences shown on the arcade.",
  "genre": "Puzzle",
  "tags": ["blocks", "mouse"],
  "author": "Isaac",
  "version": "0.1.0",
  "date": "2026-10-16",
  "controls": "Drag with the mouse. Space to rotate.",
  "cover": "cover.svg"
}
```

`id`, `title`, `description`, `genre`, `author`, `version`, `date` and `controls` are required strings; `date` must be a real calendar date in `YYYY-MM-DD`. `id` must equal the kebab-case directory name. `tags` is a string array. `cover` is an optional relative image path (`png`/`jpg`/`jpeg`/`webp`/`svg`, no `..`); put the file in the game's `public/` folder, so `games/my-game/public/cover.svg` is `"cover": "cover.svg"`. `solo` defaults to true; a multiplayer-only game sets `"solo": false` and declares `multiplayer` modes. Discovery fails the build on invalid metadata.

## Develop

- `npm run dev:game my-game` — standalone Vite server for the game alone; the arcade bridge is inactive outside the arcade.
- `npm run dev` — arcade at localhost:4321; `scripts/dev.ts` rebuilds games whose `src/**` or `game.html` changes (200 ms debounce), and rebuilds every game when `packages/game-kit/src` changes. Metadata, covers and configs do not trigger rebuilds — rerun the build for those.
- `npm run build:games` — builds every game workspace into `public/games/<id>/`; a failing game is skipped with a warning. Run this after editing game source.
- `npm run check` before finishing any change; `npm test` for unit tests; with `npm run dev` running, `npm run test:games` fetches each built `game.html` and its assets to verify they are served.

## Lifecycle

`createGame(id, hooks)` returns the game object. Call `game.boot()` once; it initializes, starts and tells the arcade the game is ready. The kit pauses automatically when the tab is hidden and destroys the game on page hide.

```ts
import { createGame } from '@playground-exe/game-kit';

const game = createGame('my-game', {
  initialize() { /* load assets, build the engine; may be async */ },
  start() { /* begin updates */ },
  pause() { /* stop updates */ },
  resume() { /* resume updates */ },
  restart() { /* reset state */ },
  destroy() { /* cancel loops, release engine resources */ },
  mute(muted) { /* optional: engine-specific muting */ },
});
void game.boot().catch(error => { console.error(error); game.destroy(); });
```

States move `new → ready → running ⇄ paused → destroyed`; hooks only fire on valid transitions. The game object also exposes:

- `game.score(value)` — keeps the best of the reported values in storage and posts the best to the arcade, which shows it on the game page. Never trust a client score on a server; for multiplayer the authoritative result belongs in server rules.
- `game.audio` and `game.storage` — see below.
- `game.multiplayer<State, Actions>()` — creates a networking session that is destroyed with the game (`docs/multiplayer.md`).
- `game.requestPause()` and `game.requestFullscreen()` — ask the arcade UI to pause or go fullscreen.
- `game.state` — current lifecycle state; `game.destroy()` releases everything, including multiplayer sessions.

The arcade and game talk through `window.postMessage` on the `playground-exe` channel: the game sends `ready`, `score`, `pause` and `fullscreen`; the arcade sends `pause`, `resume`, `restart` and `mute`. Both sides validate channel, source and origin. Games cannot see party credentials.

## Kit resources

Import everything below from `@playground-exe/game-kit` unless noted.

**Input** — `createInput(container)` attaches keyboard and pointer listeners to the element (focusable container recommended). `input.keys` is a `Set` of `KeyboardEvent.code` values; Space and arrow keys are preventDefault-ed. `input.pointer` exposes `x`/`y` normalized to 0–1 within the element, `down`, and `pointerType`. `input.isDown(code)`, `input.clear()` (also runs on blur) and `input.destroy()`.

**Canvas** — `fitCanvas(canvas, container, width = 960, height = 540)` keeps logical coordinates constant while CSS scales the canvas to fit the container, honoring device pixel ratio (capped at 2) through a `ResizeObserver`. Returns `{ resize, destroy }`.

**Storage** — `createStorage(id)` (also available as `game.storage`) namespaces localStorage under `playground-exe:game:<id>:`. `get<T>(key, fallback)` parses JSON, `set` returns whether the write succeeded, `remove`, and `highScore(score)` returns the running best.

**Audio** — `createAudio()` (also available as `game.audio`) tracks loaded clips so the arcade mute toggle and game pauses apply everywhere: `load(url, loop)`, `play(audio)` (resolves false when the browser refuses), `mute(value)`, `pause()`, `destroy()`.

**Assets** — `loadImage(url)` decodes an image, `loadJSON<T>(url, signal?)` fetches and parses JSON, throwing on non-OK responses.

**Bridge** — `createBridge(handler)` implements the host messaging described above; `createGame` wires it for you, so use it only outside the normal lifecycle.

## Engine adapters

Optional adapters translate the lifecycle to popular engines. The base kit never imports them; install the engine in the game workspace (e.g. `"three": "^0.186.0"`), import the adapter from its subpath, and pass its lifecycle into `createGame`.

- `@playground-exe/game-kit/phaser` — `phaserLifecycle(getGame, initialize)` pauses the active Phaser scenes and mutes through `game.sound`.
- `@playground-exe/game-kit/three` — `threeLifecycle(getGame, initialize, tick)` runs `tick` on the renderer's animation loop; restart re-runs `initialize`, destroy disposes the renderer and removes the canvas.
- `@playground-exe/game-kit/rapier` — `rapierLifecycle(getGame, initialize, tick)` steps the Rapier world on `requestAnimationFrame` with the frame delta (capped at 0.1 s); restart and destroy `free()` the world.

Plain Canvas 2D, DOM or any other engine also work — the template ships engine-free.

## Multiplayer

Declare `multiplayer.modes` in `game.json`, call `game.multiplayer()` on the client for `onState`/`onPlayers`/`send`/`command`, define authoritative rules with `defineMultiplayer` in `games/<id>/src/multiplayer.ts`, and mount the ready-made `createMultiplayerMenu(session, gameId, config)` element. Presets (`turn-based`, `shared-challenge`, `live`) set batching and rate limits. Full API, hosting behavior and deployment are in `docs/multiplayer.md`; `pocket-circuit` is the playable reference implementation.