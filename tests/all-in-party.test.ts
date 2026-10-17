import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, connectPlayer, createRoom, joinRoom, reconcileMatch, snapshot, type Registry, type RoomState } from '../workers/party/engine';
import definition from '../games/all-in/src/multiplayer';
import { parseMultiplayer } from '../packages/game-kit/src/multiplayer/protocol';
import { MATCH_MS } from '../games/all-in/src/core/economy.ts';
import type { PlayerView } from '../games/all-in/src/core/types.ts';
import type { PokerView } from '../games/all-in/src/games/poker.ts';
import { createHybridHost, type PartySession } from '../games/all-in/src/host/hybrid.ts';

const multiplayer = parseMultiplayer({ modes: [{ id: 'casino', label: 'Casino', minPlayers: 1, maxPlayers: 16, preset: 'turn-based', spectators: true, lateJoin: 'join' }] });
const games: Registry = { 'all-in': { id: 'all-in', title: 'ALL IN!', multiplayer, definition } };

const T0 = 1_000_000;

test('the casino blocks local play while waiting in a party lobby', () => {
  let refresh = () => {};
  const session: PartySession = {
    current: { party: null, playerId: null, connected: true, match: null, isPlayer: false },
    subscribe(listener) { refresh = () => listener(session.current); return () => {}; },
    send() { return true; },
  };
  const host = createHybridHost(session);
  assert.equal(host.send('sit', { at: 'slots' }), true);
  const { room, host: playerId } = fixture();
  session.current.party = snapshot(room, playerId, games);
  refresh();
  host.subscribe(status => {
    assert.equal(status.waitingForParty, true);
    assert.equal(status.playing, false);
    assert.equal(status.view.vault, null);
  })();
  assert.equal(host.send('spin', { bet: 1 }), false);
  assert.equal(host.send('again', null), false);
  session.current.party = null;
  refresh();
  assert.equal(host.send('again', null), true);
});

function fixture(count = 2) {
  const room = createRoom('9001', T0);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = joinRoom(room, `token-${index}`, `Player ${index}`, T0);
    connectPlayer(room, id, T0);
    ids.push(id);
  }
  return { room, ids, host: ids[0]!, guest: ids[1]! };
}

function start(room: RoomState, ids: readonly string[], at = T0 + 1) {
  applyCommand(room, ids[0]!, { type: 'select', gameId: 'all-in', modeId: 'casino' }, games, at);
  for (const id of ids) {
    applyCommand(room, id, { type: 'seat', playing: true }, games, at);
    applyCommand(room, id, { type: 'ready', ready: true }, games, at);
  }
  applyCommand(room, ids[0]!, { type: 'start' }, games, at);
}

const act = (room: RoomState, id: string, action: string, payload: unknown, sequence: number, at: number) =>
  applyCommand(room, id, { type: 'action', matchId: room.match!.id, action, payload: payload as never, sequence }, games, at);

const viewFor = (room: RoomState, id: string) => snapshot(room, id, games).match!.state as PlayerView;

function fiveArrays(value: unknown): number[][] {
  if (Array.isArray(value)) {
    if (value.length === 5 && value.every(item => typeof item === 'number')) return [value as number[]];
    return value.flatMap(fiveArrays);
  }
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(fiveArrays);
  return [];
}

test('a party match starts with personal views, a shared deadline, and $1,000 each', () => {
  const { room, host, guest } = fixture();
  start(room, [host, guest]);
  assert.equal(room.match!.status, 'playing');
  const hostView = viewFor(room, host);
  const guestView = viewFor(room, guest);
  assert.equal(hostView.you, host);
  assert.equal(guestView.you, guest);
  assert.equal(hostView.vault!.bankroll, 1000);
  assert.equal(guestView.vault!.bankroll, 1000);
  assert.equal(hostView.deadline, T0 + 1 + MATCH_MS);
  assert.equal(hostView.players.length, 2);
});

test('slot spins route through the server and pay into the right ledger', () => {
  const { room, host, guest } = fixture();
  start(room, [host, guest]);
  assert.equal(act(room, host, 'sit', { at: 'slots' }, 0, T0 + 2), true);
  act(room, host, 'spin', { bet: 1 }, 1, T0 + 3);
  const view = viewFor(room, host);
  const mine = view.players.find(row => row.id === host)!;
  const theirs = view.players.find(row => row.id === guest)!;
  assert.ok(mine.bankroll >= 999 && mine.bankroll <= 1039, `bankroll ${mine.bankroll}`);
  assert.equal(theirs.bankroll, 1000);
  assert.equal(view.vault!.rounds, 1);
  assert.equal(view.players.length, 2);
});

test('poker hole cards stay private to their owner', () => {
  const { room, host, guest } = fixture();
  start(room, [host, guest]);
  act(room, host, 'sit', { at: 'poker' }, 0, T0 + 2);
  act(room, host, 'deal', { coins: 1 }, 1, T0 + 3);
  act(room, guest, 'sit', { at: 'poker' }, 0, T0 + 4);
  const hostDetail = viewFor(room, host).table as PokerView;
  const guestDetail = viewFor(room, guest).table as PokerView;
  const hostCards = hostDetail.you.video!.cards;
  assert.equal(hostCards.length, 5);
  const guestSets = fiveArrays(guestDetail).map(cards => [...cards].sort((a, b) => a - b).join(','));
  assert.ok(!guestSets.includes([...hostCards].sort((a, b) => a - b).join(',')), 'host cards leaked into guest view');
  act(room, guest, 'deal', { coins: 1 }, 1, T0 + 5);
  const guestDetail2 = viewFor(room, guest).table as PokerView;
  const guestCards = guestDetail2.you.video!.cards;
  assert.equal(guestCards.length, 5);
  assert.notDeepEqual([...guestCards].sort((a, b) => a - b), [...hostCards].sort((a, b) => a - b));
});

test('late joiners get a fresh bankroll inside the running match', () => {
  const { room, host, guest } = fixture();
  start(room, [host, guest]);
  const late = joinRoom(room, 'late-token', 'Late', T0 + 30_000);
  connectPlayer(room, late, T0 + 30_000);
  applyCommand(room, late, { type: 'seat', playing: true }, games, T0 + 30_000);
  reconcileMatch(room, games, T0 + 30_000);
  const lateView = viewFor(room, late);
  assert.equal(lateView.you, late);
  assert.equal(lateView.vault!.bankroll, 1000);
  assert.equal(lateView.players.length, 3);
  assert.equal(lateView.deadline, T0 + 1 + MATCH_MS);
});

test('the shared deadline settles the match into ranked results', () => {
  const { room, host, guest } = fixture();
  start(room, [host, guest]);
  act(room, host, 'sit', { at: 'roulette' }, 0, T0 + 2);
  act(room, host, 'bet', { kind: 'red', numbers: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36], amount: 10 }, 1, T0 + 3);
  act(room, host, 'tick', null, 2, T0 + 1 + MATCH_MS);
  assert.equal(room.match!.status, 'finished');
  const final = viewFor(room, guest);
  assert.equal(final.phase, 'results');
  assert.ok(final.results!.length >= 2);
  for (let index = 1; index < final.results!.length; index += 1) {
    assert.ok(final.results![index - 1]!.adjusted >= final.results![index]!.adjusted);
  }
  assert.throws(() => act(room, guest, 'tick', null, 0, T0 + 2 + MATCH_MS), /ended/);
});

test('leaving a match marks the run as left and keeps the ledger for results', () => {
  const { room, host, guest } = fixture();
  start(room, [host, guest]);
  act(room, guest, 'sit', { at: 'blackjack' }, 0, T0 + 2);
  act(room, guest, 'bet', { amount: 50 }, 1, T0 + 3);
  applyCommand(room, guest, { type: 'leave' }, games, T0 + 4);
  reconcileMatch(room, games, T0 + 4);
  const view = viewFor(room, host);
  const row = view.players.find(player => player.id === guest)!;
  assert.equal(row.status, 'out');
  assert.equal(row.outReason, 'left');
  assert.ok(row.bankroll >= 950 && row.bankroll <= 1050, `bankroll ${row.bankroll}`);
  assert.equal(view.vault!.bankroll, 1000);
});

test('a full 16-player match stays under the 32 KB state budget', () => {
  const { room, ids } = fixture(16);
  start(room, ids);
  for (let index = 0; index < 8; index += 1) {
    const id = ids[index]!;
    const at = T0 + 10 + index;
    act(room, id, 'sit', { at: 'slots' }, 0, at);
    act(room, id, 'spin', { bet: 1 }, 1, at + 1);
  }
  for (let index = 8; index < 16; index += 1) {
    const id = ids[index]!;
    const at = T0 + 30 + index;
    act(room, id, 'sit', { at: 'plinko' }, 0, at);
    act(room, id, 'drop', { bet: 1, risk: 'low' }, 1, at + 1);
  }
  const size = JSON.stringify(room.match!.state).length;
  assert.ok(size < 32_768, `state ${size} bytes`);
  assert.equal(viewFor(room, ids[0]!).players.length, 16);
});
