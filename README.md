# Personal Arcade

A static Astro + Svelte arcade with isolated Vite games and a small, engine-agnostic TypeScript toolkit. The library ships empty: `_template` is never discovered or published.

## Local development

Use Node 22.22+ (Node 24 LTS recommended) and npm.

```sh
npm install
npm run dev
```

The website runs at the URL printed by Astro. To add a game:

```sh
npm run new:game my-game
npm install
npm run dev:game my-game
```

Edit `games/my-game/src/main.ts` and `game.json`. Restart Astro after adding or deleting a game. Development of individual games uses its own Vite server; the website embeds the most recent **built** version. Run `npm run build:games` to refresh embedded games while Astro is running. For independent builds: `npm run build --workspace=@arcade/my-game`, or `cd games/my-game && npm install && npm run build`. The local Game Kit dependency must remain available at `../../packages/game-kit`.

## Metadata

Every non-hidden game folder except those prefixed `_` must have valid `game.json`. Missing/invalid metadata fails the build with a directory-specific error.

```json
{
  "id": "my-game",
  "title": "My Game",
  "description": "Describe the game.",
  "genre": "Puzzle",
  "tags": ["keyboard"],
  "author": "Your name",
  "version": "0.1.0",
  "date": "2026-10-16",
  "controls": "Describe keyboard, mouse, or touch controls.",
  "cover": "cover.webp"
}
```

`id` must equal the kebab-case folder name. `cover` is optional and refers to an image under the game's `public/` directory. All other fields are required. Genres come from metadata automatically. Put game assets in each game's `public/` or import assets from source. Use `import.meta.env.BASE_URL` for dynamically constructed asset paths; avoid absolute `/assets/...` URLs. Vite builds use `base: './'` to work at any repository path.

## Game Kit

Import from `@arcade/game-kit`. No renderer or physics engine is supplied.

- `createGame(id, hooks)`: initialize, start, pause, resume, restart, destroy. `boot()` awaits initialization and starts once. Hooks own updates/render loops and must clean them up. `destroy()` disconnects the host bridge and utilities it owns. Don't start asynchronous work in initialize without arranging cancellation in destroy.
- `createInput(element)`: keyboard state and normalized pointer coordinates (`0..1`) for mouse, pen, and touch. Make the element focusable. `destroy()` releases listeners. Clear inputs when pausing. Convert normalized coordinates to your logical canvas coordinates.
- `fitCanvas(canvas, container, width, height)`: 2D canvas sizing with a fixed logical coordinate system and up to 2× pixel density. Observe resize and redraw afterward: resizing clears canvas contents. Container needs an explicit size. Call `destroy()` when finished.
- `loadImage(url)` and `loadJSON<T>(url, signal?)`: promise-based assets. Asset errors reject; handle them in your loading UI. JSON's generic is a type hint; validate untrusted data separately.
- `game.audio`: load/play/mute/pause/destroy HTML audio tracks. Playback failures (including autoplay restrictions) return `false`; start audio from a game interaction. Resume desired audio in your resume hook.
- `game.storage`: get/set/remove and `highScore(number)`. Keys are prefixed `arcade:game:<id>:`. Storage failures are tolerated. Validate saved data for your application's schema.
- `game.score(number)`: save the personal best and notify the host. Higher scores win. `requestPause()` pauses and notifies the website. `requestFullscreen()` prompts the host to direct the player to its fullscreen button, because browsers require a user gesture.

The bridge checks the exact message source, same origin, channel, and command schema. The host re-sends the mute preference after `ready`. Visibility changes pause the game; the user explicitly resumes it. Keep synchronous hooks small; initialize may be asynchronous. Lifecycle calls outside the appropriate state are ignored. Restart hooks should reset and resume gameplay, including from paused state.

## Optional Phaser

```sh
npm install phaser --workspace=@arcade/my-game
```

Import Phaser only in the game. The `@arcade/game-kit/phaser` subpath exports `phaserLifecycle(() => engine, initialize)`; the core kit never loads Phaser. The adapter pauses active scenes, resumes those scenes, mutes engine audio, and restarts at the first scene. You can also map lifecycle hooks directly to your Phaser game/scene methods for more control over multi-scene behavior. Use Phaser's Scale Manager instead of the 2D `fitCanvas` helper for Phaser rendering. Custom engines can implement the optional `mute(boolean)` hook.

## Build and deploy

```sh
npm run check
npm test
npm run build
npm run preview
```

The game build validates discovery, clears only generated `public/games/` output, and bundles each game separately. Astro then prerenders `/play/<id>/` and copies the game bundles to `dist/games/<id>/`. Game metadata and sources are the source of truth; never hand-edit generated output. Each game runs in its own iframe. Only publish your own trusted games: same-origin iframe sandboxing and storage namespaces prevent accidental collisions, not hostile scripts.

Create a GitHub repository, push to `main`, then select **Settings → Pages → Source → GitHub Actions**. `.github/workflows/deploy.yml` installs from the committed lockfile, checks, tests, builds, and deploys `dist`. `actions/configure-pages` supplies `SITE_URL` and `BASE_PATH`, including repository paths and custom domains. Nothing is deployed until you connect and push the repository.

To reproduce a repository subpath build locally (PowerShell):

```powershell
$env:SITE_URL = 'https://your-name.github.io'
$env:BASE_PATH = '/your-repo'
npm run build
npm run preview
```

Open the printed URL under `/your-repo/`. Unset those environment variables to return to root deployment. The default `SITE_URL` is a placeholder; configure it for production outside Actions. Preferences and scores are local to this origin/browser and are best-effort when browser storage is disabled. No backend, database, or authentication.

## Layout

```
src/{pages,components,layouts,data,lib,styles}
games/_template/       Blank game scaffold (not a game)
packages/game-kit/    Shared source package
scripts/              Scaffold, dev, and build commands
public/games/         Generated game bundles
.github/workflows/    GitHub Pages deployment
```
