<script lang="ts">
  import { onMount } from 'svelte';
  import { readLocal, writeLocal } from '../lib/storage';
  import type { Command } from '../../packages/game-kit/src/bridge';
  let { id, title, src }: { id: string; title: string; src: string } = $props();
  let frame: HTMLIFrameElement; let player: HTMLDivElement;
  // Mount the game after host listeners and saved preferences are ready.
  let activeSrc = $state<string | undefined>(undefined);
  let ready = $state(false); let muted = $state(false); let paused = $state(false); let best = $state(0); let error = $state('');
  function send(type: Command) { frame?.contentWindow?.postMessage({ channel: 'personal-arcade', type, muted }, location.origin); }
  function toggleMute() { muted = !muted; writeLocal('muted', muted); send('mute'); }
  function togglePause() { paused = !paused; send(paused ? 'pause' : 'resume'); }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await player.requestFullscreen(); } catch { error = 'Fullscreen is unavailable in this browser.'; } }
  function receive(event: MessageEvent<unknown>) {
    if (event.source !== frame?.contentWindow || event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (data.channel !== 'personal-arcade') return;
    if (data.type === 'ready') { ready = true; error = ''; paused = false; send('mute'); if (document.hidden) { paused = true; send('pause'); } }
    if (data.type === 'score' && typeof data.score === 'number' && Number.isFinite(data.score)) { best = Math.max(best, data.score); writeLocal(`score:${id}`, best); }
    if (data.type === 'pause') paused = true;
    // Fullscreen requires a direct user gesture in the parent browser context.
    if (data.type === 'fullscreen') error = 'Use the Fullscreen button below the player.';
  }
  function visibility() { if (document.hidden && ready) { paused = true; send('pause'); } }
  onMount(() => {
    muted = readLocal('muted', false, (value): value is boolean => typeof value === 'boolean');
    best = readLocal(`score:${id}`, 0, (value): value is number => typeof value === 'number' && Number.isFinite(value));
    activeSrc = src;
    const timeout = window.setTimeout(() => { if (!ready) error = 'Still loading. Check the game build, or reload the player.'; }, 15000);
    return () => clearTimeout(timeout);
  });
</script>
<svelte:window onmessage={receive}/><svelte:document onvisibilitychange={visibility}/>
<div class="player" bind:this={player}><iframe bind:this={frame} src={activeSrc} {title} allow="fullscreen; autoplay" allowfullscreen sandbox="allow-scripts allow-same-origin" referrerpolicy="same-origin"></iframe><div class="player-controls"><span class="player-status"><span class="status-dot"></span>{!ready ? 'Loading' : paused ? 'Paused' : 'Ready to play'}</span><div><button disabled={!ready} onclick={togglePause}>{paused ? 'Resume' : 'Pause'}</button><button disabled={!ready} onclick={() => { send('restart'); paused = false; }}>↻ Restart</button><button aria-pressed={muted} onclick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button><button onclick={fullscreen}>⛶ Fullscreen</button></div></div></div>
<div class="player-details"><span>Personal best <strong>{best.toLocaleString()}</strong></span><button class="text-link" onclick={() => { ready = false; error = ''; frame.src = src; }}>Reload player ↻</button></div>
{#if error}<p role="status">{error}</p>{/if}
