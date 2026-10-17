<script lang="ts">
  import type { Json } from '@playground-exe/game-kit/multiplayer/protocol';
  import type { PlayerView } from '../../core/types';
  import { JACKPOT_SEED, SLOTS_BETS, SLOTS_LINES, SLOT_PAYTABLE, SLOT_SYMBOLS, SLOT_SYMBOL_NAMES } from '../../games/slots';
  import type { SlotsView } from '../../games/slots';
  import { sound } from '../../sound';
  import Avatar from '../Avatar.svelte';

  let { detail, view, names, send }: { detail: Json; view: PlayerView; names: Record<string, string>; send: (action: string, payload: Json) => void } = $props();

  type BurstCoin = { id: number; dx: number; up: number; r: number; s: number; d: number; t: number };

  const SYMBOL_GLYPHS = ['7', '◆', '▮▮', '◔', '●', '✦'];
  const SYMBOL_COLORS = ['var(--color-red)', 'var(--color-mint)', 'var(--color-muted)', 'var(--color-gold)', 'var(--color-lemon)', 'var(--color-red)'];
  const LINE_LABELS = ['Top row', 'Middle row', 'Bottom row', 'Diagonal ↘', 'Diagonal ↗'];
  const SPIN_DURS = [160, 190, 230];
  const DROP_DURS = [160, 180, 240];
  const CONFETTI_COLORS = ['var(--color-gold)', 'var(--color-red)', 'var(--color-mint)', 'var(--color-violet)', 'var(--color-sky)'];
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const confetti = reduceMotion ? [] : Array.from({ length: 40 }, () => ({
    x: Math.round((Math.random() * 2 - 1) * 190),
    y: Math.round(110 + Math.random() * 260),
    r: Math.round((Math.random() < 0.5 ? -1 : 1) * (320 + Math.random() * 460)),
    c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0]!,
    d: +(Math.random() * 0.5).toFixed(2),
    t: +(1.4 + Math.random() * 1.2).toFixed(2),
  }));

  const rain = reduceMotion ? [] : Array.from({ length: 26 }, () => ({
    x: +(2 + Math.random() * 96).toFixed(2),
    d: +(Math.random() * 1.1).toFixed(2),
    t: +(1.5 + Math.random() * 1.3).toFixed(2),
    r: Math.round((Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 480)),
    s: +(0.7 + Math.random() * 0.9).toFixed(2),
  }));

  function seedDecoys(): number[][] {
    return [0, 1, 2].map(() => Array.from({ length: 3 }, () => Math.floor(Math.random() * SLOT_SYMBOLS.length)));
  }

  function makeBurst(amount: number): BurstCoin[] {
    if (reduceMotion || amount <= 0) return [];
    const huge = amount >= JACKPOT_SEED;
    const count = Math.max(4, Math.min(56, Math.round(3 + amount / 12)));
    const spread = 60 + Math.min(amount, 500) * 0.55;
    const lift = 60 + Math.min(amount, 500) * 0.42;
    return Array.from({ length: count }, (_, index) => ({
      id: index,
      dx: Math.round((Math.random() * 2 - 1) * spread),
      up: Math.round(-(52 + Math.random() * lift)),
      r: Math.round((Math.random() * 2 - 1) * 560),
      s: huge ? 1.5 : amount >= 100 ? 1.15 : 0.85,
      d: Math.round(Math.random() * 260),
      t: Math.round(720 + Math.random() * 640),
    }));
  }

  const table = $derived(detail !== null && typeof detail === 'object' && !Array.isArray(detail) ? (detail as unknown as SlotsView) : null);
  const grid = $derived(table?.grid ?? []);
  const lines = $derived(table?.lines ?? []);
  const win = $derived(table?.win ?? 0);
  const machines = $derived(table?.machines ?? []);
  const bankroll = $derived(view.vault?.bankroll ?? 0);
  const rounds = $derived(view.vault?.rounds ?? 0);
  const playing = $derived(view.phase === 'playing' && view.vault?.status === 'active');
  const jackpotHit = $derived(win >= JACKPOT_SEED);

  const bets = $derived.by(() => {
    const list = table?.bets;
    return list !== undefined && list.length > 0 ? list : [...SLOTS_BETS];
  });

  const pot = $derived(table?.jackpot ?? infoNumber(view.tables.slots.info, 'jackpot') ?? JACKPOT_SEED);

  const columns = $derived.by(() => {
    if (grid.length !== 3) return [[], [], []];
    return [0, 1, 2].map(col => grid.map(row => row[col] ?? 0));
  });

  const winningCells = $derived.by(() => {
    const hits = new Set<string>();
    for (const index of lines) {
      const line = SLOTS_LINES.at(index);
      if (line === undefined) continue;
      for (const cell of line) hits.add(`${cell[0]}-${cell[1]}`);
    }
    return hits;
  });

  const feedJackpot = $derived.by(() => {
    const item = view.feed.at(-1);
    return item !== undefined && item.kind === 'jackpot' ? item : null;
  });

  let bet = $state(1);
  let phases = $state<number[]>([0, 0, 0]);
  let decoys = $state<number[][]>(seedDecoys());
  let burst = $state<BurstCoin[]>([]);
  let celebrate = $state(false);
  let quake = $state(false);
  let lastRounds: number | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

  const activeBet = $derived(bets.includes(bet) ? bet : bets[0] ?? 1);
  const canSpin = $derived(playing && bankroll >= activeBet);
  const charging = $derived(phases.some(phase => phase !== 0));

  function infoNumber(info: Json, key: string): number | null {
    if (info === null || typeof info !== 'object' || Array.isArray(info)) return null;
    const value = (info as Record<string, Json>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function money(value: number): string {
    return `$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
  }

  function nameOf(id: string | null): string {
    return id === null ? 'The house' : names[id] ?? 'A player';
  }

  function machineName(id: string): string {
    return id === view.you ? 'You' : names[id] ?? 'Player';
  }

  function setPhase(column: number, value: number): void {
    phases = phases.map((phase, index) => (index === column ? value : phase));
  }

  function spin(): void {
    if (!canSpin) return;
    sound.play('spin', activeBet);
    send('spin', { bet: activeBet });
  }

  $effect(() => {
    const current = rounds;
    const machine = table;
    if (lastRounds === null) {
      lastRounds = current;
      return;
    }
    if (current === lastRounds) return;
    lastRounds = current;
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    if (machine === null) return;
    const jackpot = machine.win >= JACKPOT_SEED;
    if (jackpot) sound.play('jackpot');
    else if (machine.win > 0) sound.play('win');
    else sound.play('lose');
    burst = makeBurst(machine.win);
    if (jackpot) {
      celebrate = true;
      if (!reduceMotion) {
        quake = true;
        timers.push(setTimeout(() => { quake = false; }, 720));
      }
      if (celebrateTimer !== null) clearTimeout(celebrateTimer);
      celebrateTimer = setTimeout(() => { celebrate = false; }, 3800);
    }
    if (reduceMotion) {
      phases = [0, 0, 0];
      return;
    }
    decoys = seedDecoys();
    phases = [1, 1, 1];
    timers.push(
      setTimeout(() => setPhase(0, 2), 400),
      setTimeout(() => setPhase(0, 0), 560),
      setTimeout(() => setPhase(1, 2), 520),
      setTimeout(() => setPhase(1, 0), 700),
      setTimeout(() => setPhase(2, 2), 610),
      setTimeout(() => setPhase(2, 0), 850),
    );
  });

  $effect(() => () => {
    for (const timer of timers) clearTimeout(timer);
    if (celebrateTimer !== null) clearTimeout(celebrateTimer);
  });
</script>

<section class="casino-slots flex h-full min-h-0 flex-col gap-2 short:gap-1.5" class:quake={quake} data-table="slots">
  {#if feedJackpot !== null}
    <div class="jackpot-banner shrink-0" role="status">
      <span class="eyebrow">Jackpot hit</span>
      <strong class="font-display text-[20px] leading-none tracking-[0.03em] text-gold">{nameOf(feedJackpot.playerId)} · {money(feedJackpot.amount)}</strong>
    </div>
  {/if}

  <div class="flex min-h-0 flex-1 items-stretch gap-3 short:gap-2">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 short:gap-1.5">
      <div class="cabinet panel relative flex min-h-0 flex-1 flex-col gap-2 short:gap-1.5 short:p-2" class:charging>
        <header class="flex shrink-0 flex-wrap items-end justify-between gap-2">
          <div class="grid gap-0.5">
            <span class="eyebrow">Shared jackpot</span>
            <strong class="jackpot-value animate-title font-display tabular-nums">{money(pot)}</strong>
          </div>
          <span class="badge short:hidden" class:shared={view.tables.slots.mode === 'shared'}>
            {view.tables.slots.mode} · {view.tables.slots.seats}/{view.tables.slots.limit}
          </span>
        </header>

        <div class="reels-wrap min-h-0 flex-1">
          <div class="reels" role="group" aria-label="Slot reels">
            {#each columns as column, c (c)}
              <div class="reel" class:spin={phases[c] === 1}>
                {#if phases[c] === 1}
                  <div class="reel-track" style:--spin-dur="{SPIN_DURS[c] ?? 190}ms" aria-hidden="true">
                    {#each [...(decoys[c] ?? []), ...(decoys[c] ?? [])] as symbol, index (index)}
                      <span class="cell" style:--symbol={SYMBOL_COLORS[symbol] ?? 'var(--color-fog)'}>
                        <span class="face"><span class="glyph">{SYMBOL_GLYPHS[symbol] ?? '?'}</span></span>
                      </span>
                    {/each}
                  </div>
                {:else if phases[c] === 2}
                  <div class="reel-drop" style:--drop-dur="{DROP_DURS[c] ?? 200}ms" aria-hidden="true">
                    <span class="cell" style:--symbol={SYMBOL_COLORS[decoys[c]?.[0] ?? 1] ?? 'var(--color-fog)'}>
                      <span class="face"><span class="glyph">{SYMBOL_GLYPHS[decoys[c]?.[0] ?? 1] ?? '?'}</span></span>
                    </span>
                    {#each column as symbol, r (r)}
                      <span class="cell" style:--symbol={SYMBOL_COLORS[symbol] ?? 'var(--color-fog)'}>
                        <span class="face"><span class="glyph">{SYMBOL_GLYPHS[symbol] ?? '?'}</span></span>
                      </span>
                    {/each}
                  </div>
                {:else}
                  <div class="reel-static">
                    {#each column as symbol, r (r)}
                      <span
                        class="cell"
                        class:hit={winningCells.has(`${r}-${c}`)}
                        style:--symbol={SYMBOL_COLORS[symbol] ?? 'var(--color-fog)'}
                        role="img"
                        aria-label={SLOT_SYMBOL_NAMES[symbol] ?? 'Slot symbol'}
                      >
                        <span class="face"><span class="glyph">{SYMBOL_GLYPHS[symbol] ?? '?'}</span></span>
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <div class="win-row shrink-0">
          {#key rounds}
            {#if win > 0}
              <p class="win-flash" class:jackpot={jackpotHit}>
                <span class="win-label">{jackpotHit ? 'Jackpot' : 'Win'}</span>
                <strong class="win-amount tabular-nums">{money(win)}</strong>
              </p>
            {:else if rounds > 0}
              <p class="win-quiet">No line that spin — press SPIN to chase the next one.</p>
            {:else}
              <p class="win-quiet">Pick a stake and press SPIN.</p>
            {/if}
          {/key}
          {#if lines.length > 0}
            <ul class="line-chips flex list-none flex-wrap gap-1.5 p-0" aria-label="Winning lines">
              {#each lines as index (index)}
                <li class="line-chip" class:jackpot={jackpotHit && index === 1}>
                  {jackpotHit && index === 1 ? 'Jackpot · middle row' : LINE_LABELS[index] ?? 'Line'}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        {#key rounds}
          {#if burst.length > 0}
            <span class="coin-burst" aria-hidden="true">
              {#each burst as coin (coin.id)}
                <span
                  class="burst-coin"
                  style:--dx="{coin.dx}px"
                  style:--up="{coin.up}px"
                  style:--r="{coin.r}deg"
                  style:--s={coin.s}
                  style:--d="{coin.d}ms"
                  style:--t="{coin.t}ms"
                >$</span>
              {/each}
            </span>
          {/if}
        {/key}

        <span class="chase" aria-hidden="true"><i></i></span>
      </div>

      <div class="machines-lite panel flex items-center gap-2 p-2 min-[1000px]:hidden short:hidden">
        <span class="eyebrow shrink-0">Machines</span>
        {#if machines.length === 0}
          <span class="text-[12px] text-muted">You have the floor.</span>
        {:else}
          <ul class="flex min-w-0 gap-1.5 overflow-x-auto m-0 list-none p-0">
            {#each machines as machine (machine.id)}
              <li class="machine-pill" class:me={machine.id === view.you}>
                <Avatar id={machine.id} size={20} label={machineName(machine.id)} />
                <span>{machineName(machine.id)}</span>
                <strong class:paid={machine.lastWin > 0}>{machine.lastWin > 0 ? `+${money(machine.lastWin)}` : '—'}</strong>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="panel flex shrink-0 flex-col gap-2 short:gap-1.5 short:p-2">
        <div class="flex flex-wrap items-stretch gap-2">
          <div class="bet-group" role="group" aria-label="Stake">
            {#each bets as option (option)}
              <button type="button" class="bet-btn" class:active={option === activeBet} aria-pressed={option === activeBet} disabled={option > bankroll || charging} onclick={() => (bet = option)}>
                {money(option)}
              </button>
            {/each}
          </div>
          <button type="button" class="btn btn-primary spin-btn" disabled={!canSpin} onclick={spin}>SPIN</button>
        </div>
        <p class="m-0 text-[12px] text-muted short:hidden">
          {#if view.vault?.status === 'offered'}
            You are broke — accept the bailout to keep playing.
          {:else if !playing}
            You are watching — take a seat in the party lobby to spin.
          {:else if bankroll < activeBet}
            Not enough chips for this stake — pick a smaller bet.
          {:else}
            Bankroll {money(bankroll)} · stake {money(activeBet)}
          {/if}
        </p>
      </div>
    </div>

    <aside class="hidden min-h-0 w-[var(--side-w)] shrink-0 flex-col gap-2 overflow-y-auto scroll-y min-[1000px]:flex">
      <div class="panel">
        <h3 class="m-0 font-display text-[18px] leading-none tracking-[0.08em] text-violet">Machines</h3>
        {#if machines.length === 0}
          <p class="m-0 text-[12px] text-muted">No machines running yet — you have the floor.</p>
        {:else}
          <ul class="machine-strip m-0 grid list-none gap-1.5 p-0" aria-label="Machines and latest wins">
            {#each machines as machine (machine.id)}
              <li class="machine-chip" class:me={machine.id === view.you}>
                <span class="machine-name">
                  <Avatar id={machine.id} size={20} label={machineName(machine.id)} />
                  <span class="machine-label">{machineName(machine.id)}</span>
                </span>
                <strong class="machine-win tabular-nums" class:paid={machine.lastWin > 0}>
                  {machine.lastWin > 0 ? `+${money(machine.lastWin)}` : '—'}
                </strong>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="panel">
        <h3 class="m-0 font-display text-[18px] leading-none tracking-[0.08em] text-violet">Paytable</h3>
        <ul class="legend m-0 grid list-none gap-1 p-0">
          {#each SLOT_SYMBOLS as symbol, index (symbol)}
            <li class="legend-row">
              <span class="cell mini" style:--symbol={SYMBOL_COLORS[index] ?? 'var(--color-fog)'}>
                <span class="face"><span class="glyph">{SYMBOL_GLYPHS[index] ?? '?'}</span></span>
              </span>
              <span class="legend-name">{SLOT_SYMBOL_NAMES[index] ?? 'Symbol'}</span>
              <span class="legend-pay tabular-nums">×{SLOT_PAYTABLE[index] ?? 0}</span>
            </li>
          {/each}
        </ul>
        <p class="m-0 text-[11.5px] text-muted">Three of a kind on any of the five lines pays the multiplier on your total bet. Diamonds across the middle row at a $10+ stake take the whole jackpot.</p>
      </div>
    </aside>
  </div>
</section>

{#if celebrate}
  <div class="jackpot-celebration" role="status">
    <span class="rainbow" aria-hidden="true"></span>
    {#if !reduceMotion}
      <span class="jackpot-rain" aria-hidden="true">
        {#each rain as drop, index (index)}
          <span
            class="fall-coin"
            style:--x="{drop.x}%"
            style:--d="{drop.d}s"
            style:--t="{drop.t}s"
            style:--r="{drop.r}deg"
            style:--s={drop.s}
          >$</span>
        {/each}
      </span>
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
    <div class="jackpot-pop">
      <span class="eyebrow">All in</span>
      <strong class="jackpot-pop-title">JACKPOT</strong>
      <span class="jackpot-pop-amount tabular-nums">{money(win)}</span>
    </div>
  </div>
{/if}

<style>
  .casino-slots {
    --side-w: 272px;
    --color-lemon: #ffe14d;
    min-height: clamp(380px, calc(100dvh - 13rem), 1400px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
  }

  .casino-slots.quake {
    animation: quake 0.72s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  @keyframes quake {
    0%, 100% { transform: none; }
    8% { transform: translate(-7px, 4px) rotate(-0.35deg); }
    20% { transform: translate(6px, -5px) rotate(0.3deg); }
    34% { transform: translate(-5px, 3px) rotate(-0.25deg); }
    48% { transform: translate(4px, -3px) rotate(0.2deg); }
    64% { transform: translate(-3px, 2px) rotate(-0.12deg); }
    82% { transform: translate(2px, -1px); }
  }

  .cabinet {
    position: relative;
    border: 3px double var(--color-gold);
    background:
      radial-gradient(420px 220px at 50% -24%, rgba(202, 168, 123, 0.2), transparent 74%),
      linear-gradient(170deg, rgba(23, 59, 49, 0.92), rgba(13, 40, 34, 0.96));
  }

  .cabinet::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
    pointer-events: none;
    background: radial-gradient(120% 70% at 50% 0%, rgba(202, 168, 123, 0.24), transparent 60%);
    opacity: 0.25;
    animation: cabinet-breathe 5.5s ease-in-out infinite;
  }

  .cabinet.charging::after {
    animation-duration: 1.6s;
  }

  @keyframes cabinet-breathe {
    0%, 100% { opacity: 0.14; }
    50% { opacity: 0.34; }
  }

  .cabinet > header,
  .reels-wrap,
  .win-row {
    position: relative;
    z-index: 2;
  }

  .chase {
    position: absolute;
    inset: -1px;
    z-index: 3;
    padding: 2px;
    border-radius: 19px;
    overflow: hidden;
    pointer-events: none;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
  }

  .chase i {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 220%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    background: conic-gradient(
      from 0turn,
      rgba(202, 168, 123, 0) 0turn 0.68turn,
      rgba(202, 168, 123, 0.5) 0.78turn,
      rgba(164, 197, 187, 0.92) 0.85turn,
      rgba(255, 255, 255, 0.95) 0.89turn,
      rgba(202, 168, 123, 0) 0.96turn,
      transparent 1turn
    );
    animation: chase-spin 6s linear infinite;
  }

  .cabinet.charging .chase i {
    animation-duration: 0.8s;
  }

  @keyframes chase-spin {
    to { transform: translate(-50%, -50%) rotate(1turn); }
  }

  .jackpot-value {
    font-size: clamp(28px, 6vw, 42px);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--color-gold);
  }

  .reels-wrap {
    container-type: size;
    display: grid;
    place-items: center;
    min-height: 200px;
    overflow: hidden;
  }

  .reels {
    --slot-cell: clamp(30px, min(calc((100cqw - 40px) / 3), calc((100cqh - 40px) / 3)), 112px);
    display: grid;
    grid-template-columns: repeat(3, auto);
    justify-content: center;
    gap: 8px;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--color-violet) 40%, var(--color-edge));
    border-radius: 18px;
    background:
      radial-gradient(300px 150px at 50% 0%, rgba(202, 168, 123, 0.16), transparent 76%),
      rgba(7, 27, 23, 0.72);
  }

  .reel {
    position: relative;
    width: var(--slot-cell);
    height: calc(var(--slot-cell) * 3);
    overflow: hidden;
    border: 1px solid rgba(36, 46, 76, 0.9);
    border-radius: 14px;
    background: #0b1020;
  }

  .reel::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    background: linear-gradient(180deg, rgba(7, 27, 23, 0.8), transparent 20%, transparent 80%, rgba(7, 27, 23, 0.8));
  }

  .reel::before {
    content: '';
    position: absolute;
    inset: -14px 0;
    z-index: 2;
    pointer-events: none;
    background: repeating-linear-gradient(180deg, rgba(255, 255, 255, 0) 0 6px, rgba(255, 255, 255, 0.1) 6px 8px);
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .reel.spin::before {
    opacity: 1;
    animation: reel-streaks 0.14s linear infinite;
  }

  @keyframes reel-streaks {
    from { transform: translateY(0); }
    to { transform: translateY(-8px); }
  }

  .reel-static,
  .reel-track,
  .reel-drop {
    display: grid;
  }

  .reel-track {
    filter: blur(1.6px) saturate(1.25);
    animation: reel-spin var(--spin-dur, 190ms) linear infinite;
  }

  @keyframes reel-spin {
    from { transform: translateY(0); }
    to { transform: translateY(-50%); }
  }

  .reel-drop {
    animation: reel-drop var(--drop-dur, 200ms) cubic-bezier(0.1, 0.72, 0.14, 1) both;
  }

  @keyframes reel-drop {
    from { transform: translateY(0); filter: blur(1.6px) brightness(1.25); }
    to { transform: translateY(calc(var(--slot-cell) * -1)); filter: blur(0) brightness(1); }
  }

  .reel-static {
    animation: reel-sharpen 0.16s ease-out both;
  }

  @keyframes reel-sharpen {
    from { filter: blur(3px) brightness(1.4); }
    to { filter: blur(0) brightness(1); }
  }

  .cell {
    display: grid;
    width: var(--slot-cell);
    height: var(--slot-cell);
    padding: 3px;
    font-family: var(--font-display);
    font-size: calc(var(--slot-cell) * 0.42);
    line-height: 1;
  }

  .cell .face {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border: 1px solid color-mix(in srgb, var(--symbol, var(--color-fog)) 55%, var(--color-edge));
    border-radius: 11px;
    background:
      radial-gradient(circle at 32% 24%, color-mix(in srgb, var(--symbol, var(--color-fog)) 22%, transparent), transparent 72%),
      #0d2822;
    box-shadow: inset 0 0 18px -10px var(--symbol, var(--color-fog));
    color: var(--symbol, var(--color-fog));
    text-shadow: 0 0 12px color-mix(in srgb, var(--symbol, var(--color-fog)) 65%, transparent);
  }

  .cell.hit .face {
    border-color: color-mix(in srgb, var(--color-gold) 75%, var(--color-fog));
    animation: hit-pop 0.5s cubic-bezier(0.2, 1.5, 0.35, 1) both, hit-pulse 1.2s ease-in-out 0.5s infinite;
  }

  .cell.hit .face::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    border: 1px solid rgba(216, 183, 108, 0.85);
    opacity: 0;
    pointer-events: none;
    animation: trail-pulse 1.2s ease-out 0.4s infinite;
  }

  @keyframes hit-pop {
    0% { transform: scale(0.55); filter: brightness(2.2); }
    60% { transform: scale(1.14); }
    100% { transform: scale(1); filter: brightness(1); }
  }

  @keyframes hit-pulse {
    0%, 100% { box-shadow: inset 0 0 18px -10px var(--symbol), 0 0 12px -6px var(--color-gold); }
    50% { box-shadow: inset 0 0 18px -6px var(--symbol), 0 0 24px -4px var(--color-gold); }
  }

  @keyframes trail-pulse {
    0% { opacity: 0.8; transform: scale(0.86); }
    70% { opacity: 0; transform: scale(1.35); }
    100% { opacity: 0; transform: scale(1.35); }
  }

  .cell.mini {
    width: 34px;
    height: 34px;
    padding: 2px;
    font-size: 14px;
  }

  .cell.mini .face {
    border-radius: 9px;
  }

  .win-row {
    display: flex;
    min-height: 74px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 14px;
    padding: 10px 14px;
    border: 1px solid var(--color-edge);
    border-radius: 16px;
    background: rgba(7, 27, 23, 0.55);
  }

  .win-flash {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    animation: win-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }

  .win-flash.jackpot {
    animation: win-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both, jackpot-flash 0.9s ease-in-out 0.4s infinite;
  }

  @keyframes win-pop {
    0% { opacity: 0; transform: translateY(10px) scale(0.82); }
    60% { opacity: 1; transform: translateY(-2px) scale(1.06); }
    100% { opacity: 1; transform: none; }
  }

  @keyframes jackpot-flash {
    0%, 100% { filter: none; }
    50% { filter: brightness(1.25); }
  }

  .win-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .win-amount {
    font-family: var(--font-display);
    font-size: clamp(30px, 7vw, 42px);
    line-height: 1;
    color: var(--color-mint);
    text-shadow: 0 0 18px rgba(150, 211, 174, 0.55);
  }

  .win-flash.jackpot .win-label { color: var(--color-gold); }

  .win-flash.jackpot .win-amount {
    color: var(--color-gold);
    text-shadow: 0 0 22px rgba(216, 183, 108, 0.8);
  }

  .win-quiet {
    margin: 0;
    font-size: 13px;
    color: var(--color-muted);
  }

  .coin-burst {
    position: absolute;
    inset: 0;
    z-index: 4;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }

  .burst-coin {
    position: absolute;
    left: 18%;
    bottom: 46px;
    display: grid;
    width: 18px;
    height: 18px;
    place-items: center;
    border-radius: 999px;
    background: var(--color-gold);
    color: #241a02;
    font: 800 11px/1 var(--font-sans);
    opacity: 0;
    animation: coin-fly var(--t, 1s) cubic-bezier(0.2, 0.7, 0.4, 1) var(--d, 0ms) both;
  }

  @keyframes coin-fly {
    0% { opacity: 0; transform: translate(0, 0) scale(calc(var(--s, 1) * 0.6)) rotate(0deg); }
    12% { opacity: 1; }
    55% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.62), var(--up, -90px)) scale(var(--s, 1)) rotate(calc(var(--r, 0deg) * 0.55)); }
    100% { opacity: 0; transform: translate(var(--dx, 0px), 26px) scale(calc(var(--s, 1) * 0.9)) rotate(var(--r, 0deg)); }
  }

  .line-chips {
    margin: 0;
  }

  .line-chip {
    padding: 4px 9px;
    border: 1px solid color-mix(in srgb, var(--color-gold) 45%, var(--color-edge));
    border-radius: 999px;
    background: rgba(216, 183, 108, 0.1);
    color: var(--color-gold);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    animation: var(--animate-feed);
  }

  .line-chip.jackpot {
    border-color: rgba(216, 183, 108, 0.85);
    box-shadow: 0 0 18px -6px rgba(216, 183, 108, 0.9);
  }

  .bet-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--color-edge);
    border-radius: 14px;
    background: rgba(7, 27, 23, 0.6);
  }

  .bet-btn {
    min-width: 54px;
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--color-muted);
    font: 800 14px/1 var(--font-sans);
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
  }

  .bet-btn:disabled { opacity: 0.4; cursor: default; }

  .bet-btn:hover:not(.active):not(:disabled) { color: var(--color-fog); }

  .bet-btn.active {
    border-color: rgba(216, 183, 108, 0.6);
    background: rgba(216, 183, 108, 0.14);
    color: var(--color-gold);
  }

  .bet-btn:focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
  }

  .spin-btn {
    flex: 1 1 140px;
    min-height: 56px;
    font-family: var(--font-display);
    font-size: 26px;
    letter-spacing: 0.14em;
  }

  .jackpot-banner {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid rgba(216, 183, 108, 0.6);
    border-radius: 16px;
    background:
      radial-gradient(240px 90px at 12% 0%, rgba(216, 183, 108, 0.22), transparent 76%),
      rgba(23, 59, 49, 0.85);
    box-shadow: 0 0 26px -12px rgba(216, 183, 108, 0.85);
    animation: var(--animate-panel);
  }

  .machine-strip {
    grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  }

  .machine-chip {
    display: grid;
    gap: 1px;
    padding: 6px 8px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: rgba(23, 59, 49, 0.55);
  }

  .machine-chip.me {
    border-color: rgba(202, 168, 123, 0.6);
    background: rgba(202, 168, 123, 0.1);
  }

  .machine-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-muted);
  }

  .machine-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine-win {
    font-family: var(--font-display);
    font-size: 17px;
    line-height: 1;
    color: var(--color-muted);
  }

  .machine-win.paid {
    color: var(--color-mint);
  }

  .machine-pill {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border: 1px solid var(--color-edge);
    border-radius: 999px;
    background: rgba(23, 59, 49, 0.55);
    font-size: 11.5px;
    font-weight: 700;
    color: var(--color-muted);
    white-space: nowrap;
  }

  .machine-pill.me {
    border-color: rgba(202, 168, 123, 0.6);
    color: var(--color-fog);
  }

  .machine-pill strong {
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--color-muted);
  }

  .machine-pill strong.paid {
    color: var(--color-mint);
  }

  .legend-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 5px 7px;
    border: 1px solid var(--color-edge);
    border-radius: 12px;
    background: rgba(23, 59, 49, 0.5);
  }

  .legend-name {
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-fog);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .legend-pay {
    font-family: var(--font-display);
    font-size: 17px;
    color: var(--color-gold);
  }

  .jackpot-celebration {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    overflow: hidden;
    pointer-events: none;
    background: radial-gradient(closest-side, rgba(216, 183, 108, 0.16), transparent 72%);
    animation: var(--animate-veil);
  }

  .rainbow {
    position: absolute;
    inset: -10% -30%;
    background: linear-gradient(
      100deg,
      transparent 6%,
      rgba(229, 116, 117, 0.28) 28%,
      rgba(216, 183, 108, 0.34) 44%,
      rgba(150, 211, 174, 0.3) 60%,
      rgba(202, 168, 123, 0.3) 74%,
      transparent 94%
    );
    transform: translateX(-120%);
    animation: rainbow-sweep 1.7s ease-in-out 2;
    pointer-events: none;
  }

  @keyframes rainbow-sweep {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(120%); }
  }

  .jackpot-rain {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .fall-coin {
    position: absolute;
    top: -8%;
    left: var(--x, 50%);
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    border-radius: 999px;
    background: var(--color-gold);
    color: #241a02;
    font: 800 10px/1 var(--font-sans);
    opacity: 0;
    animation: coin-fall var(--t, 2s) linear var(--d, 0s) both;
  }

  @keyframes coin-fall {
    0% { opacity: 0; transform: translateY(-12vh) rotate(0deg) scale(var(--s, 1)); }
    8% { opacity: 1; }
    88% { opacity: 1; }
    100% { opacity: 0; transform: translateY(112vh) rotate(var(--r, 360deg)) scale(var(--s, 1)); }
  }

  .jackpot-pop {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 26px 34px;
    border: 1px solid rgba(216, 183, 108, 0.7);
    border-radius: 24px;
    background: linear-gradient(170deg, #1c2440, #0d2822);
    box-shadow: 0 0 64px -12px rgba(216, 183, 108, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    animation: jackpot-pop-in 0.55s cubic-bezier(0.2, 1.5, 0.4, 1) both;
  }

  .jackpot-pop-title {
    font-family: var(--font-display);
    font-size: clamp(40px, 12vw, 76px);
    line-height: 0.9;
    letter-spacing: 0.1em;
    color: var(--color-gold);
    text-shadow: 0 0 30px rgba(216, 183, 108, 0.95);
  }

  .jackpot-pop-amount {
    font-family: var(--font-display);
    font-size: clamp(26px, 7vw, 40px);
    line-height: 1;
    color: var(--color-mint);
  }

  @keyframes jackpot-pop-in {
    from { opacity: 0; transform: translateY(18px) scale(0.86); }
    to { opacity: 1; transform: none; }
  }

  @media (orientation: landscape) and (max-height: 620px) {
    .casino-slots {
      min-height: 0;
      --side-w: 230px;
    }

    .reels-wrap {
      min-height: 118px;
    }

    .reels {
      --slot-cell: clamp(24px, min(calc((100cqw - 40px) / 3), calc((100cqh - 40px) / 3)), 64px);
      padding: 6px;
      gap: 6px;
    }

    .reel {
      border-radius: 10px;
    }

    .jackpot-value {
      font-size: 24px;
    }

    .win-row {
      min-height: 0;
      padding: 5px 10px;
    }

    .win-amount {
      font-size: 26px;
    }

    .spin-btn {
      min-height: 44px;
      font-size: 20px;
    }

    .bet-btn {
      min-height: 44px;
      padding: 6px 10px;
    }
  }

  @media (max-width: 600px) and (orientation: portrait) {
    .casino-slots { min-height: 0; overflow-y: auto; }
    .bet-group { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); width: 100%; }
    .bet-btn { min-width: 0; padding: 10px 4px; font-size: 12px; }
    .spin-btn { width: 100%; min-height: 52px; }
    .reels-wrap { min-height: 165px; }
    .win-row { min-height: 50px; }
  }

</style>
