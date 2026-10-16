import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../packages/game-kit/src/index.ts';

test('lifecycle is ordered, single-start, host-scoped and releases listeners', async () => {
  const originals = ['window', 'document', 'location', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const events = new EventTarget(); const doc = Object.assign(new EventTarget(), { hidden: false });
  const messages: unknown[] = []; const parent = { postMessage: (message: unknown) => messages.push(message) };
  const win = Object.assign(events, { parent });
  const origin = 'https://arcade.test';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } });
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  const calls: string[] = [];
  const emit = (type: string, source: unknown = parent, eventOrigin = origin, muted = false) => {
    const event = new Event('message'); Object.assign(event, { data: { channel: 'personal-arcade', type, muted }, source, origin: eventOrigin }); events.dispatchEvent(event);
  };
  try {
    const game = createGame('test', { initialize() { calls.push('initialize'); }, start() { calls.push('start'); }, pause() { calls.push('pause'); }, resume() { calls.push('resume'); }, restart() { calls.push('restart'); }, destroy() { calls.push('destroy'); }, mute(value) { calls.push(`mute:${value}`); } });
    game.start(); assert.equal(game.state, 'new');
    await Promise.all([game.boot(), game.boot()]); assert.deepEqual(calls, ['initialize', 'start']);
    emit('pause', {}, origin); emit('pause', parent, 'https://other.test'); assert.equal(game.state, 'running');
    emit('pause'); assert.equal(game.state, 'paused'); emit('resume'); assert.equal(game.state, 'running');
    emit('mute', parent, origin, true); assert.equal(calls.at(-1), 'mute:true');
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(game.state, 'paused');
    emit('restart'); assert.equal(game.state, 'running');
    assert.equal(game.score(50), 50); assert.equal(game.score(10), 50); assert.ok(messages.length >= 3);
    game.destroy(); game.destroy(); emit('pause');
    assert.equal(game.state, 'destroyed'); assert.equal(calls.filter(call => call === 'destroy').length, 1); assert.equal(calls.at(-1), 'destroy');
    await assert.rejects(game.initialize(), /destroyed/);
  } finally { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
