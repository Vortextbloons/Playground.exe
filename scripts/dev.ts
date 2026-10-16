import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { buildGames, watchGames } from './build-games.ts';
import { buildMultiplayerRegistry } from './build-multiplayer.ts';
await buildMultiplayerRegistry();
// Build games before Astro snapshots public/, including on a fresh checkout,
// then keep rebuilding them as game code changes while the dev server runs.
const games = await buildGames();
watchGames(games);

const children: ChildProcess[] = [];
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function start(entry: string, args: string[]) {
  const child = spawn(process.execPath, [resolve(entry), ...args], { stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}

start('node_modules/wrangler/bin/wrangler.js', ['dev', '--port', '8787']);
start('node_modules/astro/bin/astro.mjs', ['dev', ...process.argv.slice(2)]);