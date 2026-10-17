<script lang="ts">
  import type { FeedItem, PlayerView } from '../core/types';

  let { view, names }: { view: PlayerView; names: Record<string, string> } = $props();

  const recent = $derived(view.feed.slice(-6).reverse());

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function who(item: FeedItem): string {
    return item.playerId === null ? 'The house' : names[item.playerId] ?? 'A player';
  }

  function message(item: FeedItem): string {
    switch (item.kind) {
      case 'join': return `${who(item)} joined the casino`;
      case 'bigwin': return `${who(item)} hit a big win · +${money(item.amount)}`;
      case 'jackpot': return `JACKPOT · ${who(item)} won ${money(item.amount)}`;
      case 'bailout': return `${who(item)} took a ${money(item.amount)} bailout`;
      case 'bust': return `${who(item)} busted out`;
      case 'leave': return `${who(item)} left the casino`;
    }
  }
</script>

<section class="panel" aria-label="Floor feed">
  <header class="flex items-baseline justify-between gap-2">
    <h2 class="m-0 font-display text-[19px] leading-none tracking-[0.08em] text-gold">Floor feed</h2>
  </header>
  {#if recent.length === 0}
    <p class="m-0 text-[12px] text-muted">Quiet so far — the felt is waiting.</p>
  {:else}
    <ul class="m-0 grid list-none gap-1.5 p-0">
      {#each recent as item (item.id)}
        <li class="feed-item" data-kind={item.kind}>
          <span class="dot" aria-hidden="true"></span>
          <span>{message(item)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
