<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView, TableId } from '../core/types';
  import { TABLE_IDS } from '../core/types';
  import Avatar from './Avatar.svelte';

  let { view, names, send, party }: {
    view: PlayerView;
    names: Record<string, string>;
    send: (action: string, payload: Json) => void;
    party: boolean;
  } = $props();

  const LABELS: Record<TableId, string> = {
    blackjack: 'Blackjack',
    roulette: 'Roulette',
    slots: 'Slots',
    plinko: 'Plinko',
    poker: 'Poker',
  };

  const CONFETTI_COLORS = ['var(--color-gold)', 'var(--color-red)', 'var(--color-mint)', 'var(--color-violet)', 'var(--color-sky)'];
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const confetti = reduceMotion ? [] : Array.from({ length: 44 }, () => ({
    x: Math.round((Math.random() * 2 - 1) * 190),
    y: Math.round(110 + Math.random() * 260),
    r: Math.round((Math.random() < 0.5 ? -1 : 1) * (320 + Math.random() * 460)),
    c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0]!,
    d: +(Math.random() * 0.5).toFixed(2),
    t: +(1.4 + Math.random() * 1.2).toFixed(2),
  }));

  const results = $derived(view.results ?? []);
  const champion = $derived(results[0] ?? null);
  const vault = $derived(view.vault);
  const myPlacement = $derived(view.you === null ? null : results.find(row => row.id === view.you)?.placement ?? null);
  const celebrating = $derived(champion !== null && (view.you === null || champion.id === view.you));

  const pot = $derived(champion?.adjusted ?? 0);
  let shownPot = $state(0);
  let raf = 0;

  $effect(() => {
    const target = pot;
    if (reduceMotion) {
      shownPot = target;
      return;
    }
    const started = performance.now();
    const step = (time: number) => {
      const progress = Math.min(1, (time - started) / 1400);
      shownPot = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) raf = requestAnimationFrame(step);
      else shownPot = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  const stats = $derived.by(() => {
    const current = vault;
    if (!current) return null;
    return [
      { label: 'Peak bankroll', value: money(current.peak) },
      { label: 'Biggest win', value: money(current.biggestWin) },
      { label: 'Biggest loss', value: money(Math.abs(current.biggestLoss)) },
      { label: 'Rounds played', value: String(current.rounds) },
      { label: 'Bankruptcies', value: String(current.bankruptcies) },
      { label: 'Favourite table', value: favourite(current.byGame) },
    ];
  });

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function nameOf(id: string | null): string {
    return id === null ? 'The house' : names[id] ?? 'Player';
  }

  function favourite(byGame: Record<TableId, number>): string {
    let best: TableId | null = null;
    for (const id of TABLE_IDS) {
      const count = byGame[id];
      if (count > 0 && (best === null || count > byGame[best])) best = id;
    }
    return best === null ? '—' : LABELS[best];
  }
</script>

<section class="safe-bottom grid content-start justify-items-center gap-3 px-3 pt-3 short:px-2 short:pt-2">
  <div class="results-banner short:py-3">
    <div class="spotlight" aria-hidden="true"></div>
    <p class="eyebrow m-0">Run complete</p>
    <h2 class="m-0 font-display text-[clamp(30px,7vw,44px)] leading-none tracking-[0.04em] text-gold">
      {champion ? `${nameOf(champion.id)} takes the pot` : 'The casino closed its doors'}
    </h2>
    {#if champion !== null}
      <div class="banner-pot">{money(shownPot)}</div>
    {/if}
    {#if myPlacement !== null}
      <p class="m-0 text-[13px] text-muted">You finished #{myPlacement} of {results.length}</p>
    {:else}
      <p class="m-0 text-[13px] text-muted">Thanks for watching the run</p>
    {/if}
  </div>

  <div class="panel w-full max-w-[720px]">
    <h3 class="m-0 font-display text-[20px] leading-none tracking-[0.08em] text-gold">Final standings</h3>
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="text-left text-[10.5px] uppercase tracking-[0.16em] text-muted">
          <th class="py-1.5 pr-2 font-semibold">#</th>
          <th class="py-1.5 pr-2 font-semibold">Player</th>
          <th class="py-1.5 pr-2 text-right font-semibold">Bankroll</th>
          <th class="py-1.5 pr-2 text-right font-semibold">Penalty</th>
          <th class="py-1.5 text-right font-semibold">Score</th>
        </tr>
      </thead>
      <tbody>
        {#each results as row (row.id)}
          <tr class="border-t border-edge/70" class:me={row.id === view.you}>
            <td class="py-1.5 pr-2 font-display text-[16px] text-muted">{row.placement}</td>
            <td class="py-1.5 pr-2 font-semibold">
              <span class="inline-flex min-w-0 items-center gap-1.5">
                <Avatar id={row.id} size={20} label={nameOf(row.id)} />
                <span>{nameOf(row.id)}{#if row.id === view.you}<em class="not-italic text-gold"> · you</em>{/if}</span>
              </span>
            </td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{money(row.bankroll)}</td>
            <td class="py-1.5 pr-2 text-right tabular-nums">{row.penalty > 0 ? `−${money(row.penalty)}` : '—'}</td>
            <td class="py-1.5 text-right font-bold tabular-nums text-mint">{money(row.adjusted)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if stats}
    <div class="panel w-full max-w-[720px]">
      <h3 class="m-0 font-display text-[20px] leading-none tracking-[0.08em] text-gold">Your run</h3>
      <dl class="m-0 grid grid-cols-2 gap-2 min-[560px]:grid-cols-3 short:grid-cols-3">
        {#each stats as stat (stat.label)}
          <div class="rounded-xl border border-edge bg-surface/60 p-2.5">
            <dt class="text-[10px] uppercase tracking-[0.14em] text-muted">{stat.label}</dt>
            <dd class="m-0 font-display text-[22px] leading-none text-fog">{stat.value}</dd>
          </div>
        {/each}
      </dl>
    </div>
  {:else}
    <p class="m-0 text-[13px] text-muted">You were watching this run.</p>
  {/if}

  {#if party}
    <p class="m-0 text-[13px] text-muted">Waiting for the host to start another run…</p>
  {:else}
    <button type="button" class="btn btn-primary" onclick={() => send('again', null)}>Run it back</button>
  {/if}
</section>

{#if celebrating && confetti.length > 0}
  <div class="confetti" aria-hidden="true">
    {#each confetti as piece, index (index)}
      <span
        style:--x="{piece.x}px"
        style:--y="{piece.y}px"
        style:--r="{piece.r}deg"
        style:--c={piece.c}
        style:--d="{piece.d}s"
        style:--t="{piece.t}s"
      ></span>
    {/each}
  </div>
{/if}
