import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';

export type TableId = 'blackjack' | 'roulette' | 'slots' | 'plinko' | 'poker';
export const TABLE_IDS: readonly TableId[] = ['blackjack', 'roulette', 'slots', 'plinko', 'poker'];

export type Location = TableId | 'floor';
export const LOCATIONS: readonly Location[] = ['floor', 'blackjack', 'roulette', 'slots', 'plinko', 'poker'];

export type PlayerStatus = 'active' | 'offered' | 'out';
export type OutReason = 'declined' | 'bust' | 'left';
export type FeedKind = 'join' | 'bigwin' | 'jackpot' | 'bailout' | 'bust' | 'leave';

export type FeedItem = {
  id: number;
  kind: FeedKind;
  playerId: string | null;
  amount: number;
  at: number;
};

export type PlayerLedger = {
  bankroll: number;
  penalty: number;
  bailouts: number;
  bankruptcies: number;
  status: PlayerStatus;
  outReason: OutReason | null;
  personalDeadline: number;
  at: Location;
  peak: number;
  biggestWin: number;
  biggestLoss: number;
  rounds: number;
  byGame: Record<TableId, number>;
};

export type CasinoState = {
  version: 1;
  now: number;
  startedAt: number;
  deadline: number;
  phase: 'playing' | 'results';
  players: Record<string, PlayerLedger>;
  order: string[];
  tables: Record<TableId, Json>;
  feed: FeedItem[];
  nextId: number;
};

export interface HostClock {
  now: number;
  entropy(): number;
}

export interface ActionCtx {
  now: number;
  entropy(): number;
  bankroll(playerId: string): number;
  cash(playerId: string, delta: number): void;
  result(playerId: string, game: TableId, net: number): void;
  announce(kind: FeedKind, playerId: string | null, amount: number): void;
}

export type EngineSummary = {
  mode: 'solo' | 'shared';
  limit: number;
  info: Json;
};

export interface Engine<S extends Json> {
  readonly id: TableId;
  create(): S;
  join(state: S, playerId: string, ctx: ActionCtx): void;
  leave(state: S, playerId: string, ctx: ActionCtx): void;
  act(state: S, playerId: string, name: string, payload: Json, ctx: ActionCtx): void;
  tick(state: S, ctx: ActionCtx): void;
  settle(state: S, ctx: ActionCtx): void;
  pending(state: S, playerId: string): boolean;
  occupants(state: S): string[];
  view(state: S, viewerId: string | null): Json;
  summary(state: S): EngineSummary;
}

export type EngineRegistry = Record<TableId, Engine<Json>>;

export type LeaderRow = {
  id: string;
  bankroll: number;
  penalty: number;
  adjusted: number;
  status: PlayerStatus;
  outReason: OutReason | null;
  bankruptcies: number;
  bailouts: number;
  at: Location;
};

export type TableSummary = {
  seats: number;
  limit: number;
  mode: 'solo' | 'shared';
  occupants: string[];
  info: Json;
};

export type ResultsRow = LeaderRow & {
  placement: number;
  peak: number;
  biggestWin: number;
  biggestLoss: number;
  rounds: number;
  byGame: Record<TableId, number>;
};

export type PlayerVault = {
  bankroll: number;
  penalty: number;
  personalDeadline: number;
  status: PlayerStatus;
  outReason: OutReason | null;
  bankruptcies: number;
  bailouts: number;
  peak: number;
  biggestWin: number;
  biggestLoss: number;
  rounds: number;
  byGame: Record<TableId, number>;
};

export type PlayerView = {
  now: number;
  deadline: number;
  phase: 'playing' | 'results';
  you: string | null;
  at: Location;
  players: LeaderRow[];
  results: ResultsRow[] | null;
  feed: FeedItem[];
  tables: Record<TableId, TableSummary>;
  table: Json | null;
  vault: PlayerVault | null;
};
