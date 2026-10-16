import type { createMultiplayer } from './client';
import type { Json, MultiplayerConfig } from './protocol';

export function createMultiplayerMenu<State extends Json, Actions extends Record<string, Json>>(session: ReturnType<typeof createMultiplayer<State, Actions>>, gameId: string, config: MultiplayerConfig) {
  const element = document.createElement('section'); element.className = 'multiplayer-menu'; element.setAttribute('aria-label', 'Party game menu');
  const label = document.createElement('p'); label.className = 'eyebrow';
  const heading = document.createElement('h2'); heading.textContent = 'Choose your mode';
  const modes = document.createElement('div'); modes.className = 'mode-options';
  const modeButtons = config.modes.map(mode => {
    const button = document.createElement('button');
    const title = document.createElement('strong'); title.textContent = mode.label;
    const detail = document.createElement('span'); detail.textContent = `${mode.minPlayers}–${mode.maxPlayers} players · ${mode.spectators === false ? 'No spectators' : 'Spectators welcome'}`;
    button.append(title, detail); button.onclick = () => session.command({ type: 'mode', modeId: mode.id });
    modes.append(button); return button;
  });
  const roster = document.createElement('ul'); roster.className = 'party-roster';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'actions';
  const seat = document.createElement('button'); seat.onclick = () => session.command({ type: 'seat', playing: session.current.party?.players.find(player => player.id === session.current.playerId)?.role !== 'player' });
  const ready = document.createElement('button'); ready.onclick = () => session.command({ type: 'ready', ready: !session.current.party?.players.find(player => player.id === session.current.playerId)?.ready });
  const start = document.createElement('button'); start.textContent = 'Start round'; start.onclick = () => session.command({ type: 'start' });
  const menu = document.createElement('button'); menu.textContent = 'Back to game menu'; menu.onclick = () => session.command({ type: 'return' });
  const browse = document.createElement('button'); browse.textContent = 'Change game'; browse.onclick = () => session.command({ type: 'browse' });
  actions.append(seat, ready, start, menu, browse); element.append(label, heading, modes, roster, status, actions);
  const unsubscribe = session.subscribe(({ party, playerId, connected }) => {
    element.hidden = party?.selection?.gameId !== gameId;
    if (element.hidden || !party) return;
    const host = party.hostId === playerId;
    const match = party.match;
    const active = match?.status === 'playing';
    const mode = config.modes.find(mode => mode.id === party.selection?.modeId)!;
    const me = party.players.find(player => player.id === playerId);
    const players = party.players.filter(player => player.role === 'player');
    label.textContent = `PARTY ${party.code}`;
    heading.textContent = active ? mode.label : match ? 'Play again?' : 'Choose your mode';
    modes.hidden = active;
    modeButtons.forEach((button, index) => { button.disabled = !host || !connected; button.setAttribute('aria-pressed', String(config.modes[index]?.id === mode.id)); });
    roster.replaceChildren(...party.players.map(player => {
      const row = document.createElement('li');
      row.textContent = `${player.nickname}${player.id === playerId ? ' (you)' : ''}${player.id === party.hostId ? ' · Host' : ''} · ${!player.connected ? 'Reconnecting' : player.role === 'spectator' ? mode.spectators === false ? 'Sitting out' : 'Watching' : active ? 'Playing' : player.ready ? 'Ready ✓' : 'Not ready'}`;
      return row;
    }));
    const canJoin = active && !match.playerIds.includes(playerId ?? '') && mode.lateJoin === 'join' && match.playerIds.length < mode.maxPlayers;
    seat.hidden = !!active && !canJoin;
    seat.textContent = !active && me?.role === 'player' ? 'Sit out this round' : 'Take a seat';
    seat.disabled = !connected || (me?.role !== 'player' && players.length >= mode.maxPlayers);
    ready.hidden = !!active || me?.role !== 'player'; ready.disabled = !connected;
    ready.textContent = me?.ready ? 'Ready ✓ · Undo' : 'I’m ready'; ready.setAttribute('aria-pressed', String(!!me?.ready));
    const reason = !connected ? 'Reconnecting…' : players.length < mode.minPlayers ? `Need ${mode.minPlayers - players.length} more ${mode.minPlayers - players.length === 1 ? 'player' : 'players'}.` : players.length > mode.maxPlayers ? 'Some players need to sit out.' : players.some(player => !player.connected) ? 'Waiting for players to reconnect.' : players.some(player => !player.ready) ? 'Waiting for everyone to ready up.' : '';
    status.textContent = active ? 'Round in progress.' : reason || (host ? 'Everyone’s ready. Start the round.' : 'Waiting for the host to start.');
    start.hidden = !host || !!active; start.disabled = !!reason;
    menu.hidden = !host || !match; menu.disabled = !connected;
    browse.hidden = !host; browse.disabled = !connected;
  });
  const unsubscribeError = session.onError(message => { status.textContent = message; });
  return { element, destroy() { unsubscribe(); unsubscribeError(); element.remove(); } };
}
