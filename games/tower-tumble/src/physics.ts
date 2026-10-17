import RAPIER from '@dimforge/rapier3d-compat';
import {
  BLOCK_HEIGHT,
  BLOCK_LENGTH,
  BLOCK_WIDTH,
  CARRY_LIMIT,
  EXTRACT_LIMIT,
  LEVEL_COUNT,
  TABLE_SIZE,
  decodePoses,
  encodePoses,
  fromYaw,
  wrapAngle,
  yawOf,
  towerLayout,
  type BlockPlacement,
  type BlockPose,
  type TowerBlock,
} from './layout';

export type { BlockPose };

export const STEP = 1 / 60;
export const CARRY_HEIGHT = BLOCK_HEIGHT * 2.2;
const SIDE_FRICTION = 5.8;
const PULL_MARGIN = 2.6;
const CARRY = { stiffness: 110, damping: 26, force: 26 };
const HOLD = { stiffness: 400, damping: 40, force: 24 };
const YAW = { stiffness: 3.5, damping: 0.8, torque: 2.5 };

function clampForce(value: number, limit: number): number {
  return Math.min(Math.max(value, -limit), limit);
}

export interface Tower {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  blockOfCollider: Map<number, number>;
  placements: BlockPlacement[];
}

export interface GripInput {
  distance: number;
  x: number;
  z: number;
}

export interface Grip {
  index: number;
  pullX: number;
  pullZ: number;
  originX: number;
  originY: number;
  originZ: number;
  clear: number;
  level: number;
  phase: 'extract' | 'carry';
  input: GripInput;
  yaw: number;
  strain: number;
}

export async function initRapier(): Promise<void> {
  await RAPIER.init();
}

export function createTower(seed: number): Tower {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.integrationParameters.numSolverIterations = 8;
  world.integrationParameters.contact_natural_frequency = 90;
  const placements = towerLayout(seed);
  const table = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.25, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(TABLE_SIZE / 2, 0.25, TABLE_SIZE / 2)
      .setFriction(0.85).setRestitution(0.02).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    table,
  );
  const bodies: RAPIER.RigidBody[] = [];
  const colliders: RAPIER.Collider[] = [];
  const blockOfCollider = new Map<number, number>();
  for (const placement of placements) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(placement.x, placement.y, placement.z)
        .setRotation(fromYaw(placement.yaw))
        .setLinearDamping(0.06)
        .setAngularDamping(0.12),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(BLOCK_LENGTH / 2, BLOCK_HEIGHT / 2, BLOCK_WIDTH / 2)
        .setDensity(35).setFriction(0.45).setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    bodies.push(body);
    colliders.push(collider);
    blockOfCollider.set(collider.handle, placement.index);
  }
  return { world, events: new RAPIER.EventQueue(true), bodies, colliders, blockOfCollider, placements };
}

export function destroyTower(tower: Tower): void {
  tower.world.free();
}

export function readPoses(tower: Tower): BlockPose[] {
  return tower.bodies.map(body => {
    const p = body.translation();
    const q = body.rotation();
    return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  });
}

export function readBlocks(tower: Tower, moved: readonly boolean[]): TowerBlock[] {
  return tower.placements.map(placement => {
    const p = tower.bodies[placement.index]!.translation();
    return { index: placement.index, level: placement.level, moved: moved[placement.index] ?? false, x: p.x, y: p.y, z: p.z };
  });
}

export function encodeTower(tower: Tower): number[] {
  return encodePoses(readPoses(tower));
}

export function applyEncoded(tower: Tower, encoded: readonly number[]): void {
  const poses = decodePoses(encoded);
  poses.forEach((pose, index) => {
    const body = tower.bodies[index];
    if (!body) return;
    body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
    body.setRotation({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.resetForces(true);
    body.resetTorques(true);
  });
}

export function pick(tower: Tower, origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }): { index: number; x: number; y: number; z: number } | null {
  const hit = tower.world.castRay(new RAPIER.Ray(origin, direction), 30, true);
  if (!hit) return null;
  const index = tower.blockOfCollider.get(hit.collider.handle);
  if (index === undefined) return null;
  return { index, x: origin.x + direction.x * hit.timeOfImpact, y: origin.y + direction.y * hit.timeOfImpact, z: origin.z + direction.z * hit.timeOfImpact };
}

export function beginGrip(tower: Tower, index: number): Grip {
  const placement = tower.placements[index]!;
  const body = tower.bodies[index]!;
  const position = body.translation();
  const away = placement.slot === 0 ? -1 : 1;
  const pullX = placement.axis === 'z' ? away : 0;
  const pullZ = placement.axis === 'x' ? away : 0;
  const offset = Math.abs((placement.slot - 1) * BLOCK_WIDTH);
  body.setEnabledRotations(false, true, false, true);
  body.enableCcd(true);
  body.setAngularDamping(0.9);
  tower.colliders[index]!.setFriction(0.02);
  return {
    index,
    pullX,
    pullZ,
    originX: position.x,
    originY: position.y,
    originZ: position.z,
    clear: 0.5 - offset + 0.08,
    level: placement.level,
    phase: 'extract',
    input: { distance: 0, x: position.x, z: position.z },
    yaw: 0,
    strain: 0,
  };
}

export function gripTarget(grip: Grip, topY: number): { x: number; y: number; z: number } {
  if (grip.phase === 'extract') {
    const distance = Math.min(Math.max(grip.input.distance, 0), EXTRACT_LIMIT);
    return { x: grip.originX + grip.pullX * distance, y: grip.originY, z: grip.originZ + grip.pullZ * distance };
  }
  return {
    x: Math.min(Math.max(grip.input.x, -CARRY_LIMIT), CARRY_LIMIT),
    y: topY + CARRY_HEIGHT,
    z: Math.min(Math.max(grip.input.z, -CARRY_LIMIT), CARRY_LIMIT),
  };
}

export function applyGrip(tower: Tower, grip: Grip, topY: number, yaw: number): void {
  const body = tower.bodies[grip.index]!;
  const position = body.translation();
  let along = 0;
  if (grip.phase === 'extract') {
    along = (position.x - grip.originX) * grip.pullX + (position.z - grip.originZ) * grip.pullZ;
    const straining = grip.input.distance >= grip.clear && along < grip.clear;
    grip.strain = straining ? Math.min(grip.strain + STEP, 2) : Math.max(grip.strain - STEP * 3, 0);
    if (grip.input.distance >= grip.clear && along >= grip.clear) grip.phase = 'carry';
  }
  grip.yaw = yaw;
  const target = gripTarget(grip, topY);
  const velocity = body.linvel();
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  let fx: number;
  let fy: number;
  let fz: number;
  if (grip.phase === 'extract') {
    const friction = Math.max(SIDE_FRICTION * (LEVEL_COUNT - 1 - grip.level), 1);
    const cap = (friction * PULL_MARGIN + 8) * (1 + grip.strain * 1.6);
    const stiffness = cap / 0.3;
    const damping = cap / 0.6;
    const pullX = grip.pullX !== 0;
    fx = pullX ? clampForce(stiffness * dx - damping * velocity.x, cap) : clampForce(HOLD.stiffness * dx - HOLD.damping * velocity.x, HOLD.force);
    fz = pullX ? clampForce(HOLD.stiffness * dz - HOLD.damping * velocity.z, HOLD.force) : clampForce(stiffness * dz - damping * velocity.z, cap);
    fy = clampForce(HOLD.stiffness * dy - HOLD.damping * velocity.y, HOLD.force);
  } else {
    const lifted = Math.min(Math.max((position.y - (target.y - CARRY_HEIGHT * 0.5)) / (CARRY_HEIGHT * 0.5), 0), 1);
    const swing = CARRY.force * (0.25 + 0.75 * lifted);
    fx = clampForce(CARRY.stiffness * dx - CARRY.damping * velocity.x, swing);
    fz = clampForce(CARRY.stiffness * dz - CARRY.damping * velocity.z, swing);
    fy = clampForce(CARRY.stiffness * dy - CARRY.damping * velocity.y, CARRY.force);
  }
  body.resetForces(true);
  body.resetTorques(true);
  body.addForce({ x: fx, y: fy, z: fz }, true);
  if (grip.phase === 'carry') {
    const error = wrapAngle(grip.yaw - yawOf(body.rotation()));
    body.addTorque({ x: 0, y: Math.min(Math.max(YAW.stiffness * error - YAW.damping * body.angvel().y, -YAW.torque), YAW.torque), z: 0 }, true);
  }
}

export function releaseGrip(tower: Tower, grip: Grip): void {
  const body = tower.bodies[grip.index]!;
  tower.colliders[grip.index]!.setFriction(0.45);
  body.setEnabledRotations(true, true, true, true);
  body.setAngularDamping(0.12);
  body.resetForces(true);
  body.resetTorques(true);
}

export function collectImpacts(tower: Tower, previousSpeeds: Float32Array): number[] {
  const impacts: number[] = [];
  tower.events.drainCollisionEvents((first, second, started) => {
    if (!started) return;
    const a = tower.blockOfCollider.get(first);
    const b = tower.blockOfCollider.get(second);
    const speed = Math.max(a === undefined ? 0 : previousSpeeds[a]!, b === undefined ? 0 : previousSpeeds[b]!);
    if (speed > 0.22) impacts.push(speed);
  });
  return impacts;
}

export function stepTower(tower: Tower, previousSpeeds: Float32Array): void {
  for (let index = 0; index < tower.bodies.length; index++) {
    const velocity = tower.bodies[index]!.linvel();
    previousSpeeds[index] = Math.hypot(velocity.x, velocity.y, velocity.z);
  }
  tower.world.step(tower.events);
}

export function maxSpeed(tower: Tower): number {
  let speed = 0;
  for (const body of tower.bodies) {
    const velocity = body.linvel();
    speed = Math.max(speed, Math.hypot(velocity.x, velocity.y, velocity.z));
  }
  return speed;
}
