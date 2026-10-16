import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMultiplayer } from '../packages/game-kit/src/multiplayer/client';
import { PARTY_CHANNEL, type MultiplayerUpdate } from '../packages/game-kit/src/multiplayer/protocol';

test('game helpers scope messages, batch inputs, reject spectator/disconnected play and clean up', async () => {
  const originals = ['window', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const events = new EventTarget(); const messages: Record<string, unknown>[] = [];
  const parent = { postMessage(message: Record<string, unknown>) { messages.push(message); } };
  const origin = 'https://playground.example';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(events, { parent }) });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } });
  const session = createMultiplayer('test-game');
  const update: MultiplayerUpdate = {
    connected: true, playerId: 'me', party: { code: '0042', hostId: 'me', nextSequence: 0,
      players: [{ id: 'me', nickname: 'Me', role: 'player', ready: true, connected: true }],
      selection: { gameId: 'test-game', modeId: 'live' },
      match: { id: 'match-1', gameId: 'test-game', modeId: 'live', preset: 'live', status: 'playing', phase: 'shared', revision: 0, state: { score: 0 }, playerIds: ['me'], startedAt: 1000 },
    },
  };
  const emit = (payload: MultiplayerUpdate, source: unknown = parent, eventOrigin = origin) => {
    const event = new Event('message'); Object.assign(event, { source, origin: eventOrigin, data: { channel: PARTY_CHANNEL, type: 'update', update: payload } }); events.dispatchEvent(event);
  };
  try {
    assert.equal(messages[0]?.type, 'subscribe');
    assert.equal(session.send('move', 1), false);
    assert.equal(session.command({ type: 'ready', ready: true }), false);
    emit(update, {}); emit(update, parent, 'https://other.example');
    assert.equal(session.current.match, null);
    emit(update);
    assert.equal(session.command({ type: 'mode', modeId: 'live' }), true);
    assert.deepEqual(messages.find(message => message.type === 'menu'), { channel: PARTY_CHANNEL, gameId: 'test-game', type: 'menu', command: { type: 'mode', modeId: 'live' } });
    emit({ ...update, party: { ...update.party!, selection: { gameId: 'another-game', modeId: 'live' } } });
    assert.equal(session.command({ type: 'browse' }), false);
    emit(update);
    let renders = 0; session.onState(() => { renders++; });
    assert.equal(session.send('move', 1), true); assert.equal(session.send('move', -1), true);
    assert.equal(messages.filter(message => message.type === 'actions').length, 0);
    await new Promise(resolve => setTimeout(resolve, 130));
    const actions = messages.find(message => message.type === 'actions');
    assert.equal((actions?.commands as unknown[])?.length, 2);
    emit({ ...update, connected: false }); assert.equal(session.send('move', 1), false);
    emit({ ...update, playerId: 'watcher' }); assert.equal(session.send('move', 1), false);
    emit({ ...update, playerId: 'watcher', party: { ...update.party!, match: { ...update.party!.match!, state: null } } });
    assert.equal(session.current.match, null);
    const before = renders; session.destroy(); emit(update);
    assert.equal(renders, before); assert.equal(session.send('move', 1), false);
    assert.equal(session.command({ type: 'start' }), false);
  } finally {
    session.destroy(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
