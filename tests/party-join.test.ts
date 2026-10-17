import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PartyClient } from '../src/lib/party';
import { readFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';
import { transpile } from 'typescript';

test('game player waits for party restoration and only loads the selected party game', async () => {
  const source = await readFile(new URL('../src/components/GamePlayer.svelte', import.meta.url), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)![1]!;
  const code = transpile(script.replace(/^\s*import .*;$/gm, '').replaceAll('import.meta.env.DEV', 'false'));
  let listener: (value: any) => void = () => {};
  let mount: () => void = () => {};
  let state: any = { party: null, playerId: null, connected: false, busy: false };
  const client = {
    initialize() { state = { ...state, busy: true }; },
    subscribe(callback: typeof listener) { listener = callback; callback(state); return () => {}; },
  };
  const redirects: string[] = [];
  const run = new Function('onMount', '$state', '$props', 'getPartyClient', 'readLocal', 'window', `${code}; return () => activeSrc;`);
  const getSrc = run((callback: typeof mount) => mount = callback, Object.assign((value: unknown) => value, { raw: (value: unknown) => value }), () => ({ id: 'test-game', title: 'Test', src: '/game.html', base: '/', config: { modes: [] } }), () => client, (_key: string, fallback: unknown) => fallback, { location: { assign: (url: string) => redirects.push(url) }, setTimeout() {} });
  mount();
  assert.equal(getSrc(), undefined, 'restoring a lobby must not launch solo play');
  listener({ ...state, busy: false, connected: true });
  assert.equal(getSrc(), undefined, 'wait for the first party snapshot');
  listener({ ...state, busy: false, connected: false, error: 'Connection lost' });
  assert.equal(getSrc(), undefined, 'failed restoration must not launch solo play');
  const party = { selection: null };
  listener({ ...state, party, busy: false, connected: true });
  assert.equal(getSrc(), undefined, 'a lobby without a selection must not launch a game');
  listener({ ...state, party: { selection: { gameId: 'other-game' } }, busy: false, connected: true });
  assert.equal(getSrc(), undefined);
  assert.equal(redirects.at(-1), '/play/other-game/');
  listener({ ...state, party: { selection: { gameId: 'test-game' } }, busy: false, connected: true });
  assert.equal(getSrc(), '/game.html');
  listener({ ...state, party, busy: false, connected: true });
  assert.equal(getSrc(), undefined, 'returning to the lobby unloads the game');
  listener({ ...state, party: null, busy: false, connected: false });
  assert.equal(getSrc(), '/game.html', 'leaving the party allows solo play');
});

test('compiled join form does not turn the four-digit quantifier into a literal 4', async () => {
  const source = await readFile(new URL('../src/components/PartyPanel.svelte', import.meta.url), 'utf8');
  const { js } = compile(source, { filename: 'PartyPanel.svelte', generate: 'server' });
  // Svelte interprets braces inside a quoted attribute as interpolation:
  // pattern="[0-9]{4}" was rendered as pattern="[0-9]4", rejecting all four-digit codes.
  assert.doesNotMatch(js.code, /pattern="\[0-9\]4"/);
});

test('pasted party codes normalize clipboard formatting, retain leading zeroes and reject invalid invitations', async () => {
  const keys = ['window', 'location', 'localStorage', 'fetch', 'WebSocket'];
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let requested = '';
  class Socket {
    static OPEN = 1;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    send() {}
  }
  const values = new Map<string, string>();
  const globals: Record<string, unknown> = {
    window: new EventTarget(), location: { origin: 'http://localhost:4321' },
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    fetch: async (url: string) => { requested = url; return Response.json({ code: '0042' }); }, WebSocket: Socket,
  };
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: globals[key] });
  const client = new PartyClient('http://localhost:8787/api');
  try {
    for (const pasted of ['0042', ' \u00a00042\r\n', '00 42', '００４２', '\u200e0042\u200f']) {
      requested = '';
      await client.join(pasted, 'Guest');
      assert.equal(requested, 'http://localhost:8787/api/parties/0042/join');
      client.leave();
    }
    for (const invalid of ['42', '00423', 'party 0042', '00x2']) {
      requested = '';
      await client.join(invalid, 'Guest');
      assert.equal(requested, '', 'invalid codes must not be silently truncated or sent');
    }
  } finally {
    client.leave();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
