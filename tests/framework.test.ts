import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverGames, parseMetadata, validId } from '../src/data/games.ts';
import { createStorage } from '../packages/game-kit/src/storage.ts';
import { isCommand } from '../packages/game-kit/src/bridge.ts';

const metadata = { id: 'test-game', title: 'Test', description: 'Test fixture', genre: 'Other', tags: [], author: 'Test', version: '1', date: '2026-10-16', controls: 'None' };
test('discovery excludes templates, validates metadata, and fails on missing manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'playground-test-'));
  try {
    await mkdir(join(root, '_template')); await mkdir(join(root, '.hidden'));
    assert.deepEqual(await discoverGames(root), []);
    await mkdir(join(root, 'test-game'));
    await assert.rejects(discoverGames(root), /Cannot discover game test-game/);
    await writeFile(join(root, 'test-game/game.json'), JSON.stringify(metadata));
    assert.deepEqual(await discoverGames(root), [metadata]);
    assert.throws(() => parseMetadata({ ...metadata, id: '../escape' }, 'test-game'), /id must match/);
    assert.throws(() => parseMetadata({ ...metadata, cover: '../escape.png' }, 'test-game'), /cover/);
    assert.throws(() => parseMetadata({ ...metadata, date: 'not-a-date' }, 'test-game'), /date/);
    assert.throws(() => parseMetadata({ ...metadata, date: '2026-02-31' }, 'test-game'), /calendar/);
    assert.equal(validId('../escape'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('storage isolates game scores and tolerates blocked or corrupt storage', () => {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  try {
    const a = createStorage('a'); const b = createStorage('b');
    assert.equal(a.highScore(20), 20); assert.equal(a.highScore(10), 20); assert.equal(b.highScore(5), 5);
    values.set('playground-exe:game:a:high-score', '"bad"'); assert.equal(a.highScore(30), 30);
    values.set('playground-exe:game:a:settings', '{bad'); assert.deepEqual(a.get('settings', {}), {});
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(a.highScore(9), 9); assert.equal(a.set('x', 2), false);
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
test('bridge accepts only known commands and typed mute payloads', () => {
  assert.equal(isCommand({ channel: 'playground-exe', type: 'pause' }), true);
  assert.equal(isCommand({ channel: 'playground-exe', type: 'mute', muted: true }), true);
  for (const input of [null, {}, { channel: 'other', type: 'pause' }, { channel: 'playground-exe', type: 'mute', muted: 'yes' }, { channel: 'playground-exe', type: 'destroy' }]) assert.equal(isCommand(input), false);
});
