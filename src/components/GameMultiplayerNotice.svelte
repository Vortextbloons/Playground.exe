<script lang="ts">
  import { onMount } from 'svelte';
  import type { MultiplayerConfig } from '../../packages/game-kit/src/multiplayer/protocol';
  import { getPartyClient, type PartyClientState } from '../lib/party';
  let { gameId, config, partyUrl, solo = true }: { gameId: string; config: MultiplayerConfig; partyUrl: string; solo?: boolean } = $props();
  let connection = $state.raw<PartyClientState | null>(null);
  const match = $derived(connection?.party?.match?.gameId === gameId ? connection.party.match : null);
  const mode = $derived(config.modes.find(item => item.id === match?.modeId));
  const playing = $derived(match?.playerIds.includes(connection?.playerId ?? '') ?? false);
  const minimum = $derived(Math.min(...config.modes.map(item => item.minPlayers)));
  const maximum = $derived(Math.max(...config.modes.map(item => item.maxPlayers)));
  onMount(() => getPartyClient().subscribe(value => { connection = value; }));
</script>

<aside class="multiplayer-notice" aria-label="Play with friends">
  <div>
    <p class="label">{match ? `PARTY ${connection?.party?.code}` : 'PLAY TOGETHER'}</p>
    <p class="message">{#if match}{match.status === 'finished' ? 'Round finished' : playing ? 'You’re in the round' : mode?.spectators === false ? 'You’re sitting this round out' : 'You’re watching'}<span> · {mode?.label}</span>{:else}{minimum}–{maximum} players<span>{solo ? ' · Solo is available below' : ' · Join a party to play'}</span>{/if}</p>
  </div>
  <a href={match ? partyUrl : `${partyUrl}?game=${encodeURIComponent(gameId)}`}>{match ? 'Back to party' : connection?.party ? 'Choose in your party' : 'Play with friends'} <span aria-hidden="true">↗</span></a>
</aside>

<style>
  .multiplayer-notice { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:17px 20px; margin:0 0 18px; border:1px solid var(--line); border-left:3px solid var(--mint); border-radius:8px; background:var(--surface); }
  .label { color:var(--mint); font:10px monospace; letter-spacing:1.6px; margin-bottom:5px; }
  .message { font-size:13px; } .message span { color:var(--muted); }
  a { font-size:12px; color:var(--accent); white-space:nowrap; padding:10px 0; } a span { margin-left:12px; }
  @media(max-width:600px) { .multiplayer-notice { align-items:flex-start; flex-direction:column; gap:6px; padding:15px; } }
</style>
