export const WIDTH = 960, HEIGHT = 540;
export const COLORS = ['#58eddf', '#ff668d', '#ffd36d', '#a799ff', '#8bf18d', '#ff9d62', '#74baff', '#f693ed'];
export type Control = { x: number; y: number; aim: number; fire: boolean };
export type Tank = { id: string; x: number; y: number; aim: number; alive: boolean; ammo: number; reload: number; shotAt: number; inputAt: number; input: Control; color: string };
export type Bullet = { id: number; owner: string; x: number; y: number; vx: number; vy: number; bounces: number; age: number; color: string };
export type Wall = { x: number; y: number; w: number; h: number; angle: number };
const wall = (x: number, y: number, w: number, h: number, angle = 0): Wall => ({ x, y, w, h, angle });
export const MAPS = [
  { name: 'The Box', walls: [wall(300, 170, 120, 28), wall(660, 370, 120, 28), wall(300, 370, 28, 110), wall(660, 170, 28, 110), wall(480, 270, 90, 50)] },
  { name: 'Pinball', walls: [wall(280, 160, 140, 24, .65), wall(680, 160, 140, 24, -.65), wall(280, 380, 140, 24, -.65), wall(680, 380, 140, 24, .65), wall(480, 270, 110, 24, .8)] },
  { name: 'Crossfire', walls: [wall(350, 125, 26, 150), wall(610, 415, 26, 150), wall(260, 310, 170, 26), wall(700, 230, 170, 26), wall(480, 270, 30, 95)] },
];
export type ArenaState = { time: number; lastAt: number; phase: 'countdown' | 'battle' | 'results' | 'finished'; until: number; round: number; map: number; tanks: Tank[]; bullets: Bullet[]; scores: Record<string, number>; winner: string | null; nextBullet: number; practice: boolean; hits: number; feed: { victim: string; owner: string }[] };
const SPAWNS = [[90, 90], [870, 450], [870, 90], [90, 450], [480, 70], [480, 470], [80, 270], [880, 270]];
export function createArena(ids: string[], now: number, seed = 0, practice = false): ArenaState {
  const state: ArenaState = { time: 0, lastAt: now, phase: 'countdown', until: 3, round: 1, map: Math.abs(seed) % 3, tanks: [], bullets: [], scores: Object.fromEntries(ids.map(id => [id, 0])), winner: null, nextBullet: 0, practice, hits: 0, feed: [] };
  state.tanks = ids.map((id, index) => ({ id, x: SPAWNS[index]![0]!, y: SPAWNS[index]![1]!, aim: index % 2 ? Math.PI : 0, alive: true, ammo: 3, reload: 0, shotAt: -1, inputAt: 0, input: { x: 0, y: 0, aim: 0, fire: false }, color: COLORS[index % 8]! }));
  return state;
}
export function contact(x: number, y: number, radius: number, obstacle: Wall): { x: number; y: number; depth: number } | null {
  const c = Math.cos(obstacle.angle), s = Math.sin(obstacle.angle);
  const lx = (x - obstacle.x) * c + (y - obstacle.y) * s, ly = -(x - obstacle.x) * s + (y - obstacle.y) * c;
  let dx = lx - Math.max(-obstacle.w / 2, Math.min(obstacle.w / 2, lx));
  let dy = ly - Math.max(-obstacle.h / 2, Math.min(obstacle.h / 2, ly));
  let distance = Math.hypot(dx, dy);
  if (distance >= radius) return null;
  if (!distance) {
    if (obstacle.w / 2 - Math.abs(lx) < obstacle.h / 2 - Math.abs(ly)) { dx = lx >= 0 ? 1 : -1; dy = 0; distance = -(obstacle.w / 2 - Math.abs(lx)); }
    else { dx = 0; dy = ly >= 0 ? 1 : -1; distance = -(obstacle.h / 2 - Math.abs(ly)); }
  } else { dx /= distance; dy /= distance; }
  return { x: dx * c - dy * s, y: dx * s + dy * c, depth: radius - distance };
}
export function advance(state: ArenaState, now: number) {
  let remaining = Math.min(2, Math.max(0, (now - state.lastAt) / 1000));
  state.lastAt = now;
  while (remaining > .000001 && state.phase !== 'finished') {
    const dt = Math.min(1 / 120, remaining); remaining -= dt; state.time += dt; step(state, dt);
  }
}
export function moveTank(tank: Tank, input: Control, tanks: Tank[], map: number, dt: number) {
  const oldX = tank.x, oldY = tank.y;
  tank.x += input.x * 190 * dt; tank.y += input.y * 190 * dt;
  for (const obstacle of MAPS[map]!.walls) { const hit = contact(tank.x, tank.y, 15, obstacle); if (hit) { tank.x += hit.x * hit.depth; tank.y += hit.y * hit.depth; } }
  tank.x = Math.max(16, Math.min(WIDTH - 16, tank.x)); tank.y = Math.max(16, Math.min(HEIGHT - 16, tank.y));
  for (const other of tanks) {
    if (tank.id === other.id || !other.alive) continue;
    if (Math.hypot(tank.x - other.x, tank.y - other.y) < 30) { tank.x = oldX; tank.y = oldY; break; }
  }
}
function step(state: ArenaState, dt: number) {
  if (state.phase === 'countdown') {
    if (state.time >= state.until) { state.phase = 'battle'; state.until = state.time + 75; }
    return;
  }
  if (state.phase === 'results') {
    if (state.time < state.until) return;
    const ranking = Object.keys(state.scores).filter(id => state.tanks.some(tank => tank.id === id)).sort((a, b) => state.scores[b]! - state.scores[a]!);
    if (state.round >= 5 && (ranking.length < 2 || state.scores[ranking[0]!]! > state.scores[ranking[1]!]!)) { state.phase = 'finished'; state.winner = ranking[0] ?? null; return; }
    const next = createArena(state.tanks.map(tank => tank.id), state.lastAt, (state.map + 1) % 3);
    state.tanks = next.tanks; state.bullets = []; state.map = next.map; state.round++; state.phase = 'countdown'; state.until = state.time + 3; state.winner = null;
    return;
  }
  const walls = MAPS[state.map]!.walls;
  const inset = state.practice ? 0 : Math.min(270, Math.max(0, state.time - state.until) * 7);
  const eliminate = (tank: Tank, owner: string) => {
    tank.alive = false;
    state.feed = [{ victim: tank.id, owner }, ...state.feed].slice(0, 3);
  };
  for (const tank of state.tanks) {
    if (!tank.alive) continue;
    if (tank.reload && state.time >= tank.reload) { tank.ammo = 3; tank.reload = 0; }
    const input = state.time - tank.inputAt <= .6 ? tank.input : { x: 0, y: 0, aim: tank.aim, fire: false };
    tank.aim = input.aim;
    moveTank(tank, input, state.tanks, state.map, dt);
    if (tank.x < inset || tank.x > WIDTH - inset || tank.y < inset || tank.y > HEIGHT - inset) { eliminate(tank, 'arena'); continue; }
    if (input.fire && tank.ammo && !tank.reload && state.time - tank.shotAt >= .35) {
      const vx = Math.cos(tank.aim), vy = Math.sin(tank.aim);
      state.bullets.push({ id: state.nextBullet++, owner: tank.id, x: tank.x + vx * 23, y: tank.y + vy * 23, vx: vx * 500, vy: vy * 500, bounces: 0, age: 0, color: tank.color });
      tank.ammo--; tank.shotAt = state.time;
      if (!tank.ammo) tank.reload = state.time + 2;
    }
  }
  for (const bullet of state.bullets) {
    bullet.age += dt; bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt;
    if (bullet.x < 4 || bullet.x > WIDTH - 4) { bullet.vx *= -1; bullet.x = Math.max(4, Math.min(WIDTH - 4, bullet.x)); bullet.bounces++; }
    if (bullet.y < 4 || bullet.y > HEIGHT - 4) { bullet.vy *= -1; bullet.y = Math.max(4, Math.min(HEIGHT - 4, bullet.y)); bullet.bounces++; }
    for (const obstacle of walls) {
      const hit = contact(bullet.x, bullet.y, 4, obstacle);
      if (hit) {
        bullet.x += hit.x * hit.depth; bullet.y += hit.y * hit.depth;
        const dot = bullet.vx * hit.x + bullet.vy * hit.y;
        if (dot < 0) { bullet.vx -= 2 * dot * hit.x; bullet.vy -= 2 * dot * hit.y; bullet.bounces++; }
      }
    }
    if (bullet.bounces >= 6 || bullet.age >= 4) continue;
    for (const tank of state.tanks) {
      if (!tank.alive || (tank.id === bullet.owner && !bullet.bounces)) continue;
      if (Math.hypot(tank.x - bullet.x, tank.y - bullet.y) < 18) { eliminate(tank, bullet.owner); bullet.age = 4; break; }
    }
    if (state.practice && bullet.age < 4) {
      for (const [x, y] of [[480, 110], [790, 270], [480, 430]]) {
        if (Math.hypot(x! - bullet.x, y! - bullet.y) < 21) { state.hits++; bullet.age = 4; break; }
      }
    }
  }
  state.bullets = state.bullets.filter(bullet => bullet.age < 4 && bullet.bounces < 6);
  if (!state.practice) {
    const alive = state.tanks.filter(tank => tank.alive);
    if (alive.length <= 1) {
      state.winner = alive[0]?.id ?? null;
      if (state.winner) state.scores[state.winner] = (state.scores[state.winner] ?? 0) + 1;
      state.phase = 'results'; state.until = state.time + 4;
    }
  }
}
