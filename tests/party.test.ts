import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, connectPlayer, disconnectPlayer, expireDisconnected, applyCommand, reconcileMatch, snapshot, parseCommand, type Registry, type RoomState } from '../workers/party/engine';
import definition from '../games/pocket-circuit/src/multiplayer';
import { parseMultiplayer, RECONNECT_GRACE_MS } from '../packages/game-kit/src/multiplayer/protocol';
const multiplayer = parseMultiplayer({ modes: [{ id: 'turns', label: 'Turns', minPlayers: 2, maxPlayers: 2, preset: 'turn-based', spectators: true }] });
const games: Registry = { circuit: { id: 'circuit', title: 'Circuit', multiplayer, definition }, alt: { id: 'alt', title: 'Alt', multiplayer, definition } };
function fixture() {
  const room = createRoom('0042', 1000);
  const host = joinRoom(room, 'host-token', 'Host', 1000); connectPlayer(room, host, 1000);
  const guest = joinRoom(room, 'guest-token', 'Guest', 1000); connectPlayer(room, guest, 1000);
  const viewer = joinRoom(room, 'viewer-token', 'Viewer', 1000); connectPlayer(room, viewer, 1000);
  return { room, host, guest, viewer };
}
function start(room: RoomState, host: string, guest: string) {
  applyCommand(room, host, { type: 'select', gameId: 'circuit', modeId: 'turns' }, games, 1001);
  for (const id of [host, guest]) { applyCommand(room, id, { type: 'seat', playing: true }, games, 1001); applyCommand(room, id, { type: 'ready', ready: true }, games, 1001); }
  applyCommand(room, host, { type: 'start' }, games, 1002);
}
test('four-digit codes retain leading zeroes; host controls, seats, and readiness are enforced', () => {
  const { room, host, guest, viewer } = fixture();
  assert.equal(room.code, '0042');
  assert.throws(() => applyCommand(room, guest, { type: 'select', gameId: 'circuit', modeId: 'turns' }, games, 1001), /host/);
  applyCommand(room, host, { type: 'select', gameId: 'circuit', modeId: 'turns' }, games, 1001);
  assert.throws(() => applyCommand(room, host, { type: 'start' }, games, 1001), /ready/);
  start(room, host, guest);
  assert.throws(() => applyCommand(room, viewer, { type: 'seat', playing: true }, games, 1003), /next round/);
  assert.equal(room.players.find(player => player.id === viewer)?.role, 'spectator');
  assert.equal(room.match?.playerIds.length, 2);
});
test('server rules validate turns, spectators, stale matches and duplicate actions; warm-up advances to shared play', () => {
  const { room, host, guest, viewer } = fixture(); start(room, host, guest);
  const act = (id: string, action: string, sequence: number, matchId = room.match!.id) => applyCommand(room, id, { type: 'action', matchId, action, payload: null, sequence }, games, 2000);
  assert.throws(() => act(viewer, 'warm', 0), /Spectators/);
  assert.throws(() => act(host, 'warm', 0, 'old-round'), /ended/);
  act(host, 'warm', 0); act(guest, 'warm', 0);
  assert.equal(room.match?.phase, 'shared');
  assert.equal(act(host, 'warm', 0), false);
  const turn = (room.match!.state as { turn: string }).turn;
  const other = turn === host ? guest : host;
  assert.throws(() => act(other, 'advance', 1), /turn/);
  act(turn, 'advance', 1);
  assert.equal(room.match?.revision, 3);
});

test('game menu keeps the selection for replay and changing games returns the party to selection', () => {
  const { room, host, guest } = fixture(); start(room, host, guest);
  assert.throws(() => applyCommand(room, guest, { type: 'browse' }, games, 1003), /host/);
  assert.equal(room.match?.status, 'playing');
  applyCommand(room, host, { type: 'return' }, games, 1004);
  assert.equal(room.match, null);
  assert.equal(room.selection?.gameId, 'circuit');
  assert.ok(room.players.every(player => !player.ready));
  start(room, host, guest);
  applyCommand(room, host, { type: 'select', gameId: 'alt', modeId: 'turns' }, games, 1005);
  assert.equal(room.selection?.gameId, 'alt');
  assert.equal(room.match, null);
  applyCommand(room, host, parseCommand({ type: 'browse' }), games, 1006);
  assert.equal(room.match, null);
  assert.equal(room.selection, null);
  assert.ok(room.players.every(player => !player.ready));
  assert.equal(room.players.length, 3);
});
test('readiness resets on mode changes and disconnect, reconnect retains identity, host transfers', () => {
  const { room, host, guest } = fixture();
  applyCommand(room, host, { type: 'select', gameId: 'circuit', modeId: 'turns' }, games, 1001);
  applyCommand(room, host, { type: 'seat', playing: true }, games, 1001);
  applyCommand(room, host, { type: 'ready', ready: true }, games, 1001);
  applyCommand(room, host, { type: 'select', gameId: 'circuit', modeId: 'turns' }, games, 1001);
  assert.equal(room.players.find(player => player.id === host)?.ready, false);
  disconnectPlayer(room, host, 2000, games);
  assert.equal(room.hostId, host);
  assert.equal(joinRoom(room, 'host-token', 'Host', 2001), host);
  connectPlayer(room, host, 2001);
  assert.equal(room.hostId, host);
  disconnectPlayer(room, host, 3000, games);
  assert.equal(expireDisconnected(room, 3000 + RECONNECT_GRACE_MS - 1), false);
  assert.equal(expireDisconnected(room, 3000 + RECONNECT_GRACE_MS), true);
  assert.ok(!room.credentials[host]);
  assert.equal(room.hostId, guest);
});
test('snapshots omit credentials and support private per-player views and disabled spectating', () => {
  const { room, host, guest, viewer } = fixture(); start(room, host, guest);
  const mine = snapshot(room, host, games);
  assert.ok(!('credentials' in mine));
  assert.deepEqual(Object.keys((mine.match!.state as { scores: object }).scores), [host]);
  assert.deepEqual((snapshot(room, viewer, games).match!.state as { scores: object }).scores, {});
  const noWatch: Registry = { circuit: { ...games.circuit!, multiplayer: { modes: [{ ...multiplayer.modes[0]!, spectators: false }] } } };
  assert.equal(snapshot(room, viewer, noWatch).match?.state, null);
});
test('malformed protocol and invalid capability declarations fail closed', () => {
  for (const value of [null, {}, { type: 'ready', ready: 'true' }, { type: 'action', matchId: 'a', action: 'move', payload: NaN, sequence: 0 }, { type: 'action', matchId: 'a', action: 'move', payload: 1, sequence: -1 }]) assert.throws(() => parseCommand(value));
  assert.throws(() => parseMultiplayer({ modes: [{ id: 'a', label: 'A', minPlayers: 2, maxPlayers: 1, preset: 'live' }] }), /limits/);
  assert.throws(() => parseMultiplayer({ modes: [{ id: 'a', label: 'A', minPlayers: 1, maxPlayers: 2, preset: 'unknown' }] }), /preset/);
});
test('full mode blocks extra seats and releasing a disconnected turn lets the round continue', () => {
  const { room, host, guest, viewer } = fixture();
  applyCommand(room, host, { type: 'select', gameId: 'circuit', modeId: 'turns' }, games, 1001);
  for (const id of [host, guest]) applyCommand(room, id, { type: 'seat', playing: true }, games, 1001);
  assert.throws(() => applyCommand(room, viewer, { type: 'seat', playing: true }, games, 1001), /taken/);
  for (const id of [host, guest]) applyCommand(room, id, { type: 'ready', ready: true }, games, 1001);
  applyCommand(room, host, { type: 'start' }, games, 1002);
  for (const id of [host, guest]) applyCommand(room, id, { type: 'action', action: 'warm', payload: null, sequence: 0, matchId: room.match!.id }, games, 1003);
  const departed = (room.match!.state as { turn: string }).turn;
  disconnectPlayer(room, departed, 2000, games);
  expireDisconnected(room, 2000 + RECONNECT_GRACE_MS);
  reconcileMatch(room, games, 2000 + RECONNECT_GRACE_MS);
  const remaining = departed === host ? guest : host;
  assert.equal((room.match!.state as { turn: string }).turn, remaining);
  assert.doesNotThrow(() => applyCommand(room, remaining, { type: 'action', action: 'advance', payload: null, sequence: 1, matchId: room.match!.id }, games, 70_000));
});
