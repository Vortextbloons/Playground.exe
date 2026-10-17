import { createGame } from '@playground-exe/game-kit';
import { createMultiplayerMenu, parseMultiplayer, type Json } from '@playground-exe/game-kit/multiplayer';
import type { CircuitState } from './multiplayer';
import metadata from '../game.json';
import './style.css';

const container = document.querySelector<HTMLElement>('#game')!;
container.innerHTML = `<header><div><p class="eyebrow">LITTLE CARS. CLOSE RACES.</p><h1>Pocket Circuit</h1></div><button id="solo">Race solo</button></header>
<div class="race-layout"><div class="race-view"><div class="hud"><span id="lap">LAP 01 / 03</span><span id="timer">00:00.0</span></div><canvas width="800" height="480" aria-label="Top-down oval racetrack. Use Up to accelerate, Left and Right to steer, and Down to brake."></canvas><p id="status" role="status"></p><div class="driving-controls"><div class="steering"><button data-drive="left" aria-label="Steer left">←</button><button data-drive="right" aria-label="Steer right">→</button></div><button data-drive="brake">Brake ↓</button><button data-drive="gas" class="gas">Accelerate ↑</button><button id="warm">Ready to race</button></div></div><div id="menu"></div></div><p class="note">Hold ↑ / W to accelerate · ← → / A D to steer · ↓ / S to brake · Three laps to win</p>`;
const canvas = container.querySelector('canvas')!;
const ctx = canvas.getContext('2d')!;
const status = container.querySelector<HTMLElement>('#status')!;
const lap = container.querySelector<HTMLElement>('#lap')!;
const timer = container.querySelector<HTMLElement>('#timer')!;
const solo = container.querySelector<HTMLButtonElement>('#solo')!;
const warm = container.querySelector<HTMLButtonElement>('#warm')!;
const gasButton = container.querySelector<HTMLButtonElement>('[data-drive="gas"]')!;
const palette = ['#ee775c', '#f4d784', '#96c8f0', '#c5a7e5', '#f3a7b1', '#87d5b2', '#f7f0cf', '#6eb8be'];
const keys = new Set<string>();
const tau = Math.PI * 2;
const startAngle = Math.PI / 2;
let x = 400; let y = 385; let angle = Math.PI; let speed = 0;
let progress = 0; let checkpoints = 0; let practice = 0; let elapsed = 0; let finished = false;
let playingSolo = false; let paused = false; let lastFrame = 0; let animation = 0;
let previousMatch = ''; let previousRound = '';
const displayed = new Map<string, number>();
const game = createGame('pocket-circuit', {
  initialize() {}, start() { animation = requestAnimationFrame(tick); },
  pause() { paused = true; keys.clear(); cancelAnimationFrame(animation); }, resume() { paused = false; animation = requestAnimationFrame(tick); },
  restart() {
    if (session.current.party?.match?.status === 'playing') { status.textContent = 'The host can use Back to game menu to restart the party race.'; return; }
    playingSolo = true; reset(); paused = false; cancelAnimationFrame(animation); animation = requestAnimationFrame(tick); render();
  },
  destroy() { cancelAnimationFrame(animation); partyMenu.destroy(); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release); },
});
const session = game.multiplayer<CircuitState, { advance: Json; warm: Json; move: number }>();
const partyMenu = createMultiplayerMenu(session, metadata.id, parseMultiplayer(metadata.multiplayer));
container.querySelector('#menu')!.append(partyMenu.element);
function reset() {
  x = 400; y = 385; angle = Math.PI; speed = 0; progress = 0; checkpoints = 0; elapsed = 0; finished = false; keys.clear();
}
function name(id: string) { return session.current.party?.players.find(player => player.id === id)?.nickname ?? 'Racer'; }
function render() {
  const { party, match, playerId, isPlayer, connected } = session.current;
  const round = match?.state.round ?? '';
  if ((match?.id ?? '') !== previousMatch || round !== previousRound) {
    previousMatch = match?.id ?? ''; previousRound = round; practice = 0; playingSolo = false; displayed.clear(); reset();
  }
  const shared = !!match && !playingSolo;
  container.classList.toggle('with-party', !!party);
  solo.hidden = shared && isPlayer && match.status === 'playing';
  solo.textContent = playingSolo && match ? 'Watch party race' : finished ? 'Race again' : 'Race solo';
  warm.hidden = !shared || round !== 'practice' || !isPlayer;
  warm.disabled = practice < 3 || !connected || !!match?.state.warm[playerId ?? ''];
  gasButton.textContent = shared && match.preset === 'turn-based' && round === 'race' ? 'Drive your turn ↑' : 'Accelerate ↑';
  if (!shared) status.textContent = finished ? `Finished in ${elapsed.toFixed(1)}s. Race again?` : 'Three laps. Keep it on the tarmac.';
  else if (!connected) status.textContent = 'Reconnecting… Racing is paused.';
  else if (round === 'finished') status.textContent = `${name(match.state.winner ?? '')} takes the flag!`;
  else if (round === 'practice') status.textContent = isPlayer ? `Warm-up: ${Math.min(3, practice)}/3 checkpoints. Drive, then select Ready to race.` : 'The drivers are warming up.';
  else if (match.preset === 'turn-based') status.textContent = `${name(match.state.turn)}’s turn. Tap accelerate to drive one checkpoint.`;
  else status.textContent = isPlayer ? 'Race your party. Three laps to the flag!' : 'Watching the race.';
}
solo.onclick = () => { playingSolo = !(playingSolo && session.current.match); reset(); render(); };
warm.onclick = () => { if (practice >= 3) session.send('warm', null); };
function turn() {
  const { match, playerId, connected, isPlayer } = session.current;
  if (!paused && !playingSolo && connected && isPlayer && match?.status === 'playing' && match.state.round === 'race' && match.preset === 'turn-based' && match.state.turn === playerId) session.send('advance', null);
}
const keyMap: Record<string, string> = { ArrowUp: 'gas', KeyW: 'gas', Space: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
function keydown(event: KeyboardEvent) {
  if (event.target instanceof Element && event.target.closest('.multiplayer-menu, #solo, #warm')) return;
  const key = keyMap[event.code];
  if (key) { event.preventDefault(); keys.add(key); if (key === 'gas' && !event.repeat) turn(); }
}
function keyup(event: KeyboardEvent) { const key = keyMap[event.code]; if (key) keys.delete(key); }
function release() { keys.clear(); }
window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', release);
for (const button of container.querySelectorAll<HTMLButtonElement>('[data-drive]')) {
  const key = button.dataset.drive!;
  button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(key); if (key === 'gas') turn(); };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => { keys.delete(key); };
  button.onclick = event => { if (event.detail === 0 && key === 'gas') turn(); };
}
function checkpoint() {
  const { match, isPlayer } = session.current;
  if (!match || playingSolo) {
    if (progress >= 24) { finished = true; speed = 0; game.score(Math.max(1, Math.round(100000 / Math.max(1, elapsed)))); render(); }
  } else if (match.state.round === 'practice') { practice++; render(); }
  else if (isPlayer) session.send(match.preset === 'live' ? 'move' : 'advance', match.preset === 'live' ? 1 : null);
}
function tick(now: number) {
  const dt = Math.min((now - (lastFrame || now)) / 1000, .04); lastFrame = now;
  const { match, connected, isPlayer } = session.current;
  const shared = !!match && !playingSolo;
  const driving = !paused && !finished && (!shared || (connected && isPlayer && match.status === 'playing' && (match.state.round === 'practice' || match.preset !== 'turn-based')));
  if (driving) {
    if (keys.has('gas')) speed += 120 * dt;
    else speed -= 40 * dt;
    if (keys.has('brake')) speed -= 200 * dt;
    const radius = Math.hypot((x - 400) / 260, (y - 240) / 145);
    speed = Math.max(0, Math.min(Math.abs(radius - 1) > .24 ? 65 : 220, speed));
    if (speed > 1) {
      elapsed += dt;
      angle += ((keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0)) * 2.5 * dt * Math.min(1, speed / 60);
      const before = Math.atan2((y - 240) / 145, (x - 400) / 260);
      x = Math.max(20, Math.min(780, x + Math.cos(angle) * speed * dt));
      y = Math.max(20, Math.min(460, y + Math.sin(angle) * speed * dt));
      const after = Math.atan2((y - 240) / 145, (x - 400) / 260);
      let delta = after - before;
      if (delta < -Math.PI) delta += tau;
      if (delta > Math.PI) delta -= tau;
      if (Math.abs(radius - 1) <= .24) {
        progress = Math.max(0, progress + delta / tau * 8);
        if (Math.floor(progress) > checkpoints) { checkpoints = Math.floor(progress); checkpoint(); }
      }
    }
  }
  draw(dt);
  const raceProgress = shared && match.state.round !== 'practice' ? match.state.scores[session.current.playerId ?? ''] ?? 0 : progress;
  lap.textContent = `LAP ${String(Math.min(3, Math.floor(raceProgress / 8) + 1)).padStart(2, '0')} / 03`;
  timer.textContent = paused ? 'PAUSED' : `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${(elapsed % 60).toFixed(1).padStart(4, '0')}`;
  animation = requestAnimationFrame(tick);
}
function ellipse(rx: number, ry: number, color: string, width = 0) {
  ctx.beginPath(); ctx.ellipse(400, 240, rx, ry, 0, 0, tau);
  if (width) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  else { ctx.fillStyle = color; ctx.fill(); }
}
function car(cx: number, cy: number, rotation: number, color: string, label: string) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rotation);
  ctx.fillStyle = '#132b2b'; ctx.fillRect(-17, -13, 10, 5); ctx.fillRect(7, -13, 10, 5); ctx.fillRect(-17, 8, 10, 5); ctx.fillRect(7, 8, 10, 5);
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(-20, -10, 40, 20, 5); ctx.fill();
  ctx.fillStyle = '#263e48'; ctx.fillRect(-8, -7, 13, 14); ctx.fillStyle = '#fff0cf'; ctx.fillRect(13, -7, 4, 4); ctx.fillRect(13, 3, 4, 4);
  ctx.restore(); ctx.fillStyle = '#fff0cf'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(label, cx, cy - 24);
}
function draw(dt: number) {
  ctx.fillStyle = '#21534a'; ctx.fillRect(0, 0, 800, 480);
  ellipse(260, 145, '#e6dfc9', 101);
  ctx.setLineDash([13, 13]); ellipse(260, 145, '#d96d58', 101); ctx.setLineDash([]);
  ellipse(260, 145, '#303d42', 82);
  ctx.setLineDash([14, 15]); ellipse(260, 145, '#bec4b9', 2); ctx.setLineDash([]);
  ctx.fillStyle = '#f3ead0'; ctx.font = 'italic 900 36px system-ui'; ctx.textAlign = 'center'; ctx.fillText('POCKET', 400, 230); ctx.fillText('CIRCUIT', 400, 268);
  ctx.font = '11px monospace'; ctx.fillStyle = '#9bc2ad'; ctx.fillText('THREE LAPS. ONE WINNER.', 400, 294);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 2; col++) { ctx.fillStyle = (row + col) % 2 ? '#263238' : '#fff0cf'; ctx.fillRect(395 + col * 6, 344 + row * 10, 6, 10); }
  const { match, playerId, isPlayer } = session.current;
  const shared = !!match && !playingSolo;
  if (shared && match.state.round !== 'practice') {
    match.playerIds.forEach((id, index) => {
      const target = match.state.scores[id] ?? 0;
      const value = (displayed.get(id) ?? 0) + (target - (displayed.get(id) ?? 0)) * Math.min(1, dt * 8); displayed.set(id, value);
      if (id === playerId && match.preset !== 'turn-based' && match.state.round !== 'finished') return;
      const t = startAngle + value / 8 * tau;
      const offset = (index - (match.playerIds.length - 1) / 2) * 6;
      car(400 + Math.cos(t) * (260 + offset), 240 + Math.sin(t) * (145 + offset), Math.atan2(145 * Math.cos(t), -260 * Math.sin(t)), palette[index % palette.length]!, name(id));
    });
  }
  if (!shared || (isPlayer && (match.state.round === 'practice' || (match.preset !== 'turn-based' && match.state.round !== 'finished')))) car(x, y, angle, palette[Math.max(0, match?.playerIds.indexOf(playerId ?? '') ?? 0) % palette.length]!, 'YOU');
}
session.subscribe(render); session.onError(message => { status.textContent = message; });
void game.boot().catch(error => { status.textContent = String(error); game.destroy(); });
