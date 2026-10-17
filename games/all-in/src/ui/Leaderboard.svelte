<script lang="ts">
  import type { LeaderRow, Location, PlayerView } from '../core/types';
  import Avatar from './Avatar.svelte';

  let { view, names }: { view: PlayerView; names: Record<string, string> } = $props();

  const LOCATIONS: Record<Location, string> = {
    floor: 'on the floor',
    blackjack: 'at blackjack',
    roulette: 'at roulette',
    slots: 'at the slots',
    plinko: 'at plinko',
    poker: 'at poker',
  };

  let previous = new Map<string, number>();
  let pulse = $state<ReadonlySet<string>>(new Set());
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const rows = view.players;
    const changed = new Set<string>();
    const next = new Map<string, number>();
    for (const row of rows) {
      next.set(row.id, row.bankroll);
      const before = previous.get(row.id);
      if (before !== undefined && row.bankroll > before) changed.add(row.id);
    }
    previous = next;
    if (changed.size === 0) return;
    pulse = changed;
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      pulse = new Set();
    }, 1000);
  });

  $effect(() => () => clearTimeout(pulseTimer));

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function standing(row: LeaderRow): string {
    if (row.status === 'offered') return 'broke · bailout offered';
    if (row.status === 'out') return row.outReason === 'left' ? 'left the casino' : 'busted out';
    return LOCATIONS[row.at];
  }
</script>

<section class="panel" aria-label="Standings">
  <header class="flex items-baseline justify-between gap-2">
    <h2 class="m-0 font-display text-[19px] leading-none tracking-[0.08em] text-gold">Standings</h2>
    <span class="text-[11px] text-muted">{view.players.length} in the casino</span>
  </header>
  {#if view.players.length === 0}
    <p class="m-0 text-[12px] text-muted">No players yet.</p>
  {:else}
    <ol class="m-0 grid list-none gap-1.5 p-0">
      {#each view.players as row, index (row.id)}
        <li class="standings-row" class:me={row.id === view.you} class:pulse={pulse.has(row.id)}>
          <span class="rank">{index + 1}</span>
          <span class="grid min-w-0 gap-0.5">
            <span class="flex min-w-0 items-center gap-1.5">
              <Avatar id={row.id} size={20} label={names[row.id] ?? 'Player'} />
              {#if index === 0}
                <span class="crown flex-none" aria-hidden="true">
                  <svg viewBox="0 0 24 20" role="presentation">
                    <path d="M2 6.5 7 10l5-7 5 7 5-3.5-1.6 10H3.6L2 6.5Zm2.4 11.5h15.2v2H4.4v-2Z" />
                  </svg>
                </span>
              {/if}
              <span class="min-w-0 truncate text-[13px] font-semibold text-fog">
                {names[row.id] ?? 'Player'}{#if row.id === view.you}<em class="not-italic text-gold"> · you</em>{/if}
              </span>
            </span>
            <span class="truncate text-[11px] text-muted">{standing(row)}</span>
          </span>
          <span class="grid justify-items-end gap-0.5">
            <strong class="text-[13.5px] tabular-nums">{money(row.bankroll)}</strong>
            {#if row.penalty > 0}
              <span class="penalty-badge">−{money(row.penalty)}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>
