import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validId } from '../src/data/games.ts';
const id = process.argv[2];
const multiplayer = process.argv.includes('--multiplayer');
if (!id || !validId(id)) throw new Error('Usage: npm run new:game <kebab-case-name> [--multiplayer]');
const target = resolve('games', id);
try { await access(target); throw new Error(`Game already exists: ${id}`); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await mkdir(target);
await cp(resolve('games/_template'), target, { recursive: true });
if (multiplayer) await cp(resolve('games/_multiplayer-template'), target, { recursive: true });
for (const file of ['package.json', 'game.json', 'game.html', 'src/main.ts']) {
  const path = resolve(target, file);
  await writeFile(path, (await readFile(path, 'utf8')).replaceAll('__GAME_ID__', id).replaceAll('__GAME_TITLE__', id.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ')).replaceAll('__DATE__', new Date().toISOString().slice(0, 10)));
}
console.log(`Created games/${id}. Run npm install, then npm run dev:game ${id}.`);
if (multiplayer) console.log('Multiplayer starter included. Run npm run dev:party alongside the playground, then create a party from the site header.');
