import {
  isRecord, isJson, PARTY_LIMIT, RECONNECT_GRACE_MS,
  type Json, type MultiplayerMode, type PartyGame, type PartySnapshot, type PartyCommand,
} from '../../packages/game-kit/src/multiplayer/protocol';
import type { MultiplayerDefinition, GameContext } from '../../packages/game-kit/src/multiplayer/server';

export interface RoomState extends PartySnapshot {
  createdAt: number; touchedAt: number; credentials: Record<string, string>;
  sequences: Record<string, number>; seed: number;
}
export interface RegisteredGame extends PartyGame { definition: MultiplayerDefinition }
export type Registry = Record<string, RegisteredGame>;
export function createRoom(code: string, now: number): RoomState {
  return { code, hostId: '', players: [], selection: null, match: null,
    createdAt: now, touchedAt: now, credentials: {}, sequences: {}, seed: 0, nextSequence: 0 };
}
export function selectedMode(room: RoomState, games: Registry): MultiplayerMode | undefined {
  const selection = room.selection;
  return selection ? games[selection.gameId]?.multiplayer?.modes.find(mode => mode.id === selection.modeId) : undefined;
}
function requireHost(room: RoomState, id: string) {
  if (room.hostId !== id) throw new Error('Only the host can do that.');
}
export function transferHost(room: RoomState) {
  // Keep the host during the reconnect grace period, including page navigation.
  if (!room.players.some(player => player.id === room.hostId)) {
    room.hostId = (room.players.find(player => player.connected) ?? room.players[0])?.id ?? '';
  }
}
export function removePlayer(room: RoomState, id: string) {
  room.players = room.players.filter(player => player.id !== id);
  delete room.credentials[id]; delete room.sequences[id];
  if (room.match) room.match.playerIds = room.match.playerIds.filter(playerId => playerId !== id);
  transferHost(room);
}
export function expireDisconnected(room: RoomState, now: number): boolean {
  const expired = room.players.filter(player => !player.connected && player.disconnectedAt !== undefined && now - player.disconnectedAt >= RECONNECT_GRACE_MS);
  for (const player of expired) removePlayer(room, player.id);
  if (room.match?.status === 'playing' && !room.match.playerIds.length) room.match.status = 'finished';
  return expired.length > 0;
}
export function joinRoom(room: RoomState, hash: string, nickname: string, now: number): string {
  const existing = Object.entries(room.credentials).find(([, credential]) => credential === hash)?.[0];
  if (existing) return existing;
  if (room.players.length >= PARTY_LIMIT) throw new Error('This party is full.');
  const id = crypto.randomUUID();
  room.credentials[id] = hash;
  room.players.push({ id, nickname, connected: false, disconnectedAt: now, ready: false, role: 'spectator' });
  room.touchedAt = now;
  return id;
}
export function connectPlayer(room: RoomState, id: string, now: number) {
  const player = room.players.find(player => player.id === id);
  if (!player) throw new Error('Your seat expired. Join the party again.');
  player.connected = true; delete player.disconnectedAt;
  room.touchedAt = now; transferHost(room);
}
export function disconnectPlayer(room: RoomState, id: string, now: number, games: Registry) {
  const player = room.players.find(player => player.id === id);
  if (!player) return;
  player.connected = false; player.disconnectedAt = now; player.ready = false;
  if (selectedMode(room, games)?.disconnect === 'remove') removePlayer(room, id);
  transferHost(room);
}
function context(room: RoomState, mode: MultiplayerMode, playerId: string, now: number): GameContext {
  return { playerId, playerIds: room.match?.playerIds ?? [], mode, now, seed: room.seed };
}
export function parseCommand(value: unknown): PartyCommand {
  if (!isRecord(value)) throw new Error('Invalid party command.');
  switch (value.type) {
    case 'select': if (typeof value.gameId === 'string' && typeof value.modeId === 'string') return { type: 'select', gameId: value.gameId, modeId: value.modeId }; break;
    case 'seat': if (typeof value.playing === 'boolean') return { type: 'seat', playing: value.playing }; break;
    case 'ready': if (typeof value.ready === 'boolean') return { type: 'ready', ready: value.ready }; break;
    case 'start': case 'return': case 'browse': case 'leave': return { type: value.type };
    case 'action': if (typeof value.matchId === 'string' && typeof value.action === 'string' && value.action.length <= 64 && isJson(value.payload) && Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 0) return { type: 'action', matchId: value.matchId, action: value.action, payload: value.payload, sequence: Number(value.sequence) }; break;
  }
  throw new Error('Invalid party command.');
}
/** Mutates a working copy; callers persist only after the entire batch succeeds. */
export function applyCommand(room: RoomState, id: string, command: PartyCommand, games: Registry, now: number): boolean {
  const player = room.players.find(item => item.id === id && item.connected);
  if (!player) throw new Error('Join the party before sending commands.');
  const active = room.match?.status === 'playing';
  const mode = selectedMode(room, games);
  switch (command.type) {
    case 'select': {
      requireHost(room, id);
      if (active) throw new Error('Return to the lobby before changing games.');
      const next = games[command.gameId]?.multiplayer?.modes.find(item => item.id === command.modeId);
      if (!next) throw new Error('That multiplayer mode is unavailable.');
      room.selection = { gameId: command.gameId, modeId: command.modeId }; room.match = null;
      let seats = 0;
      for (const member of room.players) { member.ready = false; if (member.role === 'player' && ++seats > next.maxPlayers) member.role = 'spectator'; }
      break;
    }
    case 'seat': {
      if (!mode) throw new Error('Choose a game first.');
      if (active && room.match?.playerIds.includes(id)) throw new Error('Your seat is reserved until the round ends.');
      if (active && command.playing && mode.lateJoin !== 'join') throw new Error('You can play in the next round.');
      if (command.playing && player.role !== 'player' && room.players.filter(item => item.role === 'player').length >= mode.maxPlayers) throw new Error('All player seats are taken. You can sit out.');
      player.role = command.playing ? 'player' : 'spectator'; player.ready = false;
      if (active && command.playing && room.match && !room.match.playerIds.includes(id)) room.match.playerIds.push(id);
      break;
    }
    case 'ready':
      if (!mode || active || player.role !== 'player') throw new Error('Take a seat in the lobby to ready up.');
      player.ready = command.ready; break;
    case 'start': {
      requireHost(room, id);
      if (!mode || !room.selection || active) throw new Error('Choose a game in the lobby first.');
      const players = room.players.filter(item => item.role === 'player');
      if (players.length < mode.minPlayers || players.length > mode.maxPlayers || players.some(item => !item.connected || !item.ready)) throw new Error('All participating players must be connected and ready.');
      room.seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      room.sequences = {};
      room.match = { id: crypto.randomUUID(), ...room.selection, status: 'playing', phase: 'shared', startedAt: now, revision: 0, state: null, preset: mode.preset, playerIds: players.map(item => item.id) };
      const initial = games[room.selection.gameId]!.definition.setup(context(room, mode, id, now));
      if (!isJson(initial.state) || JSON.stringify(initial.state).length > 32_768) throw new Error('Invalid initial game state.');
      room.match.state = initial.state; room.match.phase = initial.phase ?? 'shared';
      break;
    }
    case 'browse':
    case 'return':
      requireHost(room, id); room.match = null; room.sequences = {};
      if (command.type === 'browse') room.selection = null;
      for (const member of room.players) member.ready = false;
      break;
    case 'leave': removePlayer(room, id); break;
    case 'action': {
      const match = room.match;
      if (!match || !active || !mode || command.matchId !== match.id) throw new Error('That round has ended.');
      if (player.role !== 'player' || !match.playerIds.includes(id)) throw new Error('Spectators cannot play actions.');
      if (command.sequence <= (room.sequences[id] ?? -1)) return false;
      const result = games[match.gameId]!.definition.action(match.state, command.action, command.payload, context(room, mode, id, now));
      if (!isJson(result.state) || JSON.stringify(result.state).length > 32_768) throw new Error('Game state exceeds the supported size.');
      match.state = result.state; match.revision++;
      if (result.phase !== undefined) match.phase = result.phase.slice(0, 64);
      if (result.finished) match.status = 'finished';
      room.sequences[id] = command.sequence;
      break;
    }
  }
  room.touchedAt = now;
  return true;
}
export function snapshot(room: RoomState, id: string, games: Registry): PartySnapshot {
  const { code, hostId, players, selection, match } = room;
  const mode = selectedMode(room, games);
  const participating = match?.playerIds.includes(id) ?? false;
  const visible = match && (participating || mode?.spectators !== false);
  return { code, hostId, players: structuredClone(players), selection, nextSequence: (room.sequences[id] ?? -1) + 1,
    match: match ? { ...match, state: visible ? games[match.gameId]!.definition.view(structuredClone(match.state), participating ? id : null) : null } : null };
}
export function reconcileMatch(room: RoomState, games: Registry, now: number) {
  const match = room.match; const mode = selectedMode(room, games);
  if (!match || match.status !== 'playing' || !mode) return;
  if (!match.playerIds.length) { match.status = 'finished'; return; }
  const changed = games[match.gameId]?.definition.playersChanged;
  if (!changed) return;
  const result = changed(structuredClone(match.state), context(room, mode, '', now));
  if (!isJson(result.state) || JSON.stringify(result.state).length > 32_768) throw new Error('Invalid reconciled game state.');
  match.state = result.state;
  if (result.phase !== undefined) match.phase = result.phase;
  if (result.finished) match.status = 'finished';
}
