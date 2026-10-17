import { defineMultiplayer } from '@playground-exe/game-kit/multiplayer/server';
import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import {
  BLOCK_COUNT,
  POSE_STRIDE,
  TURN_MS,
  createRandom,
  encodePoses,
  initialPoses,
  isCollapsed,
  isRemovable,
  onTop,
  towerBlocksFromPoses,
  towerLayout,
  towerTop,
} from './layout';

export type TowerState = {
  phase: 'playing' | 'finished';
  turn: string;
  order: string[];
  seed: number;
  timerEnabled: boolean;
  turnStartedAt: number;
  moved: boolean[];
  held: number | null;
  previousTop: number;
  blocks: number[];
  maxSpeed: number;
  placed: number;
  placedBy: Record<string, number>;
  lastPlaced: string | null;
  loser: string | null;
  winners: string[];
};

export type TowerActions = {
  grab: { block: number };
  sync: { blocks: number[]; maxSpeed: number };
  release: { settled: boolean };
  timer: { enabled: boolean };
  timeout: null;
};

function shuffle(ids: readonly string[], seed: number): string[] {
  const random = createRandom(seed);
  const order = [...ids];
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return order;
}

function nextTurn(state: TowerState, playerIds: readonly string[]): string {
  const active = state.order.filter(id => playerIds.includes(id));
  const index = active.indexOf(state.turn);
  return active[(index + 1) % active.length] ?? active[0] ?? '';
}

function blocksOf(state: TowerState) {
  return towerBlocksFromPoses(towerLayout(state.seed), state.blocks, state.moved);
}

function validSnapshot(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== BLOCK_COUNT * POSE_STRIDE) return false;
  return value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 30);
}

export default defineMultiplayer({
  setup({ playerIds, seed, now }) {
    const order = shuffle(playerIds, seed);
    const blocks = encodePoses(initialPoses(seed));
    return {
      phase: 'playing',
      state: {
        phase: 'playing',
        turn: order[0]!,
        order,
        seed,
        timerEnabled: true,
        turnStartedAt: now,
        moved: new Array(BLOCK_COUNT).fill(false),
        held: null,
        previousTop: towerTop(towerBlocksFromPoses(towerLayout(seed), blocks, [])),
        blocks,
        maxSpeed: 0,
        placed: 0,
        placedBy: Object.fromEntries(order.map(id => [id, 0])),
        lastPlaced: null,
        loser: null,
        winners: [],
      } satisfies TowerState,
    };
  },
  action(raw, action, payload, { playerId, playerIds, now }) {
    const state = structuredClone(raw) as TowerState;
    const settled = state.maxSpeed < 0.5;
    switch (action) {
      case 'grab': {
        if (state.phase !== 'playing') throw new Error('This round is over.');
        if (state.turn !== playerId) throw new Error('Wait for your turn.');
        if (state.held !== null) throw new Error('Let go of the block you are holding.');
        if (!settled) throw new Error('Wait for the tower to stop moving.');
        const block = (payload as TowerActions['grab'])?.block;
        if (!Number.isInteger(block) || block < 0 || block >= BLOCK_COUNT) throw new Error('Unknown block.');
        const blocks = blocksOf(state);
        if (!isRemovable(blocks, block)) throw new Error('That block cannot be removed.');
        state.held = block;
        state.moved[block] = true;
        state.previousTop = towerTop(blocks, block);
        return { state };
      }
      case 'sync': {
        const snapshot = payload as TowerActions['sync'];
        if (state.phase !== 'playing') throw new Error('This round is over.');
        if (state.turn !== playerId) throw new Error('Not your turn to move blocks.');
        if (!validSnapshot(snapshot?.blocks)) throw new Error('Invalid tower snapshot.');
        if (typeof snapshot.maxSpeed !== 'number' || !Number.isFinite(snapshot.maxSpeed) || snapshot.maxSpeed < 0 || snapshot.maxSpeed > 200) throw new Error('Invalid snapshot speed.');
        state.blocks = snapshot.blocks;
        state.maxSpeed = snapshot.maxSpeed;
        return { state };
      }
      case 'release': {
        if (state.phase !== 'playing') throw new Error('This round is over.');
        if (state.turn !== playerId) throw new Error('Not your turn.');
        if (state.held === null) throw new Error('You are not holding a block.');
        const held = state.held;
        state.held = null;
        const blocks = blocksOf(state);
        if (isCollapsed(blocks)) {
          state.phase = 'finished';
          state.loser = playerId;
          state.winners = playerIds.filter(id => id !== playerId);
          return { state, finished: true, phase: 'results' };
        }
        if ((payload as TowerActions['release'])?.settled && onTop(blocks[held]!, state.previousTop)) {
          state.placed++;
          state.placedBy[playerId] = (state.placedBy[playerId] ?? 0) + 1;
          state.lastPlaced = playerId;
        }
        state.turn = nextTurn(state, playerIds);
        state.turnStartedAt = now;
        state.maxSpeed = 0;
        return { state };
      }
      case 'timer': {
        if (state.phase !== 'playing') throw new Error('This round is over.');
        if (!playerIds.includes(playerId)) throw new Error('Only players in the round can change the timer.');
        const enabled = (payload as TowerActions['timer'])?.enabled;
        if (typeof enabled !== 'boolean') throw new Error('Invalid timer setting.');
        state.timerEnabled = enabled;
        return { state };
      }
      case 'timeout': {
        if (state.phase !== 'playing') throw new Error('This round is over.');
        if (!state.timerEnabled) throw new Error('There is no turn timer.');
        if (now - state.turnStartedAt < TURN_MS) throw new Error('Time is not up yet.');
        state.turn = nextTurn(state, playerIds);
        state.turnStartedAt = now;
        state.held = null;
        state.maxSpeed = 0;
        return { state };
      }
      default:
        throw new Error('Unknown game action.');
    }
  },
  playersChanged(raw, { playerIds, now }) {
    const state = structuredClone(raw) as TowerState;
    if (state.phase === 'finished') return { state };
    const active = state.order.filter(id => playerIds.includes(id));
    if (!active.length) return { state, finished: true, phase: 'results' };
    if (!playerIds.includes(state.turn)) {
      state.turn = active[0]!;
      state.turnStartedAt = now;
    }
    state.winners = state.winners.filter(id => playerIds.includes(id));
    return { state };
  },
  view(raw): Json {
    return raw;
  },
});
