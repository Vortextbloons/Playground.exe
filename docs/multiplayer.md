# Multiplayer in Playground.exe

The arcade owns parties and connections. Games own their rules. A party lasts across game pages, supports up to 16 guests, and uses a four-digit temporary invitation code. Each mode declares its own seat limit. A code admits new guests; a separate random guest token restores existing membership. Codes are private invitations, not passwords for sensitive information.

## Run locally

```sh
npm install
npm run build:cloudflare
npm run dev:party
```

Open http://localhost:8787. Use separate browser profiles or private windows to simulate different guests. A remembered guest has one active party tab; opening another tab transfers its connection. The built arcade and API run together locally. No Cloudflare account is needed for local testing.

For frontend editing, run `npm run dev` in a second terminal and open http://localhost:4321. Development defaults to the API at localhost:8787. Rebuild games after game-source edits; run `npm run build:multiplayer` after changing game metadata or adding a server adapter, so Wrangler picks up the new registry. `npm run dev:game <id>` runs a standalone solo game without the arcade party bridge.

## Test with Docker

Start Docker Desktop with Linux containers, then:

```sh
docker compose up --build -d party
docker compose run --build --rm test
docker compose down
```

Open http://localhost:8787. The named volume keeps local Durable Object SQLite data between container restarts. The test service runs three WebSocket clients through all three networking presets and checks readiness, spectators, private practice, reconnects, host handoff and heartbeat responses. Stop a native Wrangler server first if it occupies port 8787.

Docker runs the local Wrangler/Miniflare/workerd environment. It does not simulate geographic routing, real-world network latency, production hibernation timing or account-wide free-tier enforcement. Test deployment separately before publishing widely. `docker compose config --quiet` validates Compose configuration without starting the Docker engine.

## Add a game

```sh
npm run new:game my-game -- --multiplayer
npm install
npm run build:cloudflare
```

The multiplayer template includes a working client, server rules, and three declared modes. Without `--multiplayer`, the original blank solo template is used and no networking setup is required. `pocket-circuit` is the playable reference implementation; its individual practice transitions into a shared round.

Declare optional `multiplayer.modes` in `game.json`:

```json
{
  "solo": true,
  "multiplayer": {
    "modes": [{
      "id": "duel",
      "label": "Duel",
      "minPlayers": 2,
      "maxPlayers": 4,
      "preset": "turn-based",
      "spectators": true,
      "lateJoin": "spectate",
      "disconnect": "reserve"
    }]
  }
}
```

`solo` defaults to true; set it to false for a multiplayer-only game. `minPlayers`/`maxPlayers` must be 1–16. The host picks the game and mode, people take seats and ready up, then the host starts. Changing the selection clears readiness. Excess party members watch or sit out. Default late arrivals wait for the next round; `lateJoin: "join"` permits taking an open seat mid-round. Games opting in must initialize new players through `playersChanged()` or their action handler.

## Client helpers

```ts
import { createGame } from '@playground-exe/game-kit';

const game = createGame('my-game', lifecycle);
const session = game.multiplayer<MyState, MyActions>();

session.onState((state, view) => render(state, view.isPlayer));
session.onPlayers(players => renderPlayers(players));
session.onError(message => showError(message));
session.subscribe(view => showConnection(view.connected));
session.send('place-piece', { pieceId: 'square', x: 2, y: 3 });
```

`MyState` must be JSON-compatible; `MyActions` maps action names to JSON payload types. `session.current` contains the party, current match, player ID, connection and participation state. `send()` returns false when disconnected, observing, finished or its bounded queue is full. It returns true when queued, not when accepted by the server. Render accepted game state from `onState`. Each subscription returns an unsubscribe function. `game.destroy()` cleans up sessions automatically. The standalone `createMultiplayer()` helper is also exported from `@playground-exe/game-kit/multiplayer`; destroy it when your game stops.

Games receive no guest credentials. The parent checks iframe source, origin, game ID and active match before forwarding actions. Solo play should remain local; do not send individual frame rendering, unrelated solo progress or private information through general broadcasts.

## Server rules

Create `games/<id>/src/multiplayer.ts` with a default export:

```ts
import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';

export default defineMultiplayer({
  setup(context) {
    return { state: { score: 0 }, phase: 'shared' };
  },
  action(raw, action, payload, context) {
    // Validate action, payload, turn, bounds and timing here.
    // Never trust a client-supplied final score or player ID.
    throw new Error('Implement game rules here.');
  },
  view(state, playerId) {
    // playerId is null for spectators. Return only allowed information.
    return state;
  },
});
```

`context` supplies authenticated `playerId`, participating `playerIds`, mode, server time and a server-generated match seed. Rules execute inside the party's Durable Object. `action()` returns `{ state, phase?, finished? }`; phase names are game-defined, so a game may switch between solo and shared segments or expose separate modes. Keep private data in server state and filter it in `view()`; no-watching modes send null state to nonparticipants. An optional `playersChanged(state, context)` reconciles turns and phases after membership changes; its context has an empty `playerId` because it is not a player action.

The registry is generated from metadata and imports game adapters automatically. Missing adapters fail the build. No per-game Durable Object class, extra server, database or manual registry edit is needed. Publish updated server and client builds together when changing rules or protocol.

## Disconnects and expiration

Seats and the host role remain reserved for 60 seconds after disconnect, so navigating between the lobby and games does not change the host. After that grace period, the seat is released and the host role passes to a connected guest. `disconnect: "remove"` releases the seat immediately. A disconnected player must ready up again in the lobby. Explicit leave removes membership and match participation immediately and transfers host if needed. Empty matches finish. The default party expires after 30 minutes without accepted activity, or after 12 hours total. Heartbeats do not extend party lifetime. Guests can create a new party without accounts; account support is a future identity provider, not part of this implementation.

## Free-tier efficiency

One SQLite-backed Durable Object coordinates each party. Hibernating WebSockets keep quiet lobbies connected without an idle game loop. Automatic ping/pong responses avoid running game handlers. There is no HTTP polling, global lobby database or per-player Durable Object. Alarms handle expiration and seat cleanup, and are rescheduled only when needed.

- `turn-based`: sends actions immediately; 4 gameplay actions/second per guest plus a small burst allowance.
- `shared-challenge`: batches client and server updates in 250 ms windows; 8 actions/second per guest.
- `live`: batches updates in 100 ms windows; 20 actions/second per guest. Render smoothly between snapshots in the client. The example demonstrates discrete movement; prediction, interpolation and physics remain game-specific.

Server batching shares one durable state write and broadcast window across players. State is saved before accepted updates are broadcast; there are no acknowledged in-memory-only match changes. Rate caps survive hibernation in socket attachments. Incoming messages are limited to 8 KB, batches to eight actions, pending server actions to 128, and state to 32 KB. Join/create attempts are limited per IP using Cloudflare's Rate Limiting binding; this is a local approximate limiter, not a global spending cap.

Free-tier usage is account-wide. Continuous 10 Hz live updates can still approach 36,000 state writes per active room-hour, plus membership and alarm operations. Shared challenges can approach 14,400 writes per active room-hour. These are conservative maxima from the batching intervals, not measured capacity or a guarantee of staying free. Measure requests, duration and rows written before opening the arcade to large audiences. On the Free plan, hitting a quota can make affected operations fail; on a Paid account, a free allowance is not a hard spending cap. No plan or billing settings are changed by these files.

## Deployment

```sh
npm run check
npm test
npm run build:cloudflare
npx wrangler deploy --dry-run
```

After reviewing the build, `npm run deploy:cloudflare` publishes both static assets and the party Worker to the selected Cloudflare account. The SQLite migration and bindings are in `wrangler.jsonc`. For separate frontend hosting, set `PUBLIC_PARTY_API_URL=https://<worker>/api` at frontend build time and set `ALLOWED_ORIGINS` to the exact frontend origin in Worker configuration; paths such as GitHub Pages repository names are not part of the origin. Remove localhost origins from production configuration when no longer needed. The existing GitHub Pages workflow reads the `PUBLIC_PARTY_API_URL` repository variable. With no API URL in a production static build, parties show as unavailable and solo games continue to work.

Run `npm run types:party` after binding changes. `npm run check:party` checks the Worker separately from browser types. With the local server running, `npm run test:party` runs the network integration test.
