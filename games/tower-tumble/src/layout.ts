export const BLOCK_LENGTH = 0.75;
export const BLOCK_HEIGHT = 0.15;
export const BLOCK_WIDTH = 0.25;
export const LEVEL_COUNT = 18;
export const BLOCKS_PER_LEVEL = 3;
export const BLOCK_COUNT = LEVEL_COUNT * BLOCKS_PER_LEVEL;
export const TABLE_SIZE = 10;
export const CARRY_LIMIT = 0.55;
export const EXTRACT_LIMIT = 0.62;
export const TURN_MS = 90_000;
export const INITIAL_TOP = (LEVEL_COUNT - 0.5) * BLOCK_HEIGHT;

export interface BlockPlacement {
  index: number;
  level: number;
  slot: number;
  axis: 'x' | 'z';
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface TowerBlock {
  index: number;
  level: number;
  moved: boolean;
  x: number;
  y: number;
  z: number;
}

export interface BlockPose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export const POSE_STRIDE = 7;

export function fromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export function wrapAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function roundPose(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function encodePoses(poses: readonly BlockPose[]): number[] {
  const encoded: number[] = [];
  for (const pose of poses) {
    encoded.push(roundPose(pose.x), roundPose(pose.y), roundPose(pose.z), roundPose(pose.qx, 4), roundPose(pose.qy, 4), roundPose(pose.qz, 4), roundPose(pose.qw, 4));
  }
  return encoded;
}

export function decodePoses(encoded: readonly number[]): BlockPose[] {
  const poses: BlockPose[] = [];
  for (let offset = 0; offset + POSE_STRIDE <= encoded.length; offset += POSE_STRIDE) {
    poses.push({
      x: encoded[offset]!, y: encoded[offset + 1]!, z: encoded[offset + 2]!,
      qx: encoded[offset + 3]!, qy: encoded[offset + 4]!, qz: encoded[offset + 5]!, qw: encoded[offset + 6]!,
    });
  }
  return poses;
}

export function initialPoses(seed: number): BlockPose[] {
  return towerLayout(seed).map(placement => {
    const rotation = fromYaw(placement.yaw);
    return { x: placement.x, y: placement.y, z: placement.z, qx: rotation.x, qy: rotation.y, qz: rotation.z, qw: rotation.w };
  });
}

export function towerBlocksFromPoses(placements: readonly BlockPlacement[], encoded: readonly number[], moved: readonly boolean[]): TowerBlock[] {
  const poses = decodePoses(encoded);
  return placements.map((placement, index) => {
    const pose = poses[index] ?? { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    return { index, level: placement.level, moved: moved[index] ?? false, x: pose.x, y: pose.y, z: pose.z };
  });
}

export function createRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function towerLayout(seed: number): BlockPlacement[] {
  const random = createRandom(seed);
  const placements: BlockPlacement[] = [];
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const alongX = level % 2 === 0;
    for (let slot = 0; slot < BLOCKS_PER_LEVEL; slot++) {
      const offset = (slot - 1) * BLOCK_WIDTH;
      const nudge = (random() - 0.5) * 0.0008;
      const turn = (random() - 0.5) * 0.002;
      placements.push({
        index: placements.length,
        level,
        slot,
        axis: alongX ? 'x' : 'z',
        x: alongX ? nudge : offset + nudge,
        y: level * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
        z: alongX ? offset + nudge : nudge,
        yaw: (alongX ? 0 : Math.PI / 2) + turn,
      });
    }
  }
  return placements;
}

export function highestCompleteLevel(blocks: readonly TowerBlock[]): number {
  for (let level = LEVEL_COUNT - 1; level >= 0; level--) {
    if (blocks.filter(block => block.level === level && !block.moved).length === BLOCKS_PER_LEVEL) return level;
  }
  return -1;
}

export function isRemovable(blocks: readonly TowerBlock[], index: number): boolean {
  const block = blocks[index];
  if (!block || block.moved) return false;
  const top = highestCompleteLevel(blocks);
  return top < 0 ? block.level < LEVEL_COUNT - 1 : block.level < top;
}

export function towerTop(blocks: readonly TowerBlock[], exclude = -1): number {
  let top = 0;
  for (const block of blocks) if (block.index !== exclude) top = Math.max(top, block.y);
  return top;
}

export function isCollapsed(blocks: readonly TowerBlock[], initialTop = INITIAL_TOP, exclude = -1): boolean {
  let top = 0;
  let scattered = 0;
  for (const block of blocks) {
    if (block.index !== exclude) top = Math.max(top, block.y);
    if (block.y < 0.5 && Math.hypot(block.x, block.z) > 0.85) scattered++;
  }
  return top < initialTop * 0.62 || scattered >= 14;
}

export function topAxis(blocks: readonly TowerBlock[], exclude = -1): 'x' | 'z' {
  let top = -Infinity;
  let axis: 'x' | 'z' = 'x';
  for (const block of blocks) {
    if (block.index === exclude) continue;
    if (block.y > top) { top = block.y; axis = block.level % 2 === 0 ? 'x' : 'z'; }
  }
  return axis;
}

export function onTop(block: TowerBlock, previousTop: number): boolean {
  return block.y > previousTop - BLOCK_HEIGHT * 0.25 && Math.abs(block.x) < 0.55 && Math.abs(block.z) < 0.55;
}
