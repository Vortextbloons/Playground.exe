import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import type { PartyCommand, PartySnapshot, ServerMessage } from '../packages/game-kit/src/multiplayer/protocol';
import { WEBSOCKET_PROTOCOL } from '../packages/game-kit/src/multiplayer/protocol';

const endpoint = process.env.PARTY_TEST_URL ?? 'http://127.0.0.1:8787';
const origin = 'http://localhost:4321';
const peers: Peer[] = [];
class Peer {
  ws: WebSocket;
  party: PartySnapshot | null = null;
  id = '';
  private listeners = new Set<() => void>();
  errors: string[] = [];
  pong = false;
  constructor(code: string, token: string) {
    this.ws = new WebSocket(`${endpoint.replace('http', 'ws')}/api/parties/${code}/socket`, [WEBSOCKET_PROTOCOL, token], { origin });
    this.ws.on('message', bytes => {
      if (String(bytes) === 'pong') { this.pong = true; for (const listener of this.listeners) listener(); return; }
      const message = JSON.parse(String(bytes)) as ServerMessage;
      if (message.type === 'snapshot') { this.party = message.party; this.id = message.playerId; }
      else this.errors.push(message.message);
      for (const listener of this.listeners) listener();
    });
    this.ws.on('error', error => { this.errors.push(error.message); for (const listener of this.listeners) listener(); });
    this.ws.on('unexpected-response', (_request, response) => {
      let body = ''; response.on('data', chunk => { body += String(chunk); });
      response.on('end', () => { this.errors.push(`HTTP ${response.statusCode}: ${body}`); for (const listener of this.listeners) listener(); });
    });
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
  action(action: string, sequence = this.party!.nextSequence) { this.send({ type: 'action', matchId: this.party!.match!.id, action, payload: null, sequence }); }
}
async function enter(token: string, nickname: string, code?: string) {
  const response = await fetch(`${endpoint}/api/parties${code ? `/${code}/join` : ''}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nickname }), signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json() as { code: string }).code;
}
try {
  const denied = await fetch(`${endpoint}/api/parties`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  const code = await enter(tokens[0]!, 'Host'); assert.match(code, /^\d{4}$/);
  const host = new Peer(code, tokens[0]!); await host.wait(() => !!host.party, 'host connection');
  await enter(tokens[1]!, 'Guest', code); const guest = new Peer(code, tokens[1]!);
  await guest.wait(() => !!guest.party, 'guest connection');
  await enter(tokens[2]!, 'Viewer', code); const viewer = new Peer(code, tokens[2]!);
  await host.wait(() => host.party?.players.length === 3, 'party membership');
  await viewer.wait(() => !!viewer.party, 'viewer connection');
  assert.ok(!JSON.stringify(host.party).includes(tokens[0]!));
  const hostId = host.id;
  for (const mode of ['turns', 'challenge', 'live']) {
    await new Promise(resolve => setTimeout(resolve, 1100));
    host.send({ type: 'return' }); await host.wait(() => !host.party?.match, 'return to lobby');
    host.send({ type: 'select', gameId: 'pocket-circuit', modeId: mode });
    await host.wait(() => host.party?.selection?.modeId === mode, 'mode selection');
    host.send({ type: 'seat', playing: true }); guest.send({ type: 'seat', playing: true });
    await host.wait(() => host.party?.players.filter(player => player.role === 'player').length === 2, 'seats');
    host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true });
    await host.wait(() => !!host.party?.players.filter(player => player.role === 'player').every(player => player.ready), 'ready checks');
    host.send({ type: 'start' }); await host.wait(() => host.party?.match?.status === 'playing', 'start');
    await guest.wait(() => guest.party?.match?.id === host.party?.match?.id, 'guest match');
    await viewer.wait(() => viewer.party?.match?.id === host.party?.match?.id, 'spectator match');
    viewer.action('warm'); await viewer.wait(() => viewer.errors.some(error => error.includes('Spectators')), 'spectator denied');
    host.action('warm'); guest.action('warm');
    await host.wait(() => host.party?.match?.phase === 'shared', 'individual-to-shared transition');
    const revision = host.party!.match!.revision;
    host.action('warm', 0); // Duplicate from this match must be ignored, including after batching.
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(host.party!.match!.revision, revision);
    if (mode === 'live') {
      host.send({ type: 'action', matchId: host.party!.match!.id, action: 'move', payload: 1, sequence: host.party!.nextSequence });
      await host.wait(() => host.party!.match!.revision > revision, 'live move');
    } else if (mode === 'challenge') {
      host.action('advance'); guest.action('advance');
      await host.wait(() => host.party!.match!.revision === revision + 2, 'batched shared actions');
    }
    console.log(`PASS ${mode}: host selection, ready checks, private practice, shared round, spectators and deduplication`);
  }
  const matchId = host.party!.match!.id;
  host.ws.terminate(); await guest.wait(() => guest.party?.players.find(player => player.id === hostId)?.connected === false, 'reconnect reservation');
  assert.equal(guest.party!.hostId, hostId);
  const restored = new Peer(code, tokens[0]!);
  await restored.wait(() => !!restored.party, 'reconnect');
  assert.equal(restored.id, hostId); assert.equal(restored.party!.match!.id, matchId);
  assert.equal(restored.party!.hostId, hostId);
  restored.ws.send('ping');
  await restored.wait(() => restored.pong, 'hibernation heartbeat auto-response');
  restored.send({ type: 'leave' }); await guest.wait(() => !guest.party?.players.some(player => player.id === hostId), 'leave removes seat');
  assert.equal(guest.party!.hostId, guest.id);
  console.log('PASS reconnect: same guest, same round, host handoff, heartbeat and explicit leave');
  guest.send({ type: 'leave' }); viewer.send({ type: 'leave' });
} finally { for (const peer of peers) peer.ws.close(); }
