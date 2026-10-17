import assert from 'node:assert/strict';
import test from 'node:test';
import { advance, createArena, contact, MAPS, type ArenaState } from '../games/ricochet-royale/src/simulation.ts';
import adapter from '../games/ricochet-royale/src/multiplayer.ts';
import type { GameContext } from '@playground-exe/game-kit/multiplayer/server';
import { createMovementPrediction } from '../games/ricochet-royale/src/prediction.ts';

function battle(practice = false) {
  const state = createArena(practice ? ['a'] : ['a', 'b'], 0, 0, practice);
  state.phase = 'battle'; state.until = 75;
  return state;
}
function run(state: ArenaState, seconds: number) {
  const end = state.lastAt + seconds * 1000;
  while (state.lastAt < end) advance(state, Math.min(end, state.lastAt + 100));
}
const context: GameContext = { playerId: 'a', playerIds: ['a', 'b'], now: 0, seed: 0, mode: { id: 'royale', label: 'Free for All', minPlayers: 2, maxPlayers: 8, preset: 'live', spectators: true } };

test('three shots exhaust the magazine, then reload restores three shots', () => {
  const state = battle(true), tank = state.tanks[0]!;
  tank.input.fire = true; tank.inputAt = 20;
  run(state, .8);
  assert.equal(tank.ammo, 0);
  assert.ok(tank.reload > state.time);
  tank.input.fire = false;
  run(state, 2);
  assert.equal(tank.ammo, 3);
  assert.equal(tank.reload, 0);
});

test('a returning bullet kills its owner and survives owner elimination', () => {
  const state = battle(true), tank = state.tanks[0]!;
  tank.x = 50; tank.y = 270;
  state.bullets.push({ id: 1, owner: 'a', x: 8, y: 270, vx: -500, vy: 0, bounces: 0, age: 0, color: tank.color });
  state.bullets.push({ id: 2, owner: 'a', x: 100, y: 100, vx: 500, vy: 0, bounces: 0, age: 0, color: tank.color });
  run(state, .2);
  assert.equal(tank.alive, false);
  assert.ok(state.bullets.some(bullet => bullet.id === 2));
});

test('angled obstacles reflect bullets and stop tanks', () => {
  const state = battle(true); state.map = 1;
  state.bullets.push({ id: 1, owner: 'a', x: 280, y: 110, vx: 0, vy: 500, bounces: 0, age: 0, color: '#fff' });
  run(state, .15);
  assert.ok(state.bullets[0]!.bounces > 0);
  assert.ok(Math.abs(state.bullets[0]!.vx) > 100);
  const hit = contact(280, 160, 15, MAPS[1]!.walls[0]!);
  assert.ok(hit && hit.depth > 0);
  const tank = state.tanks[0]!; tank.x = 280; tank.y = 110; tank.input = { x: 0, y: 1, aim: 0, fire: false }; tank.inputAt = 20;
  run(state, .5);
  assert.equal(contact(tank.x, tank.y, 14.9, MAPS[1]!.walls[0]!), null);
});

test('bullet lifetime and bounce limit remove shots', () => {
  const state = battle(true);
  state.bullets.push({ id: 1, owner: 'a', x: 100, y: 50, vx: 500, vy: 0, bounces: 5, age: 0, color: '#fff' });
  state.bullets.push({ id: 2, owner: 'a', x: 100, y: 60, vx: 500, vy: 0, bounces: 0, age: 3.99, color: '#fff' });
  run(state, 1.8);
  assert.equal(state.bullets.length, 0);
});

test('rounds award one point, rotate maps and finish after five with a unique leader', () => {
  const state = battle(); state.tanks[1]!.alive = false;
  run(state, .1);
  assert.equal(state.scores.a, 1); assert.equal(state.phase, 'results');
  run(state, 4.1);
  assert.equal(state.round, 2); assert.equal(state.map, 1); assert.equal(state.phase, 'countdown');
  state.round = 5; state.scores.a = 3; state.phase = 'results'; state.until = state.time;
  run(state, .1);
  assert.equal(state.phase, 'finished'); assert.equal(state.winner, 'a');
});

test('tied matches play another round and sudden death resolves idle battles', () => {
  const state = battle(); state.round = 5; state.phase = 'results'; state.until = 0;
  run(state, .1);
  assert.equal(state.round, 6); assert.equal(state.phase, 'countdown');
  state.phase = 'battle'; state.until = state.time;
  run(state, 15);
  assert.equal(state.phase, 'results');
});

test('server rejects forged inputs, normalizes movement and advances idle bullets on heartbeats', () => {
  const initial = battle();
  assert.throws(() => adapter.action(initial, 'kill', 'b', context));
  assert.throws(() => adapter.action(initial, 'input', { x: null, y: 0, aim: 0, fire: true }, context));
  let result = adapter.action(initial, 'input', { x: 100, y: 100, aim: 0, fire: true }, context);
  let state = result.state as ArenaState;
  assert.ok(Math.hypot(state.tanks[0]!.input.x, state.tanks[0]!.input.y) <= 1);
  result = adapter.action(state, 'input', { x: 0, y: 0, aim: 0, fire: false }, { ...context, now: 200 });
  state = result.state as ArenaState;
  const x = state.bullets[0]!.x;
  result = adapter.action(state, 'input', { x: 0, y: 0, aim: 0, fire: false }, { ...context, now: 400 });
  assert.ok((result.state as ArenaState).bullets[0]!.x > x);
  assert.equal(initial.bullets.length, 0);
});

test('eight players spawn outside obstacles and input expires after heartbeat loss', () => {
  for (let map = 0; map < 3; map++) {
    const state = createArena(Array.from({ length: 8 }, (_, i) => String(i)), 0, map);
    for (const tank of state.tanks) for (const obstacle of MAPS[map]!.walls) assert.equal(contact(tank.x, tank.y, 15, obstacle), null);
  }
  const state = battle(true), tank = state.tanks[0]!; tank.input.x = 1;
  run(state, .7); const x = tank.x;
  run(state, .5); assert.equal(tank.x, x);
});

test('local movement responds before snapshots, reconciles smoothly and stops when stale', () => {
  const state = battle(), original = structuredClone(state);
  const prediction = createMovementPrediction();
  const input = { x: 1, y: 0, aim: 0, fire: false };
  prediction.receive(state, 'a', 0, false);
  const first = prediction.sample(input, 16, true)!;
  assert.ok(first.x > state.tanks[0]!.x);
  const next = structuredClone(state); next.tanks[0]!.x += 1;
  prediction.receive(next, 'a', 16, true);
  assert.equal(prediction.sample(input, 16, true)!.x, first.x);
  let position = first;
  for (let now = 32; now <= 400; now += 16) position = prediction.sample(input, now, true)!;
  assert.deepEqual(prediction.sample(input, 600, true), position);
  assert.deepEqual(state, original);
  prediction.receive(next, 'a', 600, false);
  assert.equal(prediction.sample(input, 600, true)!.x, next.tanks[0]!.x);
  prediction.reset();
  assert.equal(prediction.sample(input, 616, true), null);
});

test('predicted movement obeys arena walls and cannot move a paused or eliminated tank', () => {
  const state = battle(), tank = state.tanks[0]!;
  tank.x = 17;
  const prediction = createMovementPrediction(), input = { x: -1, y: 0, aim: 0, fire: false };
  prediction.receive(state, 'a', 0, false);
  assert.equal(prediction.sample(input, 16, true)!.x, 16);
  assert.equal(prediction.sample({ ...input, x: 1 }, 32, false)!.x, 16);
  tank.alive = false;
  prediction.receive(state, 'a', 32, true);
  assert.equal(prediction.sample(input, 48, true)!.x, 17);
});
