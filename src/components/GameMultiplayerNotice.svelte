<script lang="ts">
  import { onMount } from 'svelte';
  import type { MultiplayerConfig } from '../../packages/game-kit/src/multiplayer/protocol';
  import { getPartyClient, type PartyClientState } from '../lib/party';
  let { gameId, config, partyUrl, solo = true }: { gameId: string; config?: MultiplayerConfig; partyUrl: string; solo?: boolean } = $props();
  let connection = $state.raw<PartyClientState | null>(null);
  let notice = $state('');
  const party = $derived(connection?.party);
  const selected = $derived(connection?.party?.selection?.gameId === gameId);
  const match = $derived(connection?.party?.match?.gameId === gameId ? connection.party.match : null);
  const mode = $derived(config?.modes.find(item => item.id === match?.modeId));
  const playing = $derived(match?.playerIds.includes(connection?.playerId ?? '') ?? false);
  const minimum = $derived(config ? Math.min(...config.modes.map(item => item.minPlayers)) : 0);
  const maximum = $derived(config ? Math.max(...config.modes.map(item => item.maxPlayers)) : 0);
  onMount(() => getPartyClient().subscribe(value => { connection = value; }));
  async function copyCode() {
    if (!party) return;
    try { await navigator.clipboard.writeText(party.code); notice = 'Party code copied.'; }
    catch { notice = 'Select the party code to copy it.'; }
  }
  function leave() { getPartyClient().leave(); notice = 'You left the party.'; }
</script>

{#if config || party}
<aside class="multiplayer-notice" aria-label="Play with friends">
  <div>
    <p class="label">{party ? `PARTY ${party.code}` : 'PLAY TOGETHER'}</p>
    <p class="message">{#if match}{match.status === 'finished' ? 'Round finished' : playing ? 'You’re in the round' : mode?.spectators === false ? 'You’re sitting this round out' : 'You’re watching'}<span> · {mode?.label}</span>{:else if config}{minimum}–{maximum} players<span>{selected ? ' · Choose your mode in the game' : solo ? ' · Solo is available below' : ' · Join a party to play'}</span>{:else}Your party is still together while you play solo.{/if}</p>
  </div>
  {#if config && !selected}<a href={`${partyUrl}?game=${encodeURIComponent(gameId)}`}>{connection?.party ? 'Open with your party' : 'Play with friends'} <span aria-hidden="true">↗</span></a>{/if}
  {#if party}
    <details>
      <summary>Manage party · {party.players.length} {party.players.length === 1 ? 'member' : 'members'}</summary>
      <div class="party-controls">
        <p>Invite code <strong>{party.code}</strong></p>
        <ul>{#each party.players as player (player.id)}<li><span>{player.nickname}{player.id === connection?.playerId ? ' (you)' : ''}{player.id === party.hostId ? ' · Host' : ''}</span><span>{!player.connected ? 'Reconnecting' : player.role === 'spectator' ? 'Sitting out' : party.match?.playerIds.includes(player.id) && party.match.status === 'playing' ? 'Playing' : player.ready ? 'Ready' : 'Not ready'}</span></li>{/each}</ul>
        <div class="actions">
          <button onclick={copyCode}>Copy invite code</button>
          {#if !connection?.connected}<button disabled={connection?.busy} onclick={() => getPartyClient().retry()}>Reconnect</button>{/if}
          <button onclick={leave}>Leave party</button>
        </div>
      </div>
    </details>
  {/if}
  {#if connection?.error}<p class="feedback" role="alert">{connection.error}</p>{/if}
  {#if notice}<p class="feedback" role="status">{notice}</p>{/if}
</aside>
{/if}

<style>
  .multiplayer-notice { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:20px; padding:17px 20px; margin:0 0 18px; border:1px solid var(--line); border-left:3px solid var(--mint); border-radius:8px; background:var(--surface); }
  .label { color:var(--mint); font:10px monospace; letter-spacing:1.6px; margin-bottom:5px; }
  .message { font-size:13px; } .message span { color:var(--muted); }
  a { font-size:12px; color:var(--accent); white-space:nowrap; padding:10px 0; } a span { margin-left:12px; }
  details { width:100%; border-top:1px solid var(--line); padding-top:12px; }
  summary { cursor:pointer; color:var(--accent); font-size:12px; min-height:44px; align-content:center; }
  summary:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
  .party-controls { display:grid; gap:14px; padding-top:12px; font-size:12px; }
  strong { color:var(--mint); font:20px monospace; letter-spacing:3px; margin-left:10px; user-select:all; }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
  li { display:flex; justify-content:space-between; gap:12px; overflow-wrap:anywhere; }
  li>span:first-child { min-width:0; } li>span:last-child { color:var(--muted); flex-shrink:0; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; }
  button { min-height:44px; padding:10px 14px; font-size:12px; }
  .feedback { width:100%; font-size:12px; overflow-wrap:anywhere; }
  @media(max-width:600px) { .multiplayer-notice { align-items:flex-start; flex-direction:column; gap:6px; padding:15px; } }
</style>
