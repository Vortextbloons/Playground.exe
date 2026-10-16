# Playground.exe

A home for small games, playful experiments, and ideas worth sharing. Pick a game, jump in, and see where it takes you—no downloads or account needed.

Each game has its own page, and you can browse the collection by title or genre. Blockwave is a solo puzzle; Pocket Circuit demonstrates multiplayer and mixed solo/shared rounds.

## Play

Open Playground.exe in your browser and choose a game from the library. Scores and preferences are saved in your browser, so they stay on your device.

## Make a game

Have an idea? Give it a home in the playground:

1. Install [Node.js](https://nodejs.org/) (version 22.22 or newer).
2. From this project folder, create a game and start its local preview:

   ```sh
   npm install
   npm run new:game my-game
   npm install
   npm run dev:game my-game
   ```

3. Build your game in `games/my-game/`. Add its name, description, genre, controls, and other details in `game.json`.
4. When it’s ready to join the playground, run:

   ```sh
   npm run build
   ```

The starter game is intentionally blank—your idea supplies the rules, artwork, and fun. For step-by-step help, open the Guide from the playground.

## Run the playground locally

```sh
npm install
npm run dev
```

Open the local address printed in the terminal. To publish the playground, push the project to GitHub and enable GitHub Pages with GitHub Actions.

## Multiplayer parties

The Party page has a dedicated create/join → game selection → seats and readiness → launch flow. Guests join with a four-digit code, stay together across games, and watch or sit out when a game's seats are full. The host selects a mode, participating players ready up, and a new round launches for those players. Solo pages keep a compact party link instead of the full lobby.

Run the complete arcade and Cloudflare backend locally:

```sh
npm run build:cloudflare
npm run dev:party
```

Open http://localhost:8787/party/. Use separate browser profiles for separate guests. Run `npm run dev` in another terminal for frontend development. Test the backend with `npm run test:party` while the local server runs.

Docker is optional:

```sh
docker compose up --build -d party
docker compose run --build --rm test
```

Create a multiplayer-ready game with `npm run new:game my-game -- --multiplayer`. The shared kit handles transport and reconnecting; each game provides its own validated server rules and per-mode player limits.

See [the multiplayer guide](docs/multiplayer.md) for helper calls, networking presets, game adapters, Docker, free-tier budgeting and deployment. Nothing is deployed by local development or tests. `npm run deploy:cloudflare` publishes both the arcade and Worker when you are ready. Static GitHub Pages hosting remains available; set the `PUBLIC_PARTY_API_URL` repository variable and allow that origin in the Worker to connect it to parties.
