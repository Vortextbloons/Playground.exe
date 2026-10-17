import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer } from '@playground-exe/game-kit/multiplayer';
import { advance, createArena, MAPS, WIDTH, HEIGHT, type ArenaState, type Control } from './simulation';
import { createMovementPrediction } from './prediction';
import metadata from '../game.json';
import './style.css';

const root = document.querySelector<HTMLElement>('#game')!;
root.innerHTML = `<header><div><span class="eyebrow">Armored arena / three-shot combat</span><h1>Ricochet Royale<span>↗</span></h1><p>Three shots. Every wall is a weapon.</p></div><button id="fullscreen" aria-label="Enter fullscreen">⛶</button></header>
<div id="menu"></div><section class="cockpit"><div class="toolbar"><strong id="mode">Target practice</strong><span id="map-name"></span><button id="reset">Restart practice</button><button id="sound" aria-pressed="false">Sound off</button></div>
<div class="arena"><canvas width="960" height="540" aria-label="Tank battle arena. Move with WASD or arrow keys, aim with the mouse and hold click to fire." tabindex="0"></canvas><div id="announcement" role="status"></div></div>
<div class="dashboard"><span id="ammo"></span><strong id="clock"></strong><span id="score"></span></div><p id="status" role="status"></p><div id="standings"></div></section>
<div class="touch-controls"><div class="control"><div class="stick" id="move" role="group" aria-label="Movement touch stick"><i></i></div><span>Move</span></div><p>Drag the right stick<br>to aim & fire</p><div class="control"><div class="stick fire" id="aim" role="group" aria-label="Aim and fire touch stick"><i></i></div><span>Aim & fire</span></div></div>
<footer><span class="desktop-help">WASD / arrows to move · Mouse to aim · Hold click / Space to fire</span><span class="mobile-help">Two thumbs. Any direction. Landscape gives you a bigger arena.</span><span>Your own ricochets are lethal.</span></footer>`;
const canvas = root.querySelector('canvas')!;
const ctx = canvas.getContext('2d')!;
const label = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
function announce(id: string, message: string) { const element = label(id); if (element.textContent !== message) element.textContent = message; }
const reset = label('reset') as HTMLButtonElement;
const abort = new AbortController();
const options = { signal: abort.signal };
let local = createArena(['you'], performance.now(), 0, true);
let paused = false, frame = 0, previous: ArenaState | null = null, receivedAt = 0, reportedHits = 0;
const prediction = createMovementPrediction();
let snapshotInterval = 100, matchId = '';
let soundEnabled = false, muted = false, audio: AudioContext | null = null;
let seen = local, lastShot = 0, dead = new Set<string>();
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
let bulletHistory = new Map<number, number>();
let effectTime = 0, effectRound = 1, lastTick = '', lastHits = 0;
let reloading = new Set<string>();
const sparks: { x: number; y: number; at: number; color: string }[] = [];
const keys = new Set<string>();
const input: Control = { x: 0, y: 0, aim: 0, fire: false };
const movement = { x: 0, y: 0 };
let mouseFire = false, touchFire = false;
const bursts: { x: number; y: number; color: string; at: number }[] = [];
const game = createGame('ricochet-royale', {
  initialize() {}, start() { frame = requestAnimationFrame(draw); },
  pause() { paused = true; clearInput(); },
  resume() { paused = false; local.lastAt = performance.now(); },
  restart() { if (!session.current.party) restart(); },
  mute(value) { muted = value; },
  destroy() { cancelAnimationFrame(frame); clearInterval(heartbeat); abort.abort(); partyMenu.destroy(); void audio?.close(); },
});
const session = game.multiplayer<ArenaState, { input: Control }>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));
label('menu').append(partyMenu.element);
function restart() {
  local = createArena(['you'], performance.now(), (local.map + 1) % 3, true);
  clearInput(); bursts.length = 0; reportedHits = 0;
}
reset.addEventListener('click', restart, options);
label('fullscreen').addEventListener('click', () => game.requestFullscreen(), options);
label('sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  if (soundEnabled) { audio ??= new AudioContext(); void audio.resume(); }
  label('sound').textContent = soundEnabled ? 'Sound on' : 'Sound off';
  label('sound').setAttribute('aria-pressed', String(soundEnabled));
}, options);
function tone(frequency: number, duration: number, end = 45, type: OscillatorType = 'triangle') {
  if (!audio || !soundEnabled || muted || paused) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(end, audio.currentTime + duration);
  gain.gain.setValueAtTime(.06, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
}
function clearInput() {
  keys.clear(); movement.x = movement.y = 0; mouseFire = touchFire = false;
  input.x = input.y = 0; input.fire = false;
  root.querySelectorAll<HTMLElement>('.stick i').forEach(knob => { knob.style.transform = ''; });
  send();
}
function controls() {
  const x = movement.x + Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const y = movement.y + Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const length = Math.max(1, Math.hypot(x, y)); input.x = x / length; input.y = y / length;
  input.fire = mouseFire || touchFire || keys.has('Space');
}
function send() { controls(); session.send('input', paused ? { x: 0, y: 0, aim: input.aim, fire: false } : { ...input }); }
const heartbeat = setInterval(send, 200);
window.addEventListener('blur', clearInput, options);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); }, options);
for (const kind of ['keydown', 'keyup'] as const) window.addEventListener(kind, event => {
  if (event.target instanceof Element && event.target.closest('button, input, select, .multiplayer-menu')) return;
  if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'].includes(event.code)) return;
  event.preventDefault();
  if (kind === 'keydown') keys.add(event.code); else keys.delete(event.code);
  if (!event.repeat) send();
}, options);
canvas.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const box = canvas.getBoundingClientRect();
  const state = session.current.match?.state ?? local;
  const tank = state.tanks.find(tank => tank.id === (session.current.playerId ?? 'you'));
  if (tank) input.aim = Math.atan2((event.clientY - box.top) * HEIGHT / box.height - tank.y, (event.clientX - box.left) * WIDTH / box.width - tank.x);
}, options);
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' || event.button !== 0) return;
  canvas.focus(); canvas.setPointerCapture(event.pointerId); mouseFire = true; send();
}, options);
for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(kind, () => { mouseFire = false; send(); }, options);
canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
for (const id of ['move', 'aim']) {
  const stick = label(id), knob = stick.querySelector<HTMLElement>('i')!;
  let pointer: number | null = null;
  const update = (event: PointerEvent) => {
    const box = stick.getBoundingClientRect(), radius = box.width * .35;
    let x = (event.clientX - box.left - box.width / 2) / radius, y = (event.clientY - box.top - box.height / 2) / radius;
    const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
    knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    if (id === 'move') { movement.x = x; movement.y = y; }
    else { touchFire = Math.hypot(x, y) > .2; if (touchFire) input.aim = Math.atan2(y, x); }
  };
  stick.addEventListener('pointerdown', event => { if (pointer !== null) return; pointer = event.pointerId; stick.setPointerCapture(pointer); update(event); send(); }, options);
  stick.addEventListener('pointermove', event => { if (pointer === event.pointerId) update(event); }, options);
  for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) stick.addEventListener(kind, event => {
    if (event.pointerId !== pointer) return; pointer = null; knob.style.transform = '';
    if (id === 'move') movement.x = movement.y = 0; else touchFire = false;
    send();
  }, options);
}
session.onState((state, view) => {
  if (view.match?.id === matchId && state.lastAt === seen.lastAt && state.phase === seen.phase) return;
  const now = performance.now();
  const continuous = view.match?.id === matchId && !seen.practice && state.round === seen.round && state.phase === 'battle' && seen.phase === 'battle';
  snapshotInterval = continuous ? Math.max(50, Math.min(250, state.lastAt - seen.lastAt)) : 100;
  previous = continuous ? seen : null;
  prediction.receive(state, view.playerId, now, continuous);
  matchId = view.match?.id ?? '';
  receivedAt = now; seen = state;
});
session.subscribe(() => { reset.hidden = !!session.current.party; if (!session.current.match) { previous = null; prediction.reset(); matchId = ''; } });
let errorUntil = 0;
session.onError(message => { label('status').textContent = message; errorUntil = performance.now() + 4000; });
function name(id: string) { return id === 'you' ? 'You' : session.current.party?.players.find(player => player.id === id)?.nickname ?? 'Player'; }
function draw(now: number) {
  frame = requestAnimationFrame(draw);
  controls();
  if (!session.current.party && !paused) {
    local.tanks[0]!.input = { ...input }; local.tanks[0]!.inputAt = local.time;
    advance(local, now);
    if (local.hits > reportedHits) { reportedHits = local.hits; game.score(local.hits); }
  } else local.lastAt = now;
  const state = session.current.match?.state ?? local;
  const ownId = session.current.playerId ?? 'you';
  const own = state.tanks.find(tank => tank.id === ownId);
  const waiting = !!session.current.party && !session.current.match;
  const connected = !session.current.party || session.current.connected;
  const predicted = prediction.sample(input, now, !paused && connected && session.current.isPlayer && session.current.match?.status === 'playing');
  if (state.time < effectTime || state.round !== effectRound) { bulletHistory.clear(); sparks.length = 0; bursts.length = 0; dead.clear(); lastShot = state.nextBullet; lastTick = ''; lastHits = state.hits; reloading.clear(); }
  effectTime = state.time; effectRound = state.round;
  const tick = state.phase === 'countdown' ? String(Math.ceil(state.until - state.time)) : state.phase;
  if (tick !== lastTick) {
    if (state.phase === 'countdown') tone(440, .09, 400, 'sine');
    else if (lastTick && state.phase === 'battle') tone(550, .25, 1100, 'sine');
    else if (state.phase === 'results' || state.phase === 'finished') tone(660, .4, 220, 'sine');
    lastTick = tick;
  }
  if (state.hits > lastHits) tone(740, .17, 1400, 'sine');
  lastHits = state.hits;
  for (const tank of state.tanks) if (tank.alive && reloading.has(tank.id) && !tank.reload) tone(450, .12, 950, 'sine');
  reloading = new Set(state.tanks.filter(tank => tank.reload).map(tank => tank.id));
  for (const bullet of state.bullets) {
    const bounces = bulletHistory.get(bullet.id);
    if (bounces !== undefined && bullet.bounces > bounces) {
      sparks.push({ x: bullet.x, y: bullet.y, at: now, color: '#ffca78' }); tone(1600, .08, 450, 'square');
    }
  }
  bulletHistory = new Map(state.bullets.map(bullet => [bullet.id, bullet.bounces]));
  if (state.nextBullet !== lastShot) { if (state.nextBullet > lastShot) tone(280, .07); lastShot = state.nextBullet; }
  for (const tank of state.tanks) {
    if (!tank.alive && !dead.has(tank.id)) { bursts.push({ x: tank.x, y: tank.y, color: tank.color, at: now }); tone(100, .3); }
  }
  dead = new Set(state.tanks.filter(tank => !tank.alive).map(tank => tank.id));
  const floor = ctx.createRadialGradient(480, 230, 20, 480, 270, 610);
  floor.addColorStop(0, '#2b4653'); floor.addColorStop(1, '#09141f');
  ctx.fillStyle = floor; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const reduced = motion.matches;
  ctx.save();
  if (!reduced && bursts.some(burst => now - burst.at < 180)) ctx.translate(Math.sin(now * .12) * 2, Math.cos(now * .09) * 2);
  ctx.strokeStyle = '#aac9d010'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WIDTH; x += 30) { ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); }
  for (let y = 0; y <= HEIGHT; y += 30) { ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); } ctx.stroke();
  ctx.strokeStyle = '#7ea6b644'; ctx.lineWidth = 2; ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);
  ctx.font = 'bold 72px Trebuchet MS'; ctx.textAlign = 'center'; ctx.fillStyle = '#c5e3e909'; ctx.fillText('RICOCHET', 480, 295);
  for (const wall of MAPS[state.map]!.walls) {
    ctx.save(); ctx.translate(wall.x, wall.y); ctx.rotate(wall.angle);
    ctx.fillStyle = '#02091099'; ctx.fillRect(-wall.w / 2 + 5, -wall.h / 2 + 7, wall.w, wall.h);
    const metal = ctx.createLinearGradient(0, -wall.h / 2, 0, wall.h / 2);
    metal.addColorStop(0, '#75939d'); metal.addColorStop(.2, '#425e6a'); metal.addColorStop(1, '#1b2d39');
    ctx.fillStyle = metal; ctx.strokeStyle = '#91bac2'; ctx.lineWidth = 1.5;
    ctx.fillRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h); ctx.strokeRect(-wall.w / 2, -wall.h / 2, wall.w, wall.h);
    ctx.fillStyle = '#ffca78'; ctx.fillRect(-wall.w / 2 + 5, -wall.h / 2 + 4, Math.min(25, wall.w - 10), 3);
    for (const side of [-1, 1]) { ctx.fillStyle = '#091923'; ctx.beginPath(); ctx.arc(side * (wall.w / 2 - 6), 0, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  if (state.practice) for (const [x, y] of [[480, 110], [790, 270], [480, 430]]) {
    ctx.save(); ctx.translate(x!, y!); ctx.rotate(reduced ? 0 : now * .0005);
    ctx.strokeStyle = '#ff839960'; ctx.lineWidth = 3;
    for (let n = 0; n < 4; n++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.arc(0, 0, 27, 0, .8); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#ff668d'; ctx.lineWidth = 2;
    for (const radius of [19, 10, 3]) { ctx.beginPath(); ctx.arc(x!, y!, radius, 0, Math.PI * 2); ctx.stroke(); }
  }
  const alpha = Math.min(1, (now - receivedAt) / snapshotInterval);
  for (const bullet of state.bullets) {
    const before = previous?.bullets.find(item => item.id === bullet.id);
    const x = before ? before.x + (bullet.x - before.x) * alpha : bullet.x, y = before ? before.y + (bullet.y - before.y) * alpha : bullet.y;
    ctx.strokeStyle = bullet.color; ctx.lineWidth = 3; ctx.globalAlpha = .35;
    ctx.beginPath(); ctx.moveTo(x - bullet.vx * .055, y - bullet.vy * .055); ctx.lineTo(x, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.shadowColor = bullet.color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  }
  for (const tank of state.tanks) {
    if (!tank.alive) continue;
    const before = previous?.tanks.find(item => item.id === tank.id);
    const position = tank.id === ownId && predicted && connected && !paused ? predicted : null;
    const x = position?.x ?? (before ? before.x + (tank.x - before.x) * alpha : tank.x), y = position?.y ?? (before ? before.y + (tank.y - before.y) * alpha : tank.y);
    ctx.save(); ctx.translate(x, y);
    if (tank.id === ownId) { ctx.strokeStyle = '#ffffff60'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke(); }
    const moving = Math.hypot(tank.input.x, tank.input.y) > .1;
    ctx.save(); ctx.rotate(moving ? Math.atan2(tank.input.y, tank.input.x) : tank.aim);
    ctx.shadowColor = '#000'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#091018'; ctx.fillRect(-17, -17, 34, 10); ctx.fillRect(-17, 7, 34, 10);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.fillStyle = '#6d858d';
    for (let tread = -14; tread < 15; tread += 5) { const offset = moving && !reduced ? (now * .035) % 5 : 0; ctx.fillRect(tread + offset, -15, 2, 6); ctx.fillRect(tread + offset, 9, 2, 6); }
    ctx.fillStyle = tank.color; ctx.fillRect(-13, -10, 26, 20); ctx.fillStyle = '#ffffff55'; ctx.fillRect(-10, -9, 19, 3); ctx.fillStyle = '#07162088'; ctx.fillRect(-10, 4, 19, 4); ctx.restore();
    ctx.rotate(tank.id === ownId && connected && !paused ? input.aim : tank.aim);
    ctx.fillStyle = tank.color; ctx.shadowBlur = 9; ctx.shadowColor = tank.color; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); const recoil = Math.max(0, 1 - (state.time - tank.shotAt) / .16);
    ctx.fillStyle = '#79939b'; ctx.fillRect(0, -4, 24 - recoil * 5, 8); ctx.fillStyle = '#d4edf0'; ctx.fillRect(19 - recoil * 5, -5, 5, 10);
    ctx.shadowBlur = 0; ctx.fillStyle = '#16333e'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    if (recoil > 0 && !reduced) { ctx.fillStyle = '#fff0b8'; ctx.beginPath(); ctx.moveTo(25, -6 * recoil); ctx.lineTo(25 + 22 * recoil, 0); ctx.lineTo(25, 6 * recoil); ctx.fill(); } ctx.restore();
    ctx.fillStyle = tank.color; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(name(tank.id), x, y + 35);
  }
  for (let index = sparks.length - 1; index >= 0; index--) {
    const spark = sparks[index]!, age = (now - spark.at) / 350;
    if (age >= 1) { sparks.splice(index, 1); continue; }
    ctx.globalAlpha = 1 - age; ctx.strokeStyle = spark.color; ctx.lineWidth = 2;
    for (let n = 0; n < 7; n++) { const angle = n * Math.PI * 2 / 7, distance = reduced ? 6 : age * 26; ctx.beginPath(); ctx.moveTo(spark.x + Math.cos(angle) * distance, spark.y + Math.sin(angle) * distance); ctx.lineTo(spark.x + Math.cos(angle) * (distance + 6), spark.y + Math.sin(angle) * (distance + 6)); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  for (let index = bursts.length - 1; index >= 0; index--) {
    const burst = bursts[index]!, age = (now - burst.at) / 650;
    if (age > 1) { bursts.splice(index, 1); continue; }
    ctx.globalAlpha = 1 - age; ctx.strokeStyle = burst.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(burst.x, burst.y, 8 + (reduced ? 0 : age * 45), 0, Math.PI * 2); ctx.stroke();
    for (let n = 0; n < 8; n++) { const angle = n * Math.PI / 4; ctx.fillStyle = burst.color; ctx.fillRect(burst.x + Math.cos(angle) * (reduced ? 8 : age * 55), burst.y + Math.sin(angle) * (reduced ? 8 : age * 55), 4, 4); }
    ctx.globalAlpha = 1;
  }
  const inset = state.practice ? 0 : Math.min(270, Math.max(0, state.time - state.until) * 7);
  if (state.phase === 'battle' && inset) {
    ctx.fillStyle = '#ff486842'; ctx.fillRect(0, 0, WIDTH, inset); ctx.fillRect(0, HEIGHT - inset, WIDTH, inset); ctx.fillRect(0, inset, inset, HEIGHT - inset * 2); ctx.fillRect(WIDTH - inset, inset, inset, HEIGHT - inset * 2);
    ctx.strokeStyle = '#ff668d'; ctx.strokeRect(inset, inset, WIDTH - inset * 2, HEIGHT - inset * 2);
  }
  ctx.restore();
  label('map-name').textContent = MAPS[state.map]!.name;
  label('mode').textContent = state.practice ? 'Target practice' : `Round ${state.round}${state.round > 5 ? ' · Tiebreak' : ' / 5'}`;
  label('ammo').textContent = own?.alive ? own.reload ? `Reloading ${Math.max(0, own.reload - state.time).toFixed(1)}s` : `${'● '.repeat(own.ammo)}${'○ '.repeat(3 - own.ammo)}` : 'Spectating';
  label('clock').textContent = state.practice ? `${state.hits} targets hit` : state.phase === 'battle' ? state.time > state.until ? 'Sudden death' : `${Math.ceil(state.until - state.time)}s` : '';
  label('score').textContent = state.practice ? 'Solo' : `${state.tanks.filter(tank => tank.alive).length} / ${state.tanks.length} alive`;
  announce('announcement', waiting ? 'Take a seat and ready up above' : !connected ? 'Reconnecting…' : paused ? 'Paused' : state.phase === 'countdown' ? `${Math.ceil(state.until - state.time)}` : state.phase === 'finished' ? `${name(state.winner ?? '')} wins the match!` : state.phase === 'results' ? state.winner ? `${name(state.winner)} takes the round` : 'Mutual destruction' : state.practice && !own?.alive ? 'Your ricochet got you. Restart practice.' : '');
  if (now > errorUntil) announce('status', state.practice ? 'Hit the pink targets. Watch out for your returning shots.' : !session.current.isPlayer || !own?.alive ? 'Watching the remaining tanks. Next round starts automatically.' : state.feed.map(entry => `${name(entry.victim)} ${entry.owner === entry.victim ? 'hit their own ricochet' : entry.owner === 'arena' ? 'was caught by the arena' : `was hit by ${name(entry.owner)}`}`).join(' · '));
  const standings = label('standings');
  const text = state.practice ? '' : state.tanks.map(tank => `${name(tank.id)}: ${state.scores[tank.id] ?? 0}`).join('   /   ');
  if (standings.textContent !== text) standings.textContent = text;
}
void game.boot().catch(error => { label('status').textContent = String(error); game.destroy(); });

