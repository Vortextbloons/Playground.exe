import { isRecord, normalizePartyCode, MAX_MESSAGE_BYTES, WEBSOCKET_PROTOCOL, type PartyCommand, type PartySnapshot, type MultiplayerUpdate } from '../../packages/game-kit/src/multiplayer/protocol';

export interface PartyClientState extends MultiplayerUpdate { busy: boolean; error: string; configured: boolean }
interface SavedSession { code: string; token: string; nickname: string }
const SESSION_KEY = 'playground-exe:party-session:v1';
const IDENTITY_KEY = 'playground-exe:guest-token:v1';

export class PartyClient {
  private state: PartyClientState;
  private listeners = new Set<(state: PartyClientState) => void>();
  private socket: WebSocket | null = null;
  private session: SavedSession | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retries = 0;
  private rejoinAttempted = false;
  private initialized = false;
  private sequence = 0;
  constructor(private endpoint: string) {
    this.state = { party: null, playerId: null, connected: false, busy: false, error: '', configured: !!endpoint };
  }
  subscribe(listener: (state: PartyClientState) => void) {
    this.listeners.add(listener); listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private update(change: Partial<PartyClientState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
  getUpdate(): MultiplayerUpdate {
    return { party: this.state.party, playerId: this.state.playerId, connected: this.state.connected };
  }
  initialize() {
    if (this.initialized || !this.endpoint) return;
    this.initialized = true;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
      if (isRecord(saved) && typeof saved.code === 'string' && /^\d{4}$/.test(saved.code) && typeof saved.token === 'string' && /^[a-f0-9]{64}$/.test(saved.token) && typeof saved.nickname === 'string') {
        this.session = { code: saved.code, token: saved.token, nickname: saved.nickname }; this.connect();
      }
    } catch { /* Storage can be disabled. The current tab still works. */ }
  }
  private identity() {
    try { const saved = localStorage.getItem(IDENTITY_KEY); if (saved && /^[a-f0-9]{64}$/.test(saved)) return saved; } catch { /* Use an ephemeral guest. */ }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(IDENTITY_KEY, token); } catch { /* Use an ephemeral guest. */ }
    return token;
  }
  create(nickname: string) { return this.enter(null, nickname); }
  join(code: string, nickname: string) { return this.enter(normalizePartyCode(code), nickname); }
  private async enter(code: string | null, nickname: string) {
    if (this.state.busy) return;
    if (!this.endpoint) { this.update({ error: 'Parties are unavailable on this playground.' }); return; }
    if (code !== null && !/^\d{4}$/.test(code)) { this.update({ error: 'Enter all four digits of the party code.' }); return; }
    if (!nickname.trim() || nickname.trim().length > 24) { this.update({ error: 'Choose a nickname with 1–24 characters.' }); return; }
    this.update({ busy: true, error: '' });
    try {
      const token = this.session?.token ?? this.identity();
      const response = await fetch(`${this.endpoint}/parties${code === null ? '' : `/${code}/join`}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nickname: nickname.trim() }), signal: AbortSignal.timeout(10_000),
      });
      const value: unknown = await response.json();
      if (!response.ok || !isRecord(value) || typeof value.code !== 'string') throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : 'Unable to join the party.');
      this.stop(); this.session = { code: value.code, token, nickname: nickname.trim() };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch { /* Current tab still works. */ }
      this.update({ party: null, playerId: null }); this.retries = 0; this.connect();
    } catch (error) { this.update({ busy: false, error: error instanceof Error ? error.message : 'Unable to reach the party service.' }); }
  }
  private connect() {
    if (!this.session || this.socket) return;
    const url = new URL(`${this.endpoint}/parties/${this.session.code}/socket`, location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.update({ busy: true });
    const socket = new WebSocket(url, [WEBSOCKET_PROTOCOL, this.session.token]); this.socket = socket;
    let opened = false;
    const timeout = setTimeout(() => { if (!this.state.connected) socket.close(); }, 10_000);
    socket.onopen = () => {
      opened = true; this.rejoinAttempted = false;
      clearTimeout(timeout); this.retries = 0;
      this.update({ connected: true, busy: false, error: '' });
      this.heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping'); }, 30_000);
    };
    socket.onmessage = event => {
      if (event.data === 'pong') return;
      try {
        const data: unknown = JSON.parse(String(event.data));
        if (!isRecord(data)) return;
        if (data.type === 'error' && typeof data.message === 'string') this.update({ error: data.message });
        if (data.type === 'snapshot' && isRecord(data.party) && typeof data.playerId === 'string') {
          const party = data.party as unknown as PartySnapshot;
          if (party.match?.id !== this.state.party?.match?.id) this.sequence = party.nextSequence;
          else this.sequence = Math.max(this.sequence, party.nextSequence);
          this.update({ party, playerId: data.playerId, error: '' });
        }
      } catch { this.update({ error: 'Unexpected response from the party service.' }); }
    };
    socket.onclose = event => {
      clearTimeout(timeout); if (this.socket !== socket) return;
      this.socket = null; clearInterval(this.heartbeat);
      this.update({ connected: false, busy: false });
      if (event.code === 4004) { this.forget(); this.update({ party: null, playerId: null, error: 'This party expired. Create or join another party.' }); return; }
      if (event.code === 4001) { this.update({ error: 'Your party is open in another tab. Reconnect here to move it back.' }); return; }
      if (!opened && this.session && !this.rejoinAttempted) {
        // A socket that never opened usually means the seat was released; re-joining restores it.
        this.rejoinAttempted = true;
        void this.join(this.session.code, this.session.nickname);
        return;
      }
      if (++this.retries > 6) { this.update({ error: 'Connection lost. Reconnect, or rejoin with the party code if your seat expired.' }); return; }
      this.update({ error: 'Connection lost. Reconnecting…' });
      this.retryTimer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** (this.retries - 1), 10_000));
    };
    socket.onerror = () => { /* onclose supplies reconnect feedback. */ };
  }
  send(command: PartyCommand) { this.sendCommands([command]); }
  sendCommands(commands: PartyCommand[]) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) { this.update({ error: 'Reconnect before sending an action.' }); return; }
    const sequenced = commands.map(command => command.type === 'action' ? { ...command, sequence: this.sequence++ } : command);
    const message = JSON.stringify(sequenced.length === 1 ? sequenced[0] : { type: 'batch', commands: sequenced });
    if (new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) { this.update({ error: 'That action is too large.' }); return; }
    this.socket.send(message);
  }
  retry() {
    if (!this.session) return;
    const { code, nickname } = this.session;
    this.stop(); this.update({ busy: false, connected: false });
    void this.join(code, nickname);
  }
  leave() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'leave' }));
    this.stop(); this.forget();
    this.update({ party: null, playerId: null, connected: false, busy: false, error: '' });
  }
  private forget() { this.session = null; try { localStorage.removeItem(SESSION_KEY); } catch { /* Storage disabled. */ } }
  private stop() {
    clearTimeout(this.retryTimer); clearInterval(this.heartbeat);
    const socket = this.socket; this.socket = null; socket?.close();
  }
}
let client: PartyClient | undefined;
export function getPartyClient() {
  if (typeof window === 'undefined') throw new Error('Party client is only available in the browser.');
  let endpoint = import.meta.env.PUBLIC_PARTY_API_URL?.replace(/\/$/, '') ?? '';
  if (!endpoint && import.meta.env.DEV) endpoint = 'http://localhost:8787/api';
  return client ??= new PartyClient(endpoint);
}
