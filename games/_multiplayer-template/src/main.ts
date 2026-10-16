import { createGame } from '@playground-exe/game-kit';
import type { CircuitState } from './multiplayer';
import type { Json } from '@playground-exe/game-kit/multiplayer';
import './style.css';

const container = document.querySelector<HTMLElement>('#game')!;
container.replaceChildren();
const header = document.createElement('p'); header.className = 'eyebrow'; header.textContent = 'POCKET CIRCUIT';
const heading = document.createElement('h1'); heading.textContent = '__GAME_TITLE__';
const status = document.createElement('p'); status.setAttribute('role', 'status');
const tracks = document.createElement('div'); tracks.className = 'tracks';
const actions = document.createElement('div'); actions.className = 'actions';
const advance = document.createElement('button'); advance.textContent = 'Advance →';
const back = document.createElement('button'); back.textContent = '← Move back';
const warm = document.createElement('button'); warm.textContent = 'Practice finished — ready';
const solo = document.createElement('button'); solo.textContent = 'Play solo';
const note = document.createElement('p'); note.className = 'note'; note.textContent = 'Create or join a party above to play with friends. Solo is always available.';
actions.append(back, advance, warm, solo); container.append(header, heading, status, tracks, actions, note);
let soloScore = 0; let practice = 0; let playingSolo = false; let paused = false;
const game = createGame('__GAME_ID__', {
  initialize() {}, start() { container.focus(); }, pause() { paused = true; }, resume() { paused = false; },
  restart() { if (session.current.match?.status === 'playing') { status.textContent = 'Return to the lobby to restart the shared round.'; return; } soloScore = 0; playingSolo = true; paused = false; render(); },
  destroy() { window.removeEventListener('keydown', keydown); },
});
const session = game.multiplayer<CircuitState, { advance: Json; warm: Json; move: number }>();
function act(direction = 1) {
  if (paused) return;
  const match = session.current.match;
  if (!match || playingSolo) { soloScore = Math.max(0, soloScore + direction); game.score(soloScore); render(); return; }
  if (!session.current.isPlayer || !session.current.connected) return;
  if (match.state.round === 'practice') { practice++; render(); return; }
  session.send(match.preset === 'live' ? 'move' : 'advance', match.preset === 'live' ? direction : null);
}
advance.onclick = () => act(); back.onclick = () => act(-1);
warm.onclick = () => { if (practice >= 3) session.send('warm', null); };
solo.onclick = () => { playingSolo = !playingSolo; render(); };
function keydown(event: KeyboardEvent) {
  if (event.code === 'Space' || event.code === 'ArrowRight' || event.code === 'ArrowLeft') { event.preventDefault(); if (!event.repeat) act(event.code === 'ArrowLeft' ? -1 : 1); }
}
window.addEventListener('keydown', keydown);
let lastMatch = '';
function render() {
  const { match, party, playerId, isPlayer, connected } = session.current;
  if ((match?.id ?? '') !== lastMatch) { lastMatch = match?.id ?? ''; practice = 0; playingSolo = false; }
  tracks.replaceChildren();
  const shared = match && !playingSolo;
  warm.hidden = !shared || match.state.round !== 'practice' || !isPlayer;
  warm.disabled = practice < 3 || !connected || !!match?.state.warm[playerId ?? ''];
  back.hidden = !shared || match.preset !== 'live' || match.state.round !== 'race';
  advance.disabled = !!shared && (!isPlayer || !connected || match.status === 'finished' || (match.state.round === 'race' && match.preset === 'turn-based' && match.state.turn !== playerId));
  solo.hidden = !!match && isPlayer && match.status === 'playing';
  solo.textContent = playingSolo && match ? 'Watch party round' : 'Play solo';
  if (!shared) {
    status.textContent = `Solo practice · ${soloScore} steps. Press Space or click Advance.`;
    addTrack('You', soloScore, 10); return;
  }
  const state = match.state;
  const name = (id: string) => party?.players.find(player => player.id === id)?.nickname ?? 'Player';
  if (!connected) status.textContent = 'Reconnecting… Inputs are paused until your seat is restored.';
  else if (state.round === 'finished') status.textContent = `${name(state.winner ?? '')} wins! The host can return everyone to the lobby.`;
  else if (state.round === 'practice') status.textContent = isPlayer ? `Your solo practice: ${practice}/3 steps. Then ready up for the shared round.` : 'Watching: players are warming up individually.';
  else status.textContent = match.preset === 'turn-based' ? `${name(state.turn)}’s turn · First to ${state.target}` : `Shared race · First to ${state.target}${isPlayer ? '' : ' · Watching'}`;
  for (const id of match.playerIds) addTrack(`${name(id)}${state.warm[id] && state.round === 'practice' ? ' · ready' : ''}`, state.round === 'practice' && id === playerId ? practice : state.scores[id] ?? 0, state.target);
}
function addTrack(name: string, score: number, target: number) {
  const row = document.createElement('div'); row.className = 'track';
  const label = document.createElement('span'); label.textContent = name;
  const progress = document.createElement('progress'); progress.max = target; progress.value = score; progress.setAttribute('aria-label', `${name}: ${score} of ${target}`);
  const value = document.createElement('strong'); value.textContent = String(score);
  row.append(label, progress, value); tracks.append(row);
}
session.subscribe(render); session.onError(message => { status.textContent = message; });
void game.boot().catch(error => { status.textContent = String(error); game.destroy(); });
