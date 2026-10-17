<script lang="ts">
  import { untrack } from 'svelte';
  import type { PlayerView } from '../core/types';

  let { view, screen, remaining, rail, boardOpen, ontoggle }: {
    view: PlayerView;
    screen: string;
    remaining: number;
    rail: boolean;
    boardOpen: boolean;
    ontoggle: () => void;
  } = $props();

  const bankroll = $derived(view.vault?.bankroll ?? 0);
  const penalty = $derived(view.vault?.penalty ?? 0);
  const danger = $derived(remaining <= 60_000);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let shown = $state<number | null>(null);
  let flash = $state<'up' | 'down' | null>(null);
  let raf = 0;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const display = $derived(shown ?? bankroll);

  $effect(() => {
    const target = bankroll;
    const from = untrack(() => shown);
    if (from === null) {
      shown = target;
      return;
    }
    if (target === from) return;
    flash = target > from ? 'up' : 'down';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = null;
    }, 950);
    cancelAnimationFrame(raf);
    if (reduceMotion) {
      shown = target;
      return;
    }
    const started = performance.now();
    const step = (time: number) => {
      const progress = Math.min(1, (time - started) / 460);
      shown = Math.round(from + (target - from) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) raf = requestAnimationFrame(step);
      else shown = target;
    };
    raf = requestAnimationFrame(step);
  });

  $effect(() => () => {
    cancelAnimationFrame(raf);
    clearTimeout(flashTimer);
  });

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function clock(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }
</script>

<header class="hud short:py-1.5">
  <div class="grid min-w-0 justify-items-start gap-0.5">
    <span class="eyebrow">Bankroll</span>
    <strong
      class="hud-bankroll font-display text-[clamp(26px,5.4vw,34px)] leading-none tracking-wide tabular-nums text-mint"
      class:gain={flash === 'up'}
      class:loss={flash === 'down'}
    >{money(display)}</strong>
    {#if penalty > 0}
      <span class="penalty-badge">score −{money(penalty)}</span>
    {/if}
  </div>
  <div class="grid justify-items-center gap-0.5 text-center">
    <span class="animate-title font-display text-[clamp(24px,4.6vw,32px)] leading-none tracking-[0.08em] text-gold">ALL IN!</span>
    <span class="eyebrow">{screen}</span>
  </div>
  <div class="flex min-w-0 items-center justify-end gap-2">
    {#if rail}
      <button type="button" class="btn min-[761px]:hidden px-3" aria-label="Standings" aria-expanded={boardOpen} onclick={ontoggle}>🏆</button>
    {/if}
    <span class="timer" class:danger>{clock(remaining)}</span>
  </div>
</header>
