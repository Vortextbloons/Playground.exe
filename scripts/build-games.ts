import { build } from 'vite';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { discoverGames } from '../src/data/games.ts';
const games = await discoverGames();
// Only remove generated output inside this fixed directory, never game sources.
const output = resolve('public/games');
const within = relative(process.cwd(), output);
if (isAbsolute(within) || within.startsWith('..') || output !== resolve(process.cwd(), 'public', 'games')) throw new Error('Unsafe game output directory');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
await writeFile(resolve(output, '.gitkeep'), '');
for (const game of games) {
  await build({ root: resolve('games', game.id), base: './', build: { outDir: resolve(output, game.id), emptyOutDir: true } });
}
console.log(`Built ${games.length} games. Template excluded.`);
