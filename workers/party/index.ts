import { DurableObject } from 'cloudflare:workers';
import { games } from './registry.generated';
import { applyCommand, connectPlayer, createRoom, disconnectPlayer, expireDisconnected, joinRoom, parseCommand, reconcileMatch, selectedMode, snapshot, type RoomState } from './engine';
import { isRecord, MAX_MESSAGE_BYTES, NETWORK_PRESETS, PARTY_IDLE_MS, PARTY_MAX_AGE_MS, RECONNECT_GRACE_MS, WEBSOCKET_PROTOCOL, type PartyCommand, type ServerMessage } from '../../packages/game-kit/src/multiplayer/protocol';

interface Attachment { playerId: string; window: number; count: number }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function hashToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('Expected JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body.');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024) throw new Error('Request is too large.'); chunks.push(value); }
  } finally { await reader.cancel(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  const value: unknown = JSON.parse(new TextDecoder().decode(buffer));
  if (!isRecord(value)) throw new Error('Invalid request.');
  return value;
}

export class PartyRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  private pending: { ws: WebSocket; playerId: string; command: PartyCommand }[] = [];
  private batching = false;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS party (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL)');
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM party WHERE id = 1').toArray()[0];
    if (row) this.room = JSON.parse(row.data) as RoomState;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private save(room: RoomState) {
    if (!this.room) this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS party (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL)');
    this.ctx.storage.sql.exec('INSERT INTO party(id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', JSON.stringify(room));
    this.room = room;
  }
  private async schedule() {
    if (!this.room) return;
    const room = this.room;
    const next = Math.min(room.createdAt + PARTY_MAX_AGE_MS, room.touchedAt + PARTY_IDLE_MS,
      ...room.players.filter(player => !player.connected).map(player => (player.disconnectedAt ?? Date.now()) + RECONNECT_GRACE_MS));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }
  private send(ws: WebSocket, message: ServerMessage) {
    try { ws.send(JSON.stringify(message)); } catch { /* Close handler handles disconnected clients. */ }
  }
  private broadcast() {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      if (this.room.players.some(player => player.id === attachment.playerId)) {
        this.send(ws, { type: 'snapshot', party: snapshot(this.room, attachment.playerId, games), playerId: attachment.playerId });
      }
    }
  }
  async join(code: string, hash: string, nickname: string, create: boolean): Promise<{ ok: boolean; message?: string }> {
    const now = Date.now();
    if (this.room && (now >= this.room.createdAt + PARTY_MAX_AGE_MS || now >= this.room.touchedAt + PARTY_IDLE_MS)) await this.clear();
    if (create && this.room) return { ok: false };
    if (!create && !this.room) return { ok: false, message: 'Party not found or expired. Check the four-digit code.' };
    const room = structuredClone(this.room ?? createRoom(code, now));
    expireDisconnected(room, now);
    try { const id = joinRoom(room, hash, nickname, now); if (!room.hostId) room.hostId = id; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Unable to join.' }; }
    reconcileMatch(room, games, now); this.save(room); await this.schedule();
    return { ok: true };
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required.' }, 426);
    const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(item => item.trim()) ?? [];
    const token = protocols[1];
    if (protocols[0] !== WEBSOCKET_PROTOCOL || !token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: 'Invalid guest session.' }, 401);
    const hash = await hashToken(token);
    if (!this.room) return json({ error: 'Party expired. Join again.' }, 404);
    const now = Date.now();
    if (now >= this.room.touchedAt + PARTY_IDLE_MS || now >= this.room.createdAt + PARTY_MAX_AGE_MS) { await this.clear(); return json({ error: 'Party expired.' }, 404); }
    const room = structuredClone(this.room);
    expireDisconnected(room, now);
    const id = Object.entries(room.credentials).find(([, credential]) => credential === hash)?.[0];
    if (!id) return json({ error: 'Join the party first.' }, 401);
    const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: id, window: 0, count: 0 } satisfies Attachment);
    for (const other of this.ctx.getWebSockets()) {
      if (other !== server && (other.deserializeAttachment() as Attachment).playerId === id) other.close(4001, 'Party opened in another tab.');
    }
    connectPlayer(room, id, now); reconcileMatch(room, games, now); this.save(room); this.broadcast(); await this.schedule();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': WEBSOCKET_PROTOCOL } });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) { ws.close(1009, 'Message too large.'); return; }
    if (!this.room) { ws.close(4004, 'Party expired.'); return; }
    const now = Date.now();
    if (now >= this.room.createdAt + PARTY_MAX_AGE_MS || now >= this.room.touchedAt + PARTY_IDLE_MS) { await this.clear(); return; }
    const attachment = ws.deserializeAttachment() as Attachment;
    try {
      const raw: unknown = JSON.parse(message);
      const commands = isRecord(raw) && raw.type === 'batch' && Array.isArray(raw.commands) ? raw.commands : [raw];
      if (!commands.length || commands.length > 8) throw new Error('Send at most eight actions together.');
      const parsed = commands.map(parseCommand);
      if (parsed.length > 1 && parsed.some(command => command.type !== 'action')) throw new Error('Only game actions may be batched.');
      const mode = selectedMode(this.room, games);
      const limit = mode ? NETWORK_PRESETS[mode.preset].actionsPerSecond : 8;
      const window = Math.floor(now / 1000);
      attachment.count = (attachment.window === window ? attachment.count : 0) + parsed.length;
      attachment.window = window; ws.serializeAttachment(attachment);
      if (attachment.count > limit + 4) throw new Error('Too many actions. Slow down briefly.');
      if (mode && mode.preset !== 'turn-based' && parsed.every(command => command.type === 'action')) {
        if (this.pending.length + parsed.length > 128) throw new Error('The game is busy. Try your action again.');
        this.pending.push(...parsed.map(command => ({ ws, playerId: attachment.playerId, command })));
        if (!this.batching) { this.batching = true; this.ctx.waitUntil(this.flushActions(NETWORK_PRESETS[mode.preset].intervalMs)); }
        return;
      }
      const room = structuredClone(this.room); expireDisconnected(room, now);
      let changed = false;
      for (const command of parsed) changed = applyCommand(room, attachment.playerId, command, games, now) || changed;
      if (changed) { reconcileMatch(room, games, now); this.save(room); this.broadcast(); }
      if (parsed.some(command => command.type === 'leave')) ws.close(1000, 'Left party.');
      await this.schedule();
    } catch (error) { this.send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Action failed.' }); }
  }
  private async flushActions(interval: number) {
    // A bounded timer exists only while actions are awaiting acknowledgement.
    // All players share one durable write/broadcast per update window.
    await new Promise(resolve => setTimeout(resolve, interval));
    this.batching = false;
    const pending = this.pending.splice(0);
    if (!this.room) return;
    let room = structuredClone(this.room); let changed = false;
    for (const item of pending) {
      try {
        const working = structuredClone(room);
        if (applyCommand(working, item.playerId, item.command, games, Date.now())) { room = working; changed = true; }
      } catch (error) { this.send(item.ws, { type: 'error', message: error instanceof Error ? error.message : 'Action failed.' }); }
    }
    if (changed) { reconcileMatch(room, games, Date.now()); this.save(room); this.broadcast(); await this.schedule(); }
  }
  async webSocketClose(ws: WebSocket) { await this.disconnected(ws); }
  async webSocketError(ws: WebSocket) { await this.disconnected(ws); }
  private async disconnected(ws: WebSocket) {
    if (!this.room) return;
    const { playerId } = ws.deserializeAttachment() as Attachment;
    if (this.ctx.getWebSockets().some(other => other !== ws && other.readyState === 1 && (other.deserializeAttachment() as Attachment).playerId === playerId)) return;
    const room = structuredClone(this.room);
    disconnectPlayer(room, playerId, Date.now(), games); reconcileMatch(room, games, Date.now()); this.save(room); this.broadcast(); await this.schedule();
  }
  private async clear() {
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'Party expired. Create or join another party.');
    await this.ctx.storage.deleteAll(); this.room = null;
  }
  async alarm() {
    if (!this.room) return;
    const now = Date.now();
    if (now >= this.room.createdAt + PARTY_MAX_AGE_MS || now >= this.room.touchedAt + PARTY_IDLE_MS) { await this.clear(); return; }
    const room = structuredClone(this.room);
    if (expireDisconnected(room, now)) { reconcileMatch(room, games, now); this.save(room); this.broadcast(); }
    await this.schedule();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const allowed = [url.origin, ...env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)];
    if (!origin || !allowed.includes(origin)) return json({ error: 'This origin cannot access parties.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    const { success } = await env.PARTY_REQUESTS.limit({ key: ip });
    if (!success) return new Response(JSON.stringify({ error: 'Too many join attempts. Try again in a minute.' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' } });
    try {
      const socketRoute = /^\/api\/parties\/(\d{4})\/socket$/.exec(url.pathname);
      if (socketRoute && request.method === 'GET') return env.PARTIES.getByName(socketRoute[1]!).fetch(request);
      const joinRoute = /^\/api\/parties\/(\d{4})\/join$/.exec(url.pathname);
      const creating = url.pathname === '/api/parties';
      if (request.method !== 'POST' || (!creating && !joinRoute)) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
      const body = await readBody(request);
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new Error('Invalid guest identity.');
      if (typeof body.nickname !== 'string' || !body.nickname.trim() || body.nickname.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(body.nickname)) throw new Error('Choose a nickname with 1–24 characters.');
      const hash = await hashToken(body.token);
      let code = joinRoute?.[1] ?? '';
      for (let attempt = 0; attempt < (creating ? 12 : 1); attempt++) {
        if (creating) code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10_000).padStart(4, '0');
        const result = await env.PARTIES.getByName(code).join(code, hash, body.nickname.trim(), creating);
        if (result.ok) return new Response(JSON.stringify({ code }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        if (result.message) return new Response(JSON.stringify({ error: result.message }), { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'No party code available. Try again shortly.' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Party service unavailable.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  },
} satisfies ExportedHandler<Env>;
