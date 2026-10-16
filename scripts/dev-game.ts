import { createServer } from 'vite';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { validId } from '../src/data/games.ts';
const id = process.argv[2];
if (!id || !validId(id)) throw new Error('Usage: npm run dev:game <name>');
await access(resolve('games', id, 'game.json'));
const server = await createServer({ root: resolve('games', id) });
await server.listen(); server.printUrls();
