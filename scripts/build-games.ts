import { build } from 'vite';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverGames } from '../src/data/games.ts';
// Only remove generated output inside this fixed directory, never game sources.
const output = resolve('public/games');
const within = relative(process.cwd(), output);
if (isAbsolute(within) || within.startsWith('..') || output !== resolve(process.cwd(), 'public', 'games')) throw new Error('Unsafe game output directory');
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
function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? String(error);
}
async function buildGame(id: string): Promise<void> {
  const outDir = resolve(output, id);
  await mkdir(outDir, { recursive: true });
  await clearFiles(outDir);
  await build({ root: resolve('games', id), base: './', build: { outDir, emptyOutDir: false } });
}
export async function buildGames(): Promise<Set<string>> {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, '.gitkeep'), '');
  const games = await discoverGames();
  const current = new Set(games.map(game => game.id));
  for (const entry of await readdir(output, { withFileTypes: true })) {
    if (entry.isDirectory() && !current.has(entry.name)) await rm(resolve(output, entry.name), { recursive: true, force: true });
  }
  let built = 0;
  for (const id of current) {
    try { await buildGame(id); built++; }
    catch (error) { console.warn(`Skipped ${id}: ${errorMessage(error)}`); }
  }
  console.log(`Built ${built} games. Template excluded.`);
  return current;
}
// Rebuild games while the dev server runs. Only code (src/** and game.html)
// triggers a rebuild; metadata, covers and configs do not.
export function watchGames(gameIds: Iterable<string>): void {
  const ids = [...gameIds];
  const dirty = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let building = false;
  const pump = async (): Promise<void> => {
    while (dirty.size > 0) {
      const batch = [...dirty];
      dirty.clear();
      for (const id of batch) {
        try { await buildGame(id); console.log(`Rebuilt ${id}.`); }
        catch (error) { console.warn(`Failed ${id}: ${errorMessage(error)}`); }
      }
    }
    building = false;
  };
  const flush = (): void => {
    if (building) return;
    building = true;
    void pump();
  };
  // Editors emit a burst of events per save; the debounce collapses it into one build.
  const queue = (changed: Iterable<string>): void => {
    for (const id of changed) dirty.add(id);
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
  };
  const isCode = (filename: string | null): boolean =>
    filename === null || filename === 'game.html' || filename.startsWith('src/') || filename.startsWith('src\\');
  const track = (directory: string, changed: Iterable<string>): void => {
    watch(directory, { recursive: true }, (_event, filename) => { if (isCode(filename)) queue(changed); })
      .on('error', error => console.warn(`Game watcher: ${errorMessage(error)}`));
  };
  for (const id of ids) track(resolve('games', id), [id]);
  track(resolve('packages/game-kit', 'src'), ids);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildGames();