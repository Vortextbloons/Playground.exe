import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import type { Json, PartyCommand, PartySnapshot, ServerMessage } from '../packages/game-kit/src/multiplayer/protocol';
import { WEBSOCKET_PROTOCOL } from '../packages/game-kit/src/multiplayer/protocol';

const endpoint = process.env.PARTY_TEST_URL ?? 'http://127.0.0.1:8787';
const origin = 'http://localhost:4321';
const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const peers: Peer[] = [];

class Peer {
  ws: WebSocket;
  party: PartySnapshot | null = null;
  id = '';
  lastActionAt = 0;
  private listeners = new Set<() => void>();
  errors: string[] = [];
  constructor(code: string, token: string) {
    this.ws = new WebSocket(`${endpoint.replace('http', 'ws')}/api/parties/${code}/socket`, [WEBSOCKET_PROTOCOL, token], { origin });
    this.ws.on('message', bytes => {
      const message = JSON.parse(String(bytes)) as ServerMessage;
      if (message.type === 'snapshot') { this.party = message.party; this.id = message.playerId; }
      else this.errors.push(message.message);
      for (const listener of this.listeners) listener();
    });
    this.ws.on('error', error => { this.errors.push(error.message); for (const listener of this.listeners) listener(); });
    peers.push(this);
  }
  wait(predicate: () => boolean, description: string): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.listeners.delete(check); reject(new Error(`Timeout: ${description}; errors=${this.errors.join(', ')}`)); }, 7000);
      const check = () => { if (predicate()) { clearTimeout(timeout); this.listeners.delete(check); resolve(); } };
      this.listeners.add(check);
    });
  }
  send(command: PartyCommand) { this.ws.send(JSON.stringify(command)); }
  action(action: string, payload: Json = null, sequence = this.party!.nextSequence) {
    this.send({ type: 'action', matchId: this.party!.match!.id, action, payload, sequence });
  }
}

type TableInfo = { seats: number; limit: number; occupants: string[]; info: Record<string, unknown> };

type AllInView = {
  you: string | null;
  deadline: number;
  phase: string;
  vault: { bankroll: number; status: string; rounds: number } | null;
  players: { id: string; bankroll: number; status: string }[];
  tables: { blackjack: TableInfo; roulette: TableInfo; slots: TableInfo; plinko: TableInfo; poker: TableInfo };
  table: Record<string, unknown> | null;
  feed: { kind: string }[];
};

const viewOf = (peer: Peer) => peer.party!.match!.state as unknown as AllInView;
const bankrollOf = (peer: Peer, id: string) => viewOf(peer).players.find(row => row.id === id)?.bankroll;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function act(peer: Peer, action: string, payload: Json = null) {
  const gap = 420 - (Date.now() - peer.lastActionAt);
  if (gap > 0) await sleep(gap);
  peer.lastActionAt = Date.now();
  const before = peer.party!.match!.revision;
  peer.action(action, payload);
  await peer.wait(() => peer.party!.match!.revision > before, `${action} applied; errors=${peer.errors.join(', ')}`);
}

function fiveArrays(value: unknown): number[][] {
  if (Array.isArray(value)) {
    if (value.length === 5 && value.every(item => typeof item === 'number')) return [value as number[]];
    return value.flatMap(fiveArrays);
  }
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(fiveArrays);
  return [];
}

async function enter(token: string, nickname: string, code?: string) {
  const response = await fetch(`${endpoint}/api/parties${code ? `/${code}/join` : ''}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nickname }), signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json() as { code: string }).code;
}

try {
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  const code = await enter(tokens[0]!, 'Host');
  const host = new Peer(code, tokens[0]!);
  await host.wait(() => !!host.party, 'host connection');
  await enter(tokens[1]!, 'Guest', code);
  const guest = new Peer(code, tokens[1]!);
  await guest.wait(() => !!guest.party, 'guest connection');

  host.send({ type: 'select', gameId: 'all-in', modeId: 'casino' });
  await host.wait(() => host.party?.selection?.gameId === 'all-in', 'mode selection');
  for (const peer of [host, guest]) { peer.send({ type: 'seat', playing: true }); }
  await host.wait(() => host.party?.players.filter(player => player.role === 'player').length === 2, 'seats');
  for (const peer of [host, guest]) { peer.send({ type: 'ready', ready: true }); }
  await host.wait(() => !!host.party?.players.filter(player => player.role === 'player').every(player => player.ready), 'ready checks');
  host.send({ type: 'start' });
  await host.wait(() => host.party?.match?.status === 'playing', 'match start');
  await guest.wait(() => guest.party?.match?.id === host.party?.match?.id, 'guest match');

  const startedAt = host.party!.match!.startedAt;
  assert.equal(viewOf(host).you, host.id);
  assert.equal(viewOf(guest).you, guest.id);
  assert.equal(viewOf(host).vault!.bankroll, 1000);
  assert.equal(viewOf(guest).vault!.bankroll, 1000);
  assert.equal(viewOf(host).deadline, startedAt + 600_000, 'shared deadline from the server clock');
  console.log('PASS all-in start: personal views, shared deadline, $1,000 each over the wire');

  await act(host, 'sit', { at: 'slots' });
  await act(host, 'spin', { bet: 1 });
  const afterSpin = bankrollOf(host, host.id)!;
  assert.ok(afterSpin >= 999 && afterSpin <= 1039, `slots bankroll ${afterSpin}`);
  assert.equal(bankrollOf(guest, guest.id), 1000);
  await guest.wait(() => viewOf(guest).tables.slots.occupants.includes(host.id), 'guest sees host at slots');
  assert.equal(viewOf(guest).tables.slots.seats, 1);
  assert.deepEqual(viewOf(guest).tables.slots.occupants, [host.id]);
  console.log('PASS all-in slots: server-authoritative spin, ledger routing, live occupancy for other players');

  await act(host, 'sit', { at: 'roulette' });
  const beforeRoulette = bankrollOf(host, host.id)!;
  await act(host, 'bet', { kind: 'red', numbers: RED, amount: 10 });
  await act(host, 'spin', null);
  const afterRoulette = bankrollOf(host, host.id)!;
  assert.ok(afterRoulette === beforeRoulette - 10 || afterRoulette === beforeRoulette + 10, `roulette delta ${afterRoulette - beforeRoulette}`);
  const hostTable = viewOf(host).table as { wheel: { last: number | null } };
  assert.ok(hostTable.wheel.last !== null && hostTable.wheel.last >= 0 && hostTable.wheel.last <= 36);
  await guest.wait(() => viewOf(guest).tables.roulette.info.last !== null, 'guest sees roulette outcome');
  assert.equal(viewOf(guest).tables.roulette.info.last, hostTable.wheel.last, 'wheel outcome is public');
  console.log('PASS all-in roulette: solo spin, correct odds, public wheel outcome for the whole party');

  await act(host, 'sit', { at: 'poker' });
  await act(host, 'deal', { coins: 1 });
  await guest.wait(() => viewOf(guest).tables.poker.occupants.length >= 1, 'guest sees poker occupancy');
  const hostDetail = viewOf(host).table as { you: { video: { cards: number[] } | null } };
  const hostCards = hostDetail.you.video!.cards;
  assert.equal(hostCards.length, 5);
  const guestSets = fiveArrays(viewOf(guest)).map(cards => [...cards].sort((a, b) => a - b).join(','));
  assert.ok(!guestSets.includes([...hostCards].sort((a, b) => a - b).join(',')), 'hole cards leaked into a party snapshot');
  console.log('PASS all-in poker: private video hand never appears in another player\'s snapshot');

  await enter(tokens[2]!, 'Late', code);
  const late = new Peer(code, tokens[2]!);
  await late.wait(() => !!late.party, 'late connection');
  late.action('spin', { bet: 1 });
  await late.wait(() => late.errors.some(error => error.includes('Spectators')), 'spectator denied');
  late.send({ type: 'seat', playing: true });
  await late.wait(() => (viewOf(late).players ?? []).length === 3, 'late join reconcile');
  assert.equal(viewOf(late).vault!.bankroll, 1000);
  assert.equal(viewOf(late).deadline, startedAt + 600_000, 'late joiners share the original deadline');
  await host.wait(() => viewOf(host).players.length === 3, 'host sees the late joiner');
  assert.equal(viewOf(host).players.length, 3);
  console.log('PASS all-in late join: spectators denied actions, seated mid-match with $1,000 and the same deadline');

  const guestId = guest.id;
  const matchId = guest.party!.match!.id;
  guest.ws.terminate();
  await host.wait(() => host.party?.players.find(player => player.id === guestId)?.connected === false, 'guest disconnect');
  const restored = new Peer(code, tokens[1]!);
  await restored.wait(() => !!restored.party, 'guest reconnect');
  assert.equal(restored.id, guestId, 'same player id after reconnect');
  assert.equal(restored.party!.match!.id, matchId, 'same match after reconnect');
  assert.equal(viewOf(restored).vault!.bankroll, 1000, 'bankroll preserved across reconnect');
  assert.equal(viewOf(restored).you, guestId);
  console.log('PASS all-in reconnect: same seat, same match, bankroll preserved');

  for (const peer of [host, restored, late]) peer.send({ type: 'leave' });
} finally {
  for (const peer of peers) peer.ws.close();
}
