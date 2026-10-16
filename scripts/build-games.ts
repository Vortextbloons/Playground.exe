import { build } from 'vite';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { discoverGames } from '../src/data/games.ts';
const games = await discoverGames();
// Only remove generated output inside this fixed directory, never game sources.
const output = resolve('public/games');
const within = relative(process.cwd(), output);
if (isAbsolute(within) || within.startsWith('..') || output !== resolve(process.cwd(), 'public', 'games')) throw new Error('Unsafe game output directory');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, '.gitkeep'), '');
// Never delete the output directories themselves: the dev server watches them,
// and files written into a directory it has not (re)registered yet are refused
// with a 404 until the server restarts. Clearing files keeps every watch alive;
// Vite then emits the new files as ordinary changes.
async function clearFiles(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await clearFiles(path);
    else await rm(path, { force: true });
  }
}
const current = new Set(games.map(game => game.id));
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (entry.isDirectory() && !current.has(entry.name)) await rm(resolve(output, entry.name), { recursive: true, force: true });
}
for (const game of games) {
  const outDir = resolve(output, game.id);
  await mkdir(outDir, { recursive: true });
  await clearFiles(outDir);
  await build({ root: resolve('games', game.id), base: './', build: { outDir, emptyOutDir: false } });
}
console.log(`Built ${games.length} games. Template excluded.`);
