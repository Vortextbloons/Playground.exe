import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitial } from '../games/snake-wars/src/sim.ts';
import { createMovementPrediction } from '../games/snake-wars/src/prediction.ts';

test('snake steering previews one step immediately without changing authoritative outcomes', () => {
  const state = createInitial(['a', 'b'], 1, 0), original = structuredClone(state);
  const prediction = createMovementPrediction();
  prediction.receive(state, 'a', 'up', 0, true);
  assert.deepEqual(prediction.sample(50)[0], { x: 6, y: 5.5 });
  assert.deepEqual(prediction.sample(100)[0], { x: 6, y: 5 });
  assert.deepEqual(prediction.sample(1000)[0], { x: 6, y: 5 });
  assert.deepEqual(state, original);
  const before = prediction.sample(50);
  prediction.receive(state, 'a', 'right', 50);
  assert.deepEqual(prediction.sample(50), before);
  assert.deepEqual(prediction.sample(150)[0], { x: 7, y: 6 });
});

test('snake prediction respects reversals, collisions, elimination and match resets', () => {
  const state = createInitial(['a', 'b'], 1, 0);
  const prediction = createMovementPrediction();
  prediction.receive(state, 'a', 'left', 0, true);
  assert.deepEqual(prediction.sample(100)[0], { x: 7, y: 6 });
  state.snakes[0]!.body = [6];
  prediction.receive(state, 'a', 'up', 100, true);
  assert.deepEqual(prediction.sample(200)[0], { x: 6, y: 0 });
  state.snakes[0]!.alive = false;
  prediction.receive(state, 'a', 'up', 200);
  assert.deepEqual(prediction.sample(216), []);
  prediction.reset();
  assert.deepEqual(prediction.sample(300), []);
});
