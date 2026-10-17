<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView, TableId } from '../core/types';
  import { TABLE_IDS } from '../core/types';
  import Avatar from './Avatar.svelte';

  let { view, names, send, remaining, playing, connected }: {
    view: PlayerView;
    names: Record<string, string>;
    send: (action: string, payload: Json) => void;
    remaining: number;
    playing: boolean;
    connected: boolean;
  } = $props();

  const LABELS: Record<TableId, string> = {
    blackjack: 'Blackjack',
    roulette: 'Roulette',
    slots: 'Slots',
    plinko: 'Plinko',
    poker: 'Poker',
  };

  const BLURBS: Record<TableId, string> = {
    blackjack: 'Beat the dealer to 21',
    roulette: 'Spin the neon wheel',
    slots: 'Chase the glowing jackpot',
    plinko: 'Drop a chip and pray',
    poker: 'Outplay the whole table',
  };

  const ACCENTS: Record<TableId, string> = {
    blackjack: 'var(--color-gold)',
    roulette: 'var(--color-red)',
    slots: 'var(--color-violet)',
    plinko: 'var(--color-mint)',
    poker: 'var(--color-sky)',
  };

  const bankroll = $derived(view.vault?.bankroll ?? 0);
  const leader = $derived(view.players[0] ?? null);

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function clock(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function infoNumber(info: Json, key: string): number | null {
    if (info === null || typeof info !== 'object' || Array.isArray(info)) return null;
    const value = (info as Record<string, Json>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function tableHint(id: TableId, info: Json): string | null {
    if (id === 'slots') {
      const jackpot = infoNumber(info, 'jackpot');
      return jackpot === null ? null : `Jackpot ${money(jackpot)}`;
    }
    if (id === 'roulette') {
      const last = infoNumber(info, 'last');
      return last === null ? null : `Last spin ${last}`;
    }
    return null;
  }
</script>

{#snippet artwork(id: TableId)}
  {#if id === 'blackjack'}
    <svg viewBox="0 0 78 46" role="presentation">
      <rect x="30" y="8" width="20" height="28" rx="3" fill="#121a30" stroke="var(--accent)" stroke-width="2" transform="rotate(-9 40 22)" />
      <rect x="38" y="7" width="20" height="28" rx="3" fill="#1a2440" stroke="var(--accent)" stroke-width="2" transform="rotate(6 48 21)" />
      <circle cx="45" cy="16" r="1.8" fill="var(--color-red)" />
      <circle cx="51" cy="16" r="1.8" fill="var(--color-red)" />
      <circle cx="48" cy="22" r="1.8" fill="var(--color-red)" />
      <circle cx="19" cy="32" r="8" fill="#121a30" stroke="var(--color-gold)" stroke-width="2" />
      <circle cx="19" cy="32" r="3.4" fill="var(--color-gold)" />
    </svg>
  {:else if id === 'roulette'}
    <svg viewBox="0 0 78 46" role="presentation">
      <circle cx="39" cy="23" r="16" fill="#121a30" stroke="var(--accent)" stroke-width="2.6" />
      <circle cx="39" cy="23" r="9.5" fill="none" stroke="var(--accent)" stroke-width="1.2" opacity="0.55" />
      <circle cx="39" cy="23" r="3" fill="var(--accent)" />
      <line x1="39" y1="7" x2="39" y2="14" stroke="var(--accent)" stroke-width="1.4" />
      <line x1="39" y1="32" x2="39" y2="39" stroke="var(--accent)" stroke-width="1.4" />
      <line x1="23" y1="23" x2="30" y2="23" stroke="var(--accent)" stroke-width="1.4" />
      <line x1="48" y1="23" x2="55" y2="23" stroke="var(--accent)" stroke-width="1.4" />
      <circle cx="50" cy="12" r="2.4" fill="var(--color-fog)" />
    </svg>
  {:else if id === 'slots'}
    <svg viewBox="0 0 78 46" role="presentation">
      <rect x="14" y="7" width="46" height="32" rx="5" fill="#121a30" stroke="var(--accent)" stroke-width="2.4" />
      <rect x="20" y="14" width="9" height="18" rx="2" fill="#1a2440" stroke="var(--color-gold)" stroke-width="1.4" />
      <rect x="32.5" y="14" width="9" height="18" rx="2" fill="#1a2440" stroke="var(--color-gold)" stroke-width="1.4" />
      <rect x="45" y="14" width="9" height="18" rx="2" fill="#1a2440" stroke="var(--color-gold)" stroke-width="1.4" />
      <line x1="60" y1="14" x2="66" y2="7" stroke="var(--color-muted)" stroke-width="1.8" />
      <circle cx="67" cy="6" r="2.6" fill="var(--color-red)" />
    </svg>
  {:else if id === 'plinko'}
    <svg viewBox="0 0 78 46" role="presentation">
      <circle cx="27" cy="16" r="2" fill="var(--accent)" />
      <circle cx="39" cy="16" r="2" fill="var(--accent)" />
      <circle cx="51" cy="16" r="2" fill="var(--accent)" />
      <circle cx="33" cy="26" r="2" fill="var(--accent)" />
      <circle cx="45" cy="26" r="2" fill="var(--accent)" />
      <circle cx="39" cy="36" r="2" fill="var(--accent)" />
      <line x1="20" y1="42" x2="58" y2="42" stroke="var(--accent)" stroke-width="2" />
      <circle cx="32" cy="6" r="3.4" fill="var(--color-fog)" />
    </svg>
  {:else}
    <svg viewBox="0 0 78 46" role="presentation">
      <rect x="20" y="10" width="18" height="25" rx="3" fill="#121a30" stroke="var(--accent)" stroke-width="2" transform="rotate(-12 29 22)" />
      <rect x="31" y="9" width="18" height="25" rx="3" fill="#1a2440" stroke="var(--accent)" stroke-width="2" transform="rotate(5 40 21)" />
      <ellipse cx="57" cy="16" rx="7" ry="3.4" fill="var(--color-mint)" stroke="#0b1a18" stroke-width="1" />
      <ellipse cx="57" cy="23" rx="7" ry="3.4" fill="var(--color-mint)" stroke="#0b1a18" stroke-width="1" />
      <ellipse cx="57" cy="30" rx="7" ry="3.4" fill="var(--color-mint)" stroke="#0b1a18" stroke-width="1" />
    </svg>
  {/if}
{/snippet}

<section class="safe-bottom grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 px-3 pt-3 short:px-2 short:pt-2">
  <div class="grid content-start gap-3">
    <div class="hero-strip short:gap-2 short:py-3">
      <div class="grid gap-1">
        <p class="eyebrow m-0">Tonight's run</p>
        <h2 class="m-0 font-display text-[clamp(30px,7vw,44px)] leading-none tracking-[0.04em] text-fog">Casino Floor</h2>
        <p class="m-0 text-[13px] text-muted short:hidden">
          Five tables, one bankroll, ten minutes. Pick a seat and press your luck.
          {#if leader !== null}
            Top stack: <strong class="text-fog">{names[leader.id] ?? 'Player'}</strong>
          {/if}
        </p>
      </div>
      <dl class="hero-stats m-0">
        <div>
          <dt>Time left</dt>
          <dd class={remaining <= 60_000 ? 'text-red' : ''}>{clock(remaining)}</dd>
        </div>
        <div>
          <dt>Bankroll</dt>
          <dd class="text-mint">{money(bankroll)}</dd>
        </div>
      </dl>
    </div>

    {#if !playing}
      <p class="m-0 rounded-xl border border-dashed border-red/40 bg-red/5 px-3 py-2 text-[12.5px] text-red">
        You're watching this run — take a seat in the party lobby to play.
      </p>
    {/if}
  </div>

  <div class="cards-grid grid min-h-0 grid-cols-1 gap-3 min-[540px]:grid-cols-2 min-[900px]:grid-cols-3 short:grid-cols-3">
    {#each TABLE_IDS as id (id)}
      {@const summary = view.tables[id]}
      {@const hint = tableHint(id, summary.info)}
      {@const occupants = summary.occupants}
      <button
        type="button"
        class="table-card"
        style:--accent={ACCENTS[id]}
        disabled={!playing || !connected}
        onclick={() => send('sit', { at: id })}
      >
        <span class="table-art" aria-hidden="true">{@render artwork(id)}</span>
        <span class="table-copy grid gap-0.5">
          <strong class="font-display text-[23px] leading-none tracking-[0.04em] text-fog">{LABELS[id]}</strong>
          <span class="text-[12px] text-muted">{BLURBS[id]}</span>
        </span>
        <span class="table-meta flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{summary.seats}/{summary.limit} seated</span>
          {#if occupants.length > 0}
            <span class="flex min-w-0 items-center overflow-hidden">
              {#each occupants.slice(0, 4) as occupant (occupant)}
                <span class="-ml-1.5 flex-none first:ml-0">
                  <Avatar id={occupant} size={22} label={names[occupant] ?? 'Player'} />
                </span>
              {/each}
              {#if occupants.length > 4}
                <span class="-ml-1.5 grid h-[22px] min-w-[22px] flex-none place-items-center rounded-full border border-edge bg-panel px-1 text-[10px] font-bold text-muted">
                  +{occupants.length - 4}
                </span>
              {/if}
            </span>
          {/if}
          <span class="badge flex-none" class:shared={summary.mode === 'shared'}>{summary.mode}</span>
        </span>
        {#if hint !== null}
          <span class="hint-line">{hint}</span>
        {/if}
      </button>
    {/each}
  </div>
</section>
