import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, connectPlayer, createRoom, joinRoom, snapshot, type Registry, type RoomState } from '../workers/party/engine';
import definition, { type TowerActions, type TowerState } from '../games/tower-tumble/src/multiplayer';
import { parseMultiplayer, type Json } from '../packages/game-kit/src/multiplayer/protocol';
import { BLOCK_COUNT, POSE_STRIDE, decodePoses, encodePoses, initialPoses, towerLayout, towerTop } from '../games/tower-tumble/src/layout';

const multiplayer = parseMultiplayer({ modes: [{ id: 'classic', label: 'Classic Tower', minPlayers: 2, maxPlayers: 4, preset: 'live', spectators: true, lateJoin: 'spectate' }] });
const games: Registry = { 'tower-tumble': { id: 'tower-tumble', title: 'Tower Tumble', multiplayer, definition } };
const NOW = 1_000_000;

function fixture() {
  const room = createRoom('4242', NOW);
  const host = joinRoom(room, 'host-token', 'Host', NOW);
  connectPlayer(room, host, NOW);
  const guest = joinRoom(room, 'guest-token', 'Guest', NOW);
  connectPlayer(room, guest, NOW);
  const viewer = joinRoom(room, 'viewer-token', 'Viewer', NOW);
  connectPlayer(room, viewer, NOW);
  applyCommand(room, host, { type: 'select', gameId: 'tower-tumble', modeId: 'classic' }, games, NOW);
  for (const id of [host, guest]) {
    applyCommand(room, id, { type: 'seat', playing: true }, games, NOW);
    applyCommand(room, id, { type: 'ready', ready: true }, games, NOW);
  }
  applyCommand(room, host, { type: 'start' }, games, NOW + 1);
  return { room, host, guest, viewer };
}

function stateOf(room: RoomState): TowerState {
  return room.match!.state as unknown as TowerState;
}

let sequence = 0;

function act(room: RoomState, id: string, action: string, payload: Json, now = NOW + 100) {
  sequence++;
  return applyCommand(room, id, { type: 'action', matchId: room.match!.id, action, payload, sequence }, games, now);
}

test('the tower starts fully standing and only the active player may grab a legal block', () => {
  const { room, host, guest, viewer } = fixture();
  const state = stateOf(room);
  assert.equal(state.phase, 'playing');
  assert.equal(state.blocks.length, BLOCK_COUNT * POSE_STRIDE);
  assert.equal(towerTop(decodePoses(state.blocks).map((pose, index) => ({ index, level: towerLayout(state.seed)[index]!.level, moved: false, x: pose.x, y: pose.y, z: pose.z }))), 2.625);
  const turn = state.turn;
  const other = turn === host ? guest : host;
  assert.throws(() => act(room, other, 'grab', { block: 0 }), /turn/);
  assert.throws(() => act(room, viewer, 'grab', { block: 0 }), /Spectators/);
  assert.throws(() => act(room, turn, 'grab', { block: 51 }), /cannot be removed/);
  assert.throws(() => act(room, turn, 'grab', { block: 999 }), /Unknown block/);
  act(room, turn, 'grab', { block: 8 });
  assert.equal(stateOf(room).held, 8);
  assert.equal(stateOf(room).moved[8], true);
  assert.throws(() => act(room, turn, 'grab', { block: 10 }), /holding/);
});

test('snapshots are validated, and a placement on top advances the turn', () => {
  const { room, host, guest } = fixture();
  const turn = stateOf(room).turn;
  const other = turn === host ? guest : host;
  act(room, turn, 'grab', { block: 8 });
  assert.throws(() => act(room, turn, 'sync', { blocks: [1, 2, 3], maxSpeed: 0 }), /Invalid tower snapshot/);
  const poses = initialPoses(stateOf(room).seed);
  const previousTop = towerTop(poses.map((pose, index) => ({ index, level: towerLayout(stateOf(room).seed)[index]!.level, moved: false, x: pose.x, y: pose.y, z: pose.z })), 8);
  const lifted = encodePoses(poses.map((pose, index) => index === 8 ? { ...pose, x: 0.2, y: previousTop + 0.15, z: -0.15 } : pose));
  act(room, turn, 'sync', { blocks: lifted, maxSpeed: 0.02 });
  act(room, turn, 'release', { settled: true });
  const state = stateOf(room);
  assert.equal(state.phase, 'playing');
  assert.equal(state.placed, 1);
  assert.equal(state.lastPlaced, turn);
  assert.equal(state.turn, other);
  assert.equal(state.held, null);
});

test('a snapshot that shows a collapsed tower ends the round with the mover losing', () => {
  const { room, host, guest } = fixture();
  const turn = stateOf(room).turn;
  const other = turn === host ? guest : host;
  act(room, turn, 'grab', { block: 20 });
  const poses = initialPoses(stateOf(room).seed);
  const fallen = encodePoses(poses.map(pose => ({ ...pose, x: pose.x + 1.4, y: 0.2, z: pose.z + 0.9 })));
  act(room, turn, 'sync', { blocks: fallen, maxSpeed: 3 });
  act(room, turn, 'release', { settled: false });
  const state = stateOf(room);
  assert.equal(state.phase, 'finished');
  assert.equal(state.loser, turn);
  assert.deepEqual(state.winners, [other]);
});

test('the turn timer can be switched off and only lets an expired turn be skipped', () => {
  const { room, host, guest } = fixture();
  const turn = stateOf(room).turn;
  const other = turn === host ? guest : host;
  assert.throws(() => act(room, turn, 'timeout', null), /not up yet/);
  act(room, guest, 'timer', { enabled: false });
  assert.equal(stateOf(room).timerEnabled, false);
  assert.throws(() => act(room, turn, 'timeout', null), /no turn timer/);
  act(room, host, 'timer', { enabled: true });
  act(room, turn, 'timeout', null, NOW + 91_000);
  assert.equal(stateOf(room).turn, other);
});

test('spectators keep receiving the tower while a round runs', () => {
  const { room, viewer } = fixture();
  const view = snapshot(room, viewer, games);
  assert.equal(view.match?.status, 'playing');
  assert.equal((view.match?.state as TowerState).blocks.length, BLOCK_COUNT * POSE_STRIDE);
  assert.equal((view.match?.state as TowerState).seed, stateOf(room).seed);
  assert.deepEqual((view.match?.state as TowerActions extends never ? never : TowerState).order.length, 2);
});
