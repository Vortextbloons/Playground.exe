<script lang="ts">
  import { onMount } from 'svelte';
  import { readLocal, writeLocal } from '../lib/storage';
  import type { Command } from '../../packages/game-kit/src/bridge';
  import { PARTY_CHANNEL, isRecord, isJson, type MultiplayerConfig, type PartyCommand, type MultiplayerUpdate } from '../../packages/game-kit/src/multiplayer/protocol';
  import { getPartyClient } from '../lib/party';
  let partyUpdate: MultiplayerUpdate = { party: null, playerId: null, connected: false };
  let partyClient: ReturnType<typeof getPartyClient> | undefined;
  let subscribedToParty = false;
  function updateGame() {
    if (!subscribedToParty) return;
    const update = { ...partyUpdate, party: partyUpdate.party ? { ...partyUpdate.party, match: partyUpdate.party.match?.gameId === id ? partyUpdate.party.match : null } : null };
    frame?.contentWindow?.postMessage({ channel: PARTY_CHANNEL, type: 'update', update }, location.origin);
  }
  let { id, title, src, config, base }: { id: string; title: string; src: string; config?: MultiplayerConfig; base: string } = $props();
  let frame = $state<HTMLIFrameElement>(); let player = $state<HTMLDivElement>();
  // Mount the game after host listeners and saved preferences are ready.
  let activeSrc = $state<string | undefined>(undefined);
  let checkingParty = $state(true);
  let ready = $state(false); let muted = $state(false); let paused = $state(false); let best = $state(0); let error = $state('');
  let controlsOpen = $state(false);
  function send(type: Command) { frame?.contentWindow?.postMessage({ channel: 'playground-exe', type, muted }, location.origin); }
  function toggleMute() { muted = !muted; writeLocal('muted', muted); send('mute'); }
  function togglePause() { paused = !paused; send(paused ? 'pause' : 'resume'); }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await player?.requestFullscreen(); } catch { error = 'Fullscreen is unavailable in this browser.'; } }
  function receive(event: MessageEvent<unknown>) {
    if (event.source !== frame?.contentWindow || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (data.channel === PARTY_CHANNEL && data.gameId === id) {
      if (data.type === 'subscribe') {
        subscribedToParty = true;
        partyClient ??= getPartyClient();
        updateGame();
      }
      if (data.type === 'menu' && isRecord(data.command) && partyUpdate.party?.selection?.gameId === id) {
        const command = data.command;
        if (command.type === 'mode' && config?.modes.some(mode => mode.id === command.modeId)) partyClient?.send({ type: 'select', gameId: id, modeId: String(command.modeId) });
        if (command.type === 'seat' && typeof command.playing === 'boolean') partyClient?.send({ type: 'seat', playing: command.playing });
        if (command.type === 'ready' && typeof command.ready === 'boolean') partyClient?.send({ type: 'ready', ready: command.ready });
        if (command.type === 'start' || command.type === 'return' || command.type === 'browse') partyClient?.send({ type: command.type });
      }
      if (data.type === 'actions' && typeof data.matchId === 'string' && partyUpdate.party?.match?.id === data.matchId && partyUpdate.party.match.gameId === id && Array.isArray(data.commands) && data.commands.length > 0 && data.commands.length <= 8) {
        const commands: PartyCommand[] = [];
        for (const command of data.commands) {
          if (!isRecord(command) || typeof command.action !== 'string' || command.action.length > 64 || !isJson(command.payload)) return;
          commands.push({ type: 'action', matchId: data.matchId, action: command.action, payload: command.payload, sequence: 0 });
        }
        partyClient?.sendCommands(commands);
      }
      return;
    }
    if (data.channel !== 'playground-exe') return;
    if (data.type === 'ready') { ready = true; error = ''; paused = false; send('mute'); updateGame(); if (document.hidden) { paused = true; send('pause'); } }
    if (data.type === 'score' && typeof data.score === 'number' && Number.isFinite(data.score)) { best = Math.max(best, data.score); writeLocal(`score:${id}`, best); }
    if (data.type === 'pause') paused = true;
    // Fullscreen requires a direct user gesture in the parent browser context.
    if (data.type === 'fullscreen') error = 'Use the Fullscreen button below the player.';
  }
  function visibility() { if (document.hidden && ready) { paused = true; send('pause'); } }
  onMount(() => {
    muted = readLocal('muted', false, (value): value is boolean => typeof value === 'boolean');
    best = readLocal(`score:${id}`, 0, (value): value is number => typeof value === 'number' && Number.isFinite(value));
    const client = getPartyClient();
    client.initialize();
    const unsubscribe = client.subscribe(value => {
      const previousGame = partyUpdate.party?.selection?.gameId;
      partyUpdate = { party: value.party, playerId: value.playerId, connected: value.connected }; updateGame();
      const selectedGame = value.party?.selection?.gameId;
      checkingParty = !value.party && (value.busy || value.connected);
      const canLoad = value.party ? !!config && selectedGame === id : !value.busy && !value.connected && !value.error;
      if (!canLoad) { activeSrc = undefined; ready = false; subscribedToParty = false; }
      else activeSrc = src;
      if (value.connected && selectedGame && selectedGame !== id) window.location.assign(`${base}play/${selectedGame}/`);
      if (value.connected && value.party && previousGame === id && !selectedGame) window.location.assign(`${base}party/`);
      if (value.error) frame?.contentWindow?.postMessage({ channel: PARTY_CHANNEL, type: 'error', message: value.error }, location.origin);
    });
    const timeout = window.setTimeout(() => { if (activeSrc && !ready) error = 'Still loading. Check the game build, or reload the player.'; }, 15000);
    // Dev only: game rebuilds swap the bundle under the same URL; refresh the player when it changes.
    let bundle: string | undefined;
    const poll = import.meta.env.DEV ? window.setInterval(async () => {
      if (!activeSrc) return;
      try {
        const response = await fetch(src, { cache: 'no-store' });
        if (!response.ok) return;
        const html = await response.text();
        const changed = bundle !== undefined ? html !== bundle : !ready;
        bundle = html;
        if (changed) { ready = false; error = ''; if (frame) frame.src = src; }
      } catch { /* Dev server may be restarting. */ }
    }, 1000) : undefined;
    return () => { clearTimeout(timeout); if (poll) window.clearInterval(poll); unsubscribe(); };
  });
</script>
<svelte:window onmessage={receive}/><svelte:document onvisibilitychange={visibility}/>
{#if activeSrc}
<div class="player [border:1px_solid_var(--line)] rounded-[10px] overflow-hidden [background:#111] flex flex-col [&_iframe]:w-full [&_iframe]:[aspect-ratio:16/9] [&_iframe]:border-0 [&_iframe]:block [&_iframe]:flex-1 [&_iframe]:min-h-[0] [&:fullscreen]:rounded-[0]" bind:this={player}><iframe bind:this={frame} src={activeSrc} {title} allow="fullscreen; autoplay" sandbox="allow-scripts allow-same-origin" referrerpolicy="same-origin"></iframe><button class="player-controls-toggle" type="button" aria-label={controlsOpen ? 'Hide game controls' : 'Show game controls'} aria-expanded={controlsOpen} onclick={() => (controlsOpen = !controlsOpen)}>⋯</button><div class="player-controls {controlsOpen ? 'open' : ''} flex items-center justify-between p-[12px_16px] bg-surface gap-[15px] [&>div]:flex [&>div]:gap-[8px] [&>div]:flex-wrap [&_button]:p-[8px_11px] [&_button]:text-[11px] max-[760px]:flex-wrap max-[760px]:[&>div]:gap-[6px] max-[500px]:[&_button]:p-[8px] max-[500px]:[&_button]:text-[10px]"><span class="player-status text-[11px] text-muted"><span class="status-dot inline-block w-[6px] h-[6px] bg-mint rounded-[50%] [vertical-align:middle] mr-[7px]"></span>{!ready ? 'Loading' : paused ? 'Paused' : 'Ready to play'}</span><div><button disabled={!ready} onclick={togglePause}>{paused ? 'Resume' : 'Pause'}</button><button disabled={!ready} onclick={() => { send('restart'); paused = false; }}>↻ Restart</button><button aria-pressed={muted} onclick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button><button onclick={fullscreen}>⛶ Fullscreen</button></div></div></div>
<div class="player-details flex justify-between items-center m-[20px_0] text-[12px] text-muted [&_strong]:text-accent [&_strong]:ml-[10px] max-[500px]:gap-[12px]"><span>Personal best <strong>{best.toLocaleString()}</strong></span><button class="text-link [&:hover]:text-accent text-[12px] font-semibold inline-flex gap-[15px] items-center [background:none] border-0 p-[0]" onclick={() => { ready = false; error = ''; if (frame) frame.src = src; }}>Reload player ↻</button></div>
{#if error}<p role="status">{error}</p>{/if}
{:else}
<div class="party-gate" role="status">{#if checkingParty}<h2>Checking your party…</h2><p>Waiting for your lobby before opening the game.</p>{:else}<h2>Play together from your lobby</h2><p>Solo play is unavailable while you’re in a party. The host picks the game, then everyone chooses a seat and readies up.</p>{/if}<a href={`${base}party/`}>Go to party lobby →</a></div>
{/if}

<style>
  .party-gate { padding:32px; border:1px solid var(--line); border-radius:10px; background:var(--surface); }
  .party-gate h2 { font-size:22px; }
  .party-gate p { color:var(--muted); font-size:13px; margin:12px 0 20px; }
  .party-gate a { color:var(--accent); font-size:13px; }
  .player { flex:1; min-height:0; }
  .player iframe { height:100%; aspect-ratio:auto; min-width:0; }
  .player-controls { flex-shrink:0; padding:6px 10px; gap:8px; }
  .player-details { margin:6px 0 0; flex-shrink:0; }
  @media (max-width:760px) {
    .player-status { display:none; }
    .player-controls>div { width:100%; justify-content:space-between; gap:4px; }
    .player-controls button { min-height:44px; }
    .player-details button { min-height:44px; }
  }
  .player-controls-toggle { display:none; }
  @media (max-height:500px) and (orientation:landscape) {
    .player { position:relative; }
    .player-details { display:none; }
    .player-controls-toggle { display:grid; position:absolute; z-index:3; top:max(6px,env(safe-area-inset-top)); right:max(6px,env(safe-area-inset-right)); place-items:center; width:38px; height:38px; padding:0; border:1px solid var(--line); border-radius:9px; background:#111111d9; color:#efedf5; font-size:17px; line-height:1; }
    .player-controls { display:none; position:absolute; z-index:2; top:max(50px,calc(env(safe-area-inset-top) + 44px)); right:max(6px,env(safe-area-inset-right)); padding:5px; gap:5px; background:#111111f2; border:1px solid var(--line); border-radius:9px; }
    .player-controls.open { display:flex; flex-direction:column; align-items:stretch; }
    .player-controls .player-status { display:none; }
    .player-controls>div { flex-direction:column; gap:5px; }
    .player-controls button { padding:6px 10px; font-size:11px; min-height:36px; white-space:nowrap; }
  }
</style>
