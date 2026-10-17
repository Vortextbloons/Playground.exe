import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
import { BAILOUT_CHIPS, BAILOUT_PENALTY, BAILOUT_TIME_MS, FEED_LIMIT, MATCH_MS, MIN_BET, START_BANKROLL } from './economy';
import { asRecord, readBool, readChoice } from './parse';
import {
  LOCATIONS, TABLE_IDS,
  type ActionCtx, type CasinoState, type EngineRegistry, type FeedKind, type HostClock,
  type LeaderRow, type PlayerLedger, type PlayerVault, type PlayerView, type ResultsRow,
  type TableId, type TableSummary,
} from './types';

export type CasinoResult = { state: CasinoState; finished: boolean };

function emptyByGame(): Record<TableId, number> {
  return { blackjack: 0, roulette: 0, slots: 0, plinko: 0, poker: 0 };
}

function pushFeed(state: CasinoState, kind: FeedKind, playerId: string | null, amount: number): void {
  state.feed.push({ id: state.nextId, kind, playerId, amount, at: state.now });
  state.nextId += 1;
  if (state.feed.length > FEED_LIMIT) state.feed.splice(0, state.feed.length - FEED_LIMIT);
}

function makeCtx(state: CasinoState, host: HostClock): ActionCtx {
  return {
    now: host.now,
    entropy: host.entropy,
    bankroll: playerId => state.players[playerId]?.bankroll ?? 0,
    cash: (playerId, delta) => {
      const ledger = state.players[playerId];
      if (!ledger) throw new Error('Unknown player.');
      if (!Number.isInteger(delta)) throw new Error('Invalid amount.');
      ledger.bankroll += delta;
      if (ledger.bankroll > ledger.peak) ledger.peak = ledger.bankroll;
    },
    result: (playerId, game, net) => {
      const ledger = state.players[playerId];
      if (!ledger) throw new Error('Unknown player.');
      if (!Number.isInteger(net)) throw new Error('Invalid result.');
      ledger.rounds += 1;
      ledger.byGame[game] += 1;
      if (net > ledger.biggestWin) ledger.biggestWin = net;
      if (net < ledger.biggestLoss) ledger.biggestLoss = net;
    },
    announce: (kind, playerId, amount) => pushFeed(state, kind, playerId, amount),
  };
}

function addPlayer(state: CasinoState, playerId: string): void {
  state.players[playerId] = {
    bankroll: START_BANKROLL, penalty: 0, bailouts: 0, bankruptcies: 0,
    status: 'active', outReason: null, personalDeadline: state.deadline,
    at: 'floor', peak: START_BANKROLL, biggestWin: 0, biggestLoss: 0,
    rounds: 0, byGame: emptyByGame(),
  };
  state.order.push(playerId);
  pushFeed(state, 'join', playerId, 0);
}

export function createCasino(engines: EngineRegistry, playerIds: readonly string[], host: HostClock): CasinoState {
  const tables = {} as Record<TableId, Json>;
  for (const id of TABLE_IDS) tables[id] = engines[id].create();
  const state: CasinoState = {
    version: 1, now: host.now, startedAt: host.now, deadline: host.now + MATCH_MS,
    phase: 'playing', players: {}, order: [], tables, feed: [], nextId: 1,
  };
  for (const playerId of playerIds) addPlayer(state, playerId);
  return state;
}

function tickTables(engines: EngineRegistry, state: CasinoState, ctx: ActionCtx): void {
  if (state.phase === 'results') return;
  for (const id of TABLE_IDS) engines[id].tick(state.tables[id], ctx);
}

function sweepBroke(engines: EngineRegistry, state: CasinoState): void {
  if (state.phase !== 'playing') return;
  for (const playerId of state.order) {
    const ledger = state.players[playerId]!;
    if (ledger.status !== 'active' || ledger.bankroll >= MIN_BET) continue;
    if (TABLE_IDS.some(id => engines[id].pending(state.tables[id], playerId))) continue;
    ledger.bankruptcies += 1;
    if (ledger.bankruptcies === 1) {
      ledger.status = 'offered';
    } else {
      ledger.status = 'out';
      ledger.outReason = 'bust';
      pushFeed(state, 'bust', playerId, 0);
    }
  }
}

function finalizeAtDeadline(engines: EngineRegistry, state: CasinoState, ctx: ActionCtx): void {
  if (state.phase !== 'playing' || ctx.now < state.deadline) return;
  for (const id of TABLE_IDS) engines[id].settle(state.tables[id], ctx);
  state.phase = 'results';
}

function checkIntegrity(state: CasinoState): void {
  for (const playerId of state.order) {
    const ledger = state.players[playerId]!;
    if (!Number.isInteger(ledger.bankroll) || ledger.bankroll < 0) throw new Error('Credit check failed.');
  }
}

function applyPlayerAction(engines: EngineRegistry, state: CasinoState, playerId: string, action: string, payload: Json, ctx: ActionCtx): void {
  const ledger = state.players[playerId];
  if (!ledger) throw new Error('You are not in this casino.');
  if (state.phase === 'results') {
    if (action !== 'tick') throw new Error('The casino is closed.');
    return;
  }
  if (action === 'tick') return;
  if (action === 'sit') {
    const at = readChoice(asRecord(payload), 'at', LOCATIONS);
    if (ledger.at === at) return;
    if (ledger.status === 'out' && at !== 'floor' && ledger.bankroll >= MIN_BET) throw new Error('You are out of the match.');
    if (ledger.at !== 'floor') engines[ledger.at].leave(state.tables[ledger.at], playerId, ctx);
    if (at !== 'floor') engines[at].join(state.tables[at], playerId, ctx);
    ledger.at = at;
    return;
  }
  if (action === 'bailout') {
    if (ledger.status !== 'offered') throw new Error('No bailout is available.');
    if (readBool(asRecord(payload), 'accept')) {
      ledger.status = 'active';
      ledger.bailouts += 1;
      ledger.penalty += BAILOUT_PENALTY;
      ctx.cash(playerId, BAILOUT_CHIPS);
      ledger.personalDeadline = Math.min(state.deadline, ctx.now + Math.max(0, state.deadline - ctx.now - BAILOUT_TIME_MS));
      pushFeed(state, 'bailout', playerId, BAILOUT_CHIPS);
    } else {
      ledger.status = 'out';
      ledger.outReason = 'declined';
      pushFeed(state, 'bust', playerId, 0);
    }
    return;
  }
  if (ledger.status !== 'active') throw new Error('You cannot bet right now.');
  if (ctx.now >= ledger.personalDeadline) throw new Error('Your time is up.');
  if (ledger.at === 'floor') throw new Error('Sit at a table first.');
  engines[ledger.at].act(state.tables[ledger.at], playerId, action, payload, ctx);
}

export function applyCasino(engines: EngineRegistry, state: CasinoState, playerId: string | null, action: string, payload: Json, host: HostClock): CasinoResult {
  const next = structuredClone(state);
  next.now = host.now;
  const ctx = makeCtx(next, host);
  tickTables(engines, next, ctx);
  finalizeAtDeadline(engines, next, ctx);
  if (playerId !== null) applyPlayerAction(engines, next, playerId, action, payload, ctx);
  sweepBroke(engines, next);
  checkIntegrity(next);
  return { state: next, finished: next.phase === 'results' };
}

export function reconcileCasino(engines: EngineRegistry, state: CasinoState, playerIds: readonly string[], host: HostClock): CasinoResult {
  const next = structuredClone(state);
  next.now = host.now;
  const ctx = makeCtx(next, host);
  const present = new Set(playerIds);
  for (const playerId of next.order) {
    const ledger = next.players[playerId]!;
    if (present.has(playerId) || ledger.status === 'out') continue;
    if (ledger.at !== 'floor') {
      engines[ledger.at].leave(next.tables[ledger.at], playerId, ctx);
      ledger.at = 'floor';
    }
    ledger.status = 'out';
    ledger.outReason = 'left';
    pushFeed(next, 'leave', playerId, 0);
  }
  for (const playerId of playerIds) {
    if (!next.players[playerId]) addPlayer(next, playerId);
  }
  tickTables(engines, next, ctx);
  finalizeAtDeadline(engines, next, ctx);
  sweepBroke(engines, next);
  checkIntegrity(next);
  return { state: next, finished: next.phase === 'results' };
}

function toLeaderRow(id: string, ledger: PlayerLedger): LeaderRow {
  return {
    id, bankroll: ledger.bankroll, penalty: ledger.penalty,
    adjusted: Math.max(0, ledger.bankroll - ledger.penalty),
    status: ledger.status, outReason: ledger.outReason,
    bankruptcies: ledger.bankruptcies, bailouts: ledger.bailouts, at: ledger.at,
  };
}

function toVault(ledger: PlayerLedger): PlayerVault {
  return {
    bankroll: ledger.bankroll, penalty: ledger.penalty, personalDeadline: ledger.personalDeadline,
    status: ledger.status, outReason: ledger.outReason, bankruptcies: ledger.bankruptcies,
    bailouts: ledger.bailouts, peak: ledger.peak, biggestWin: ledger.biggestWin,
    biggestLoss: ledger.biggestLoss, rounds: ledger.rounds, byGame: ledger.byGame,
  };
}

function toResults(state: CasinoState, rows: readonly LeaderRow[]): ResultsRow[] {
  return rows.map((row, position) => {
    const ledger = state.players[row.id]!;
    return {
      ...row, placement: position + 1, peak: ledger.peak, biggestWin: ledger.biggestWin,
      biggestLoss: ledger.biggestLoss, rounds: ledger.rounds, byGame: ledger.byGame,
    };
  });
}

export function viewCasino(engines: EngineRegistry, state: CasinoState, viewerId: string | null): PlayerView {
  const positions = new Map(state.order.map((id, position) => [id, position]));
  const players = state.order.map(id => toLeaderRow(id, state.players[id]!));
  players.sort((a, b) => state.phase === 'results'
    ? b.adjusted - a.adjusted || b.bankroll - a.bankroll || positions.get(a.id)! - positions.get(b.id)!
    : b.bankroll - a.bankroll || positions.get(a.id)! - positions.get(b.id)!);
  const tables = {} as Record<TableId, TableSummary>;
  for (const id of TABLE_IDS) {
    const summary = engines[id].summary(state.tables[id]);
    tables[id] = {
      seats: engines[id].occupants(state.tables[id]).length,
      limit: summary.limit, mode: summary.mode, info: summary.info,
      occupants: engines[id].occupants(state.tables[id]),
    };
  }
  const ledger = viewerId !== null ? state.players[viewerId] ?? null : null;
  const at = ledger?.at ?? 'floor';
  return {
    now: state.now, deadline: state.deadline, phase: state.phase,
    you: viewerId, at, players,
    results: state.phase === 'results' ? toResults(state, players) : null,
    feed: state.feed, tables,
    table: ledger !== null && at !== 'floor' ? engines[at].view(state.tables[at], viewerId) : null,
    vault: ledger !== null ? toVault(ledger) : null,
  };
}
