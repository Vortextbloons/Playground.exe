<script lang="ts">
  import { onMount } from 'svelte';
  import { getPartyClient, type PartyClientState } from '../lib/party';
  let { href, active = false }: { href: string; active?: boolean } = $props();
  let clientState = $state.raw<PartyClientState | null>(null);
  onMount(() => {
    const client = getPartyClient();
    const unsubscribe = client.subscribe(value => { clientState = value; });
    client.initialize();
    return unsubscribe;
  });
</script>

<a class={{ active }} href={href} aria-current={active ? 'page' : undefined} aria-label={clientState?.party ? `Party ${clientState.party.code}, ${clientState.party.players.length} members${clientState.connected ? '' : ', reconnecting'}` : 'Party'}>
  <span class={['dot', { connected: clientState?.connected, pending: clientState?.busy || (clientState?.party && !clientState.connected) }]} aria-hidden="true"></span>
  <span>Party</span>
  {#if clientState?.party}<span class="code">{clientState.party.code}</span><span class="count">{clientState.party.players.length}<span class="member-label"> in</span></span>{:else if clientState?.busy}<span class="pending-label">Connecting</span>{/if}
</a>

<style>
  a{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);height:100%;border-bottom:2px solid transparent;white-space:nowrap}a:hover,.active{color:var(--accent)}.active{border-bottom-color:var(--accent)}.dot{width:5px;height:5px;border-radius:50%;background:#746a80}.connected{background:var(--mint)}.pending{background:#d7b083}.code{font:11px monospace;color:var(--mint);letter-spacing:1px}.count{font-size:9px;color:var(--muted)}.pending-label{font-size:9px;color:var(--muted)}@media(max-width:760px){a{font-size:11px;gap:5px}.pending-label,.count{display:none}}@media(max-width:380px){.code{display:none}}
</style>
