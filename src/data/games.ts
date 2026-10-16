import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export interface GameMetadata {
  id: string; title: string; description: string; genre: string; tags: string[];
  author: string; version: string; date: string; controls: string; cover?: string;
}
export const validId = (id: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
export function parseMetadata(value: unknown, directory: string): GameMetadata {
  if (!value || typeof value !== 'object') throw new Error(`${directory}: game.json must be an object`);
  const data = value as Record<string, unknown>;
  for (const field of ['id', 'title', 'description', 'genre', 'author', 'version', 'date', 'controls']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) throw new Error(`${directory}: missing or invalid ${field}`);
  }
  if (data.id !== directory || !validId(directory)) throw new Error(`${directory}: id must match the kebab-case directory`);
  if (!Array.isArray(data.tags) || !data.tags.every(tag => typeof tag === 'string')) throw new Error(`${directory}: tags must be strings`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date as string) || !Number.isFinite(Date.parse(data.date as string))) throw new Error(`${directory}: invalid date (YYYY-MM-DD)`);
  if (new Date(data.date as string).toISOString().slice(0, 10) !== data.date) throw new Error(`${directory}: date must be a real calendar date`);
  if (data.cover !== undefined && (typeof data.cover !== 'string' || !/^(?!.*\.\.)[a-zA-Z0-9_/-]+\.(png|jpg|jpeg|webp|svg)$/.test(data.cover))) throw new Error(`${directory}: cover must be a relative image path`);
  return data as unknown as GameMetadata;
}
export async function discoverGames(root = resolve('games')): Promise<GameMetadata[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
    try { return parseMetadata(JSON.parse(await readFile(resolve(root, entry.name, 'game.json'), 'utf8')), entry.name); }
    catch (error) { throw new Error(`Cannot discover game ${entry.name}: ${String(error)}`); }
  }));
}
