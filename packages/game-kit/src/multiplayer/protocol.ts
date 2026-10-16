export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type NetworkPreset = 'turn-based' | 'shared-challenge' | 'live';
export const NETWORK_PRESETS = {
  'turn-based': { intervalMs: 0, actionsPerSecond: 4 },
  'shared-challenge': { intervalMs: 250, actionsPerSecond: 8 },
  live: { intervalMs: 100, actionsPerSecond: 20 },
} as const;
export interface MultiplayerMode {
  id: string;
  label: string;
  minPlayers: number;
  maxPlayers: number;
  preset: NetworkPreset;
  spectators?: boolean;
  lateJoin?: 'spectate' | 'join';
  disconnect?: 'reserve' | 'remove';
}
export interface MultiplayerConfig { modes: MultiplayerMode[] }
export interface PartyGame { id: string; title: string; multiplayer?: MultiplayerConfig }
export interface PartyPlayer {
  id: string; nickname: string; connected: boolean; ready: boolean;
  role: 'player' | 'spectator'; disconnectedAt?: number;
}
export interface Selection { gameId: string; modeId: string }
export interface PartyMatch {
  id: string; gameId: string; modeId: string; startedAt: number;
  status: 'playing' | 'finished'; phase: string; revision: number; state: Json; preset: NetworkPreset;
  playerIds: string[];
}
export interface PartySnapshot {
  code: string; hostId: string; players: PartyPlayer[];
  selection: Selection | null; match: PartyMatch | null; nextSequence: number;
}
export type PartyCommand =
  | { type: 'select'; gameId: string; modeId: string }
  | { type: 'seat'; playing: boolean }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'return' }
  | { type: 'browse' }
  | { type: 'leave' }
  | { type: 'action'; matchId: string; action: string; payload: Json; sequence: number };
export type ServerMessage =
  | { type: 'snapshot'; party: PartySnapshot; playerId: string }
  | { type: 'error'; message: string };
export interface MultiplayerUpdate { party: PartySnapshot | null; playerId: string | null; connected: boolean }
export type GameMenuCommand = Exclude<PartyCommand, { type: 'action' | 'leave' | 'select' }> | { type: 'mode'; modeId: string };
export const PARTY_CHANNEL = 'playground-exe-party';
export const WEBSOCKET_PROTOCOL = 'playground-exe-v1';
export const MAX_MESSAGE_BYTES = 8192;
export const PARTY_LIMIT = 16;
export const RECONNECT_GRACE_MS = 60_000;
export const PARTY_IDLE_MS = 30 * 60_000;
export const PARTY_MAX_AGE_MS = 12 * 60 * 60_000;

/** Keep the code as text so invitations beginning with zero survive pasting. */
export function normalizePartyCode(value: string): string {
  return value.normalize('NFKC').replace(/[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu, '');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isJson(value: unknown, depth = 0): value is Json {
  if (depth > 16) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isJson(item, depth + 1));
  return isRecord(value) && Object.values(value).every(item => isJson(item, depth + 1));
}
export function parseMultiplayer(value: unknown): MultiplayerConfig {
  if (!isRecord(value) || !Array.isArray(value.modes) || !value.modes.length) throw new Error('multiplayer.modes must be a non-empty array');
  const ids = new Set<string>();
  for (const mode of value.modes) {
    if (!isRecord(mode) || typeof mode.id !== 'string' || !/^[a-z0-9-]+$/.test(mode.id) || ids.has(mode.id)) throw new Error('Invalid or duplicate multiplayer mode ID');
    ids.add(mode.id);
    if (typeof mode.label !== 'string' || !mode.label.trim()) throw new Error('Mode needs a label');
    if (!Number.isInteger(mode.minPlayers) || !Number.isInteger(mode.maxPlayers) || Number(mode.minPlayers) < 1 || Number(mode.maxPlayers) < Number(mode.minPlayers) || Number(mode.maxPlayers) > PARTY_LIMIT) throw new Error(`Player limits must be between 1 and ${PARTY_LIMIT}`);
    if (typeof mode.preset !== 'string' || !Object.hasOwn(NETWORK_PRESETS, mode.preset)) throw new Error('Invalid networking preset');
    if (mode.spectators !== undefined && typeof mode.spectators !== 'boolean') throw new Error('spectators must be boolean');
    if (mode.lateJoin !== undefined && !['spectate', 'join'].includes(String(mode.lateJoin))) throw new Error('Invalid lateJoin policy');
    if (mode.disconnect !== undefined && !['reserve', 'remove'].includes(String(mode.disconnect))) throw new Error('Invalid disconnect policy');
  }
  return value as unknown as MultiplayerConfig;
}
